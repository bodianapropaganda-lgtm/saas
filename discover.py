import argparse
import difflib
import html
import json
import re
import shutil
import time
from collections import deque
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
UUIDISH_RE = re.compile(r"\b(?:req-|id-)?[a-fA-F0-9]{8,}\b")
WHITESPACE_RE = re.compile(r"\s+")


class DiscoveryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.text = []
        self.links = []
        self.forms = []
        self.assets = []
        self.api_hints = []
        self.buttons = []
        self._ignore_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        self.tags.append(tag)

        if tag in {"script", "style", "noscript"}:
            self._ignore_depth += 1

        href = attrs_dict.get("href")
        src = attrs_dict.get("src")
        action = attrs_dict.get("action")
        data_api = attrs_dict.get("data-api")

        if tag == "a" and href:
            self.links.append(href)
        if tag == "form":
            self.forms.append({
                "method": attrs_dict.get("method", "GET").upper(),
                "action": action or "",
            })
        if tag in {"img", "script"} and src:
            self.assets.append(src)
        if tag == "link" and href:
            self.assets.append(href)
        if tag == "button":
            self.buttons.append({
                "type": attrs_dict.get("type", "button"),
                "dataApi": data_api,
            })
        if data_api:
            self.api_hints.append(data_api)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self._ignore_depth:
            self._ignore_depth -= 1

    def handle_data(self, data):
        if self._ignore_depth:
            return
        cleaned = WHITESPACE_RE.sub(" ", data).strip()
        if cleaned:
            self.text.append(normalize_scalar(cleaned))


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False, sort_keys=True)


def normalize_scalar(value):
    if isinstance(value, str):
        value = TIMESTAMP_RE.sub("<timestamp>", value)
        value = UUIDISH_RE.sub("<id>", value)
    return value


def normalize_json(value):
    noisy_keys = {"generatedAt", "updatedAt", "createdAt", "requestId", "traceId", "sessionId"}
    if isinstance(value, dict):
        normalized = {}
        for key, child in value.items():
            normalized[key] = "<ignored>" if key in noisy_keys else normalize_json(child)
        return normalized
    if isinstance(value, list):
        return [normalize_json(item) for item in value]
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


def fetch(url):
    started = time.time()
    request = Request(url, headers={"user-agent": "autonomous-discovery-mvp/0.1"})
    try:
        with urlopen(request, timeout=10) as response:
            body = response.read()
            return {
                "url": url,
                "status": response.status,
                "headers": dict(response.headers.items()),
                "elapsedMs": round((time.time() - started) * 1000, 2),
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


def canonical_path(base_url, value):
    if not value:
        return None
    absolute = urljoin(base_url, value)
    parsed_base = urlparse(base_url)
    parsed = urlparse(absolute)
    if parsed.netloc != parsed_base.netloc:
        return None
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def allowed_path(path, prefixes):
    return any(path == prefix or path.startswith(prefix) for prefix in prefixes)


def count_values(values):
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def extract_title(markup):
    match = re.search(r"<title[^>]*>(.*?)</title>", markup, flags=re.I | re.S)
    if not match:
        return ""
    return WHITESPACE_RE.sub(" ", html.unescape(match.group(1))).strip()


def discover(args):
    config = read_json(args.config)
    out_dir = Path(args.out)
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    limits = config.get("limits", {})
    max_pages = int(limits.get("maxPages", 20))
    max_depth = int(limits.get("maxDepth", 2))
    rate_limit_ms = int(limits.get("rateLimitMs", 0))
    allowed_prefixes = config.get("allowedPathPrefixes", ["/"])

    pages = {}
    api_endpoints = {}
    edges = []
    edge_seen = set()
    queue = deque((path, 0, "seed") for path in config.get("startPaths", ["/"]))
    queued = {path for path in config.get("startPaths", ["/"])}
    api_queue = deque(config.get("seedApiPaths", []))
    queued_apis = set(config.get("seedApiPaths", []))

    while queue and len(pages) < max_pages:
        path, depth, source = queue.popleft()
        if path in pages or not allowed_path(path, allowed_prefixes):
            continue
        if rate_limit_ms:
            time.sleep(rate_limit_ms / 1000)

        url = urljoin(args.base_url, path)
        response = fetch(url)
        parser = DiscoveryParser()
        parser.feed(response["bodyText"])
        artifact_name = page_artifact_name(path)
        (artifacts_dir / artifact_name).write_text(response["bodyText"], encoding="utf-8")

        pages[path] = {
            "path": path,
            "url": url,
            "source": source,
            "status": response["status"],
            "elapsedMs": response["elapsedMs"],
            "bodyBytes": response["bodyBytes"],
            "artifact": artifact_name,
            "title": extract_title(response["bodyText"]),
            "visibleText": parser.text,
            "tagCounts": count_values(parser.tags),
            "links": sorted(set(parser.links)),
            "forms": parser.forms,
            "assets": sorted(set(parser.assets)),
            "buttons": parser.buttons,
            "apiHints": sorted(set(parser.api_hints)),
        }

        for href in parser.links:
            linked_path = canonical_path(args.base_url, href)
            if not linked_path:
                continue
            add_edge(edges, edge_seen, {"from": path, "type": "link", "target": linked_path})
            if depth < max_depth and linked_path not in queued and not linked_path.startswith("/api/"):
                queue.append((linked_path, depth + 1, f"link:{path}"))
                queued.add(linked_path)

        for api_hint in parser.api_hints:
            api_path = canonical_path(args.base_url, api_hint)
            if api_path and api_path not in queued_apis and allowed_path(api_path, allowed_prefixes):
                api_queue.append(api_path)
                queued_apis.add(api_path)
            if api_path:
                add_edge(edges, edge_seen, {"from": path, "type": "api-hint", "target": api_path})

        for form in parser.forms:
            action_path = canonical_path(args.base_url, form.get("action"))
            if action_path:
                add_edge(edges, edge_seen, {"from": path, "type": f"form:{form.get('method')}", "target": action_path})

    while api_queue:
        api_path = api_queue.popleft()
        if api_path in api_endpoints or not allowed_path(api_path, allowed_prefixes):
            continue
        if rate_limit_ms:
            time.sleep(rate_limit_ms / 1000)
        api_endpoints[api_path] = capture_api(args.base_url, api_path, artifacts_dir)

    graph = {
        "name": config.get("name", "discovery-run"),
        "baseUrl": args.base_url,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "limits": limits,
        "pages": pages,
        "apiEndpoints": api_endpoints,
        "edges": edges,
        "summary": {
            "pages": len(pages),
            "apiEndpoints": len(api_endpoints),
            "edges": len(edges),
        },
    }
    write_json(out_dir / "discovery.json", graph)
    print(f"Discovery graph saved to {out_dir / 'discovery.json'}")
    print(f"Pages: {len(pages)}")
    print(f"API endpoints: {len(api_endpoints)}")
    print(f"Edges: {len(edges)}")


def page_artifact_name(path):
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", path.strip("/") or "root")
    return f"page-{safe}.html"


def add_edge(edges, seen, edge):
    key = edge_key(edge)
    if key in seen:
        return
    seen.add(key)
    edges.append(edge)


def api_artifact_name(path):
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", path.strip("/") or "root")
    return f"api-{safe}.json"


def capture_api(base_url, path, artifacts_dir):
    url = urljoin(base_url, path)
    response = fetch(url)
    artifact_name = api_artifact_name(path)
    (artifacts_dir / artifact_name).write_text(response["bodyText"], encoding="utf-8")
    try:
        parsed = json.loads(response["bodyText"])
        normalized = normalize_json(parsed)
        schema = json_schema(parsed)
    except json.JSONDecodeError:
        normalized = normalize_scalar(response["bodyText"])
        schema = "text"
    return {
        "path": path,
        "url": url,
        "status": response["status"],
        "elapsedMs": response["elapsedMs"],
        "bodyBytes": response["bodyBytes"],
        "artifact": artifact_name,
        "normalizedBody": normalized,
        "schema": schema,
    }


def approve(args):
    run_dir = Path(args.run)
    baseline_dir = Path(args.baseline)
    if not (run_dir / "discovery.json").exists():
        raise SystemExit(f"No discovery.json in {run_dir}")
    if baseline_dir.exists():
        shutil.rmtree(baseline_dir)
    shutil.copytree(run_dir, baseline_dir)
    print(f"Discovery baseline updated at {baseline_dir}")


def compare(args):
    baseline = read_json(Path(args.baseline) / "discovery.json")
    run = read_json(Path(args.run) / "discovery.json")
    diffs = compare_graphs(baseline, run)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(baseline, run, diffs), encoding="utf-8")
    write_json(report_path.with_suffix(".json"), diffs)
    print(f"Discovery report saved to {report_path}")
    print(f"Diffs found: {len(diffs)}")
    if any(item["severity"] == "fail" for item in diffs):
        raise SystemExit(2)


def compare_graphs(old, new):
    diffs = []
    compare_collection_keys(diffs, "pages", old.get("pages", {}), new.get("pages", {}))
    compare_collection_keys(diffs, "apiEndpoints", old.get("apiEndpoints", {}), new.get("apiEndpoints", {}))

    for path in sorted(set(old.get("pages", {})) & set(new.get("pages", {}))):
        old_page = old["pages"][path]
        new_page = new["pages"][path]
        for field in ["status", "title", "tagCounts", "visibleText"]:
            if old_page.get(field) != new_page.get(field):
                patch = []
                if field == "visibleText":
                    patch = list(difflib.unified_diff(old_page.get(field, []), new_page.get(field, []), lineterm=""))
                diffs.append(diff(f"page:{path}", field, "review", old_page.get(field), new_page.get(field), f"Page {field} changed", patch))

    for path in sorted(set(old.get("apiEndpoints", {})) & set(new.get("apiEndpoints", {}))):
        old_api = old["apiEndpoints"][path]
        new_api = new["apiEndpoints"][path]
        if old_api.get("status") != new_api.get("status"):
            diffs.append(diff(f"api:{path}", "status", "fail", old_api.get("status"), new_api.get("status"), "API status changed"))
        if old_api.get("schema") != new_api.get("schema"):
            diffs.append(diff(f"api:{path}", "schema", "fail", old_api.get("schema"), new_api.get("schema"), "API schema changed"))
        if old_api.get("normalizedBody") != new_api.get("normalizedBody"):
            patch = list(difflib.unified_diff(
                json.dumps(old_api.get("normalizedBody"), indent=2, sort_keys=True).splitlines(),
                json.dumps(new_api.get("normalizedBody"), indent=2, sort_keys=True).splitlines(),
                lineterm="",
            ))
            diffs.append(diff(f"api:{path}", "body", "review", old_api.get("normalizedBody"), new_api.get("normalizedBody"), "API body changed", patch))

    old_edges = sorted(edge_key(edge) for edge in old.get("edges", []))
    new_edges = sorted(edge_key(edge) for edge in new.get("edges", []))
    if old_edges != new_edges:
        patch = list(difflib.unified_diff(old_edges, new_edges, lineterm=""))
        diffs.append(diff("graph", "edges", "review", old_edges, new_edges, "Discovery graph edges changed", patch))

    return diffs


def compare_collection_keys(diffs, name, old_items, new_items):
    old_keys = set(old_items)
    new_keys = set(new_items)
    for key in sorted(old_keys - new_keys):
        diffs.append(diff(name, "removed", "fail", key, None, f"{name} item removed: {key}"))
    for key in sorted(new_keys - old_keys):
        diffs.append(diff(name, "added", "review", None, key, f"{name} item added: {key}"))


def edge_key(edge):
    return f"{edge.get('from')} --{edge.get('type')}--> {edge.get('target')}"


def diff(entity, kind, severity, old, new, message, patch=None):
    return {
        "entity": entity,
        "kind": kind,
        "severity": severity,
        "message": message,
        "old": old,
        "new": new,
        "patch": patch or [],
    }


def render_report(baseline, run, diffs):
    sections = []
    for item in diffs:
        old_value = json.dumps(item["old"], indent=2, ensure_ascii=False, sort_keys=True)
        new_value = json.dumps(item["new"], indent=2, ensure_ascii=False, sort_keys=True)
        patch = "\n".join(item["patch"])
        sections.append(f"""
        <section class="diff {html.escape(item['severity'])}">
          <header><span>{html.escape(item['severity'].upper())}</span><h2>{html.escape(item['entity'])}: {html.escape(item['kind'])}</h2></header>
          <p>{html.escape(item['message'])}</p>
          <div class="cols">
            <div><h3>Baseline</h3><pre>{html.escape(old_value)}</pre></div>
            <div><h3>New Run</h3><pre>{html.escape(new_value)}</pre></div>
          </div>
          {"<h3>Patch</h3><pre>" + html.escape(patch) + "</pre>" if patch else ""}
        </section>
        """)
    if not sections:
        sections.append('<section class="empty">No differences found. Discovery regression passed.</section>')

    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Discovery Regression Report</title>
    <style>
      body {{ margin: 0; font-family: Arial, sans-serif; background: #f6f7f9; color: #1c2430; }}
      main {{ max-width: 1180px; margin: 0 auto; padding: 32px; }}
      .summary, .diff, .empty {{ background: white; border: 1px solid #dfe4ea; border-radius: 8px; }}
      .summary {{ padding: 18px; }}
      .diff {{ margin-top: 16px; overflow: hidden; }}
      .diff header {{ display: flex; gap: 12px; align-items: center; padding: 14px 18px; border-bottom: 1px solid #eef1f5; }}
      .diff header span {{ font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 999px; }}
      .diff.fail header span {{ background: #ffd9d9; color: #9f1d1d; }}
      .diff.review header span {{ background: #fff0bf; color: #785c00; }}
      .diff h2 {{ font-size: 16px; margin: 0; }}
      .diff h3 {{ font-size: 13px; margin: 12px 18px 8px; }}
      .diff p {{ padding: 0 18px; }}
      .cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 18px 18px; }}
      pre {{ background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; overflow: auto; font-size: 12px; line-height: 1.45; }}
      .empty {{ margin-top: 16px; padding: 20px; }}
      @media (max-width: 800px) {{ .cols {{ grid-template-columns: 1fr; }} main {{ padding: 18px; }} }}
    </style>
  </head>
  <body>
    <main>
      <section class="summary">
        <h1>Discovery Regression Report</h1>
        <p><strong>Scenario:</strong> {html.escape(run.get("name", ""))}</p>
        <p><strong>Baseline:</strong> {html.escape(baseline.get("capturedAt", ""))}</p>
        <p><strong>New run:</strong> {html.escape(run.get("capturedAt", ""))}</p>
        <p><strong>Baseline graph:</strong> {baseline.get("summary", {})}</p>
        <p><strong>New graph:</strong> {run.get("summary", {})}</p>
        <p><strong>Differences:</strong> {len(diffs)}</p>
      </section>
      {''.join(sections)}
    </main>
  </body>
</html>"""


def main():
    parser = argparse.ArgumentParser(description="Autonomous discovery MVP")
    sub = parser.add_subparsers(dest="command", required=True)

    discover_cmd = sub.add_parser("discover")
    discover_cmd.add_argument("--config", required=True)
    discover_cmd.add_argument("--base-url", required=True)
    discover_cmd.add_argument("--out", required=True)
    discover_cmd.set_defaults(func=discover)

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
