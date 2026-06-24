import argparse
import difflib
import hashlib
import html
import json
import os
import re
import shutil
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urljoin


TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
UUIDISH_RE = re.compile(r"\b(?:req-|id-)?[a-fA-F0-9]{8,}\b")
WHITESPACE_RE = re.compile(r"\s+")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.text = []
        self.links = []
        self.forms = []
        self.assets = []
        self._ignore_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        self.tags.append(tag)
        if tag in {"script", "style", "noscript"}:
            self._ignore_depth += 1
        if tag == "a" and attrs_dict.get("href"):
            self.links.append(attrs_dict["href"])
        if tag == "form":
            self.forms.append(attrs_dict.get("action", ""))
        if tag in {"img", "script"} and attrs_dict.get("src"):
            self.assets.append(attrs_dict["src"])
        if tag == "link" and attrs_dict.get("href"):
            self.assets.append(attrs_dict["href"])

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self._ignore_depth:
            self._ignore_depth -= 1

    def handle_data(self, data):
        if self._ignore_depth:
            return
        cleaned = WHITESPACE_RE.sub(" ", data).strip()
        if cleaned:
            self.text.append(cleaned)


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False, sort_keys=True)


def fetch(url):
    started = time.time()
    request = Request(url, headers={"user-agent": "fullstack-regression-mvp/0.1"})
    try:
        with urlopen(request, timeout=10) as response:
            body = response.read()
            elapsed_ms = round((time.time() - started) * 1000, 2)
            return {
                "url": url,
                "status": response.status,
                "headers": dict(response.headers.items()),
                "elapsedMs": elapsed_ms,
                "bodyBytes": len(body),
                "bodyText": body.decode("utf-8", errors="replace"),
            }
    except HTTPError as e:
        body = e.read()
        return {
            "url": url,
            "status": e.code,
            "headers": dict(e.headers.items()),
            "elapsedMs": round((time.time() - started) * 1000, 2),
            "bodyBytes": len(body),
            "bodyText": body.decode("utf-8", errors="replace"),
        }
    except URLError as e:
        raise SystemExit(f"Cannot fetch {url}: {e}")


def normalize_scalar(value):
    if isinstance(value, str):
        value = TIMESTAMP_RE.sub("<timestamp>", value)
        value = UUIDISH_RE.sub("<id>", value)
    return value


def normalize_json(value, path="$"):
    noisy_keys = {"generatedAt", "updatedAt", "createdAt", "requestId", "traceId", "sessionId"}
    if isinstance(value, dict):
        normalized = {}
        for key, child in value.items():
            if key in noisy_keys:
                normalized[key] = "<ignored>"
            else:
                normalized[key] = normalize_json(child, f"{path}.{key}")
        return normalized
    if isinstance(value, list):
        return [normalize_json(item, f"{path}[]") for item in value]
    return normalize_scalar(value)


def json_schema(value):
    if isinstance(value, dict):
        return {key: json_schema(child) for key, child in sorted(value.items())}
    if isinstance(value, list):
        if not value:
            return []
        item_schema = json_schema(value[0])
        for item in value[1:]:
            item_schema = merge_schema(item_schema, json_schema(item))
        return [item_schema]
    return type(value).__name__


def merge_schema(left, right):
    if left == right:
        return left
    if isinstance(left, dict) and isinstance(right, dict):
        merged = {}
        for key in sorted(set(left) | set(right)):
            if key not in left:
                merged[key] = {"optional": right[key]}
            elif key not in right:
                merged[key] = {"optional": left[key]}
            else:
                merged[key] = merge_schema(left[key], right[key])
        return merged
    if isinstance(left, list) and isinstance(right, list):
        if not left:
            return right
        if not right:
            return left
        return [merge_schema(left[0], right[0])]
    variants = []
    for item in [left, right]:
        if isinstance(item, dict) and "oneOf" in item:
            variants.extend(item["oneOf"])
        elif item not in variants:
            variants.append(item)
    return {"oneOf": variants}


def capture_page(check, base_url, out_dir):
    url = urljoin(base_url, check["path"])
    response = fetch(url)
    parser = PageParser()
    parser.feed(response["bodyText"])
    body_hash = hashlib.sha256(response["bodyText"].encode("utf-8")).hexdigest()
    raw_path = out_dir / f"{check['id']}.html"
    raw_path.write_text(response["bodyText"], encoding="utf-8")
    return {
        "id": check["id"],
        "type": "page",
        "path": check["path"],
        "url": url,
        "status": response["status"],
        "elapsedMs": response["elapsedMs"],
        "bodyBytes": response["bodyBytes"],
        "bodySha256": body_hash,
        "rawArtifact": raw_path.name,
        "page": {
            "title": extract_title(response["bodyText"]),
            "visibleText": [normalize_scalar(t) for t in parser.text],
            "tagCounts": count_values(parser.tags),
            "links": sorted(parser.links),
            "forms": sorted(parser.forms),
            "assets": sorted(parser.assets),
        },
    }


def capture_api(check, base_url, out_dir):
    url = urljoin(base_url, check["path"])
    response = fetch(url)
    raw_path = out_dir / f"{check['id']}.json"
    raw_path.write_text(response["bodyText"], encoding="utf-8")
    try:
        parsed = json.loads(response["bodyText"])
        normalized = normalize_json(parsed)
        schema = json_schema(parsed)
    except json.JSONDecodeError:
        parsed = None
        normalized = normalize_scalar(response["bodyText"])
        schema = "text"
    return {
        "id": check["id"],
        "type": "api",
        "path": check["path"],
        "url": url,
        "status": response["status"],
        "elapsedMs": response["elapsedMs"],
        "bodyBytes": response["bodyBytes"],
        "rawArtifact": raw_path.name,
        "api": {
            "normalizedBody": normalized,
            "schema": schema,
        },
    }


def extract_title(markup):
    match = re.search(r"<title[^>]*>(.*?)</title>", markup, flags=re.I | re.S)
    if not match:
        return ""
    return WHITESPACE_RE.sub(" ", html.unescape(match.group(1))).strip()


def count_values(values):
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def snapshot(args):
    scenario = read_json(args.scenario)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    checks = []
    for check in scenario["checks"]:
        if check["type"] == "page":
            checks.append(capture_page(check, args.base_url, artifacts_dir))
        elif check["type"] == "api":
            checks.append(capture_api(check, args.base_url, artifacts_dir))
        else:
            raise SystemExit(f"Unsupported check type: {check['type']}")

    manifest = {
        "scenario": scenario["name"],
        "baseUrl": args.base_url,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "checks": checks,
    }
    write_json(out_dir / "snapshot.json", manifest)
    print(f"Snapshot saved to {out_dir / 'snapshot.json'}")


def approve(args):
    run_dir = Path(args.run)
    baseline_dir = Path(args.baseline)
    if not (run_dir / "snapshot.json").exists():
        raise SystemExit(f"No snapshot.json in {run_dir}")
    if baseline_dir.exists():
        shutil.rmtree(baseline_dir)
    shutil.copytree(run_dir, baseline_dir)
    print(f"Baseline updated at {baseline_dir}")


def compare(args):
    baseline = read_json(Path(args.baseline) / "snapshot.json")
    run = read_json(Path(args.run) / "snapshot.json")
    diffs = compare_snapshots(baseline, run)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(baseline, run, diffs), encoding="utf-8")
    write_json(report_path.with_suffix(".json"), diffs)
    failed = any(d["severity"] == "fail" for d in diffs)
    print(f"Report saved to {report_path}")
    print(f"Diffs found: {len(diffs)}")
    if failed:
        sys.exit(2)


def compare_snapshots(baseline, run):
    diffs = []
    baseline_checks = {c["id"]: c for c in baseline["checks"]}
    run_checks = {c["id"]: c for c in run["checks"]}
    for check_id in sorted(set(baseline_checks) | set(run_checks)):
        old = baseline_checks.get(check_id)
        new = run_checks.get(check_id)
        if old is None:
            diffs.append(diff(check_id, "new-check", "fail", None, new["type"], "New check appeared"))
            continue
        if new is None:
            diffs.append(diff(check_id, "missing-check", "fail", old["type"], None, "Baseline check is missing in new run"))
            continue
        if old["status"] != new["status"]:
            diffs.append(diff(check_id, "status", "fail", old["status"], new["status"], "HTTP status changed"))
        if old["type"] == "page":
            compare_page(diffs, check_id, old["page"], new["page"])
        if old["type"] == "api":
            compare_api(diffs, check_id, old["api"], new["api"])
    return diffs


def compare_page(diffs, check_id, old, new):
    for field in ["title", "links", "forms", "assets", "tagCounts"]:
        if old.get(field) != new.get(field):
            diffs.append(diff(check_id, f"page.{field}", "review", old.get(field), new.get(field), f"Page {field} changed"))
    if old.get("visibleText") != new.get("visibleText"):
        text_diff = list(difflib.unified_diff(old.get("visibleText", []), new.get("visibleText", []), lineterm=""))
        diffs.append(diff(check_id, "page.visibleText", "review", old.get("visibleText"), new.get("visibleText"), "Visible text changed", text_diff))


def compare_api(diffs, check_id, old, new):
    if old.get("schema") != new.get("schema"):
        diffs.append(diff(check_id, "api.schema", "fail", old.get("schema"), new.get("schema"), "API response schema changed"))
    if old.get("normalizedBody") != new.get("normalizedBody"):
        body_diff = list(difflib.unified_diff(
            json.dumps(old.get("normalizedBody"), indent=2, sort_keys=True).splitlines(),
            json.dumps(new.get("normalizedBody"), indent=2, sort_keys=True).splitlines(),
            lineterm="",
        ))
        diffs.append(diff(check_id, "api.body", "review", old.get("normalizedBody"), new.get("normalizedBody"), "API response body changed", body_diff))


def diff(check_id, kind, severity, old, new, message, patch=None):
    return {
        "checkId": check_id,
        "kind": kind,
        "severity": severity,
        "message": message,
        "old": old,
        "new": new,
        "patch": patch or [],
    }


def render_report(baseline, run, diffs):
    rows = []
    for item in diffs:
        patch = "\n".join(item["patch"]) if item["patch"] else ""
        old_value = json.dumps(item["old"], indent=2, ensure_ascii=False, sort_keys=True)
        new_value = json.dumps(item["new"], indent=2, ensure_ascii=False, sort_keys=True)
        rows.append(f"""
        <section class="diff {html.escape(item['severity'])}">
          <header>
            <span>{html.escape(item['severity'].upper())}</span>
            <h2>{html.escape(item['checkId'])}: {html.escape(item['kind'])}</h2>
          </header>
          <p>{html.escape(item['message'])}</p>
          <div class="cols">
            <div><h3>Baseline</h3><pre>{html.escape(old_value)}</pre></div>
            <div><h3>New Run</h3><pre>{html.escape(new_value)}</pre></div>
          </div>
          {"<h3>Patch</h3><pre>" + html.escape(patch) + "</pre>" if patch else ""}
        </section>
        """)
    if not rows:
        rows.append('<section class="empty">No differences found. Regression passed.</section>')
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Regression Report</title>
    <style>
      body {{ margin: 0; font-family: Arial, sans-serif; background: #f6f7f9; color: #1c2430; }}
      main {{ max-width: 1180px; margin: 0 auto; padding: 32px; }}
      .summary {{ background: white; border: 1px solid #dfe4ea; padding: 18px; border-radius: 8px; }}
      .diff {{ background: white; border: 1px solid #dfe4ea; margin-top: 16px; border-radius: 8px; overflow: hidden; }}
      .diff header {{ display: flex; gap: 12px; align-items: center; padding: 14px 18px; border-bottom: 1px solid #eef1f5; }}
      .diff header span {{ font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 999px; }}
      .diff.fail header span {{ background: #ffd9d9; color: #9f1d1d; }}
      .diff.review header span {{ background: #fff0bf; color: #785c00; }}
      .diff h2 {{ font-size: 16px; margin: 0; }}
      .diff h3 {{ font-size: 13px; margin: 0 0 8px; }}
      .diff p {{ padding: 0 18px; }}
      .cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 18px 18px; }}
      pre {{ background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; overflow: auto; font-size: 12px; line-height: 1.45; }}
      .empty {{ background: white; margin-top: 16px; padding: 20px; border-radius: 8px; border: 1px solid #dfe4ea; }}
      @media (max-width: 800px) {{ .cols {{ grid-template-columns: 1fr; }} main {{ padding: 18px; }} }}
    </style>
  </head>
  <body>
    <main>
      <section class="summary">
        <h1>Full-Stack Regression Report</h1>
        <p><strong>Scenario:</strong> {html.escape(run["scenario"])}</p>
        <p><strong>Baseline:</strong> {html.escape(baseline["capturedAt"])}</p>
        <p><strong>New run:</strong> {html.escape(run["capturedAt"])}</p>
        <p><strong>Differences:</strong> {len(diffs)}</p>
      </section>
      {''.join(rows)}
    </main>
  </body>
</html>"""


def main():
    parser = argparse.ArgumentParser(description="Full-stack regression MVP")
    sub = parser.add_subparsers(dest="command", required=True)

    snapshot_cmd = sub.add_parser("snapshot")
    snapshot_cmd.add_argument("--scenario", required=True)
    snapshot_cmd.add_argument("--base-url", required=True)
    snapshot_cmd.add_argument("--out", required=True)
    snapshot_cmd.set_defaults(func=snapshot)

    approve_cmd = sub.add_parser("approve")
    approve_cmd.add_argument("--run", required=True)
    approve_cmd.add_argument("--baseline", required=True)
    approve_cmd.set_defaults(func=approve)

    compare_cmd = sub.add_parser("compare")
    compare_cmd.add_argument("--baseline", required=True)
    compare_cmd.add_argument("--run", required=True)
    compare_cmd.add_argument("--report", required=True)
    compare_cmd.set_defaults(func=compare)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
