import json
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import discover

UI_DIR = ROOT / "ui"
RUNS_DIR = ROOT / "runs"
BASELINES_DIR = ROOT / "baselines"
REPORTS_DIR = ROOT / "reports"
DEFAULT_CONFIG = ROOT / "discovery" / "target-java.json"
DEFAULT_BASELINE = BASELINES_DIR / "discovery-target-java"


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def safe_child_dir(parent, name):
    if not name or any(part in name for part in ["..", "/", "\\"]):
        raise ValueError("Некорректное имя папки")
    path = (parent / name).resolve()
    parent = parent.resolve()
    if not str(path).startswith(str(parent)):
        raise ValueError("Путь выходит за пределы рабочей папки")
    return path


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False, sort_keys=True)


def latest_dir(parent, filename):
    if not parent.exists():
        return None
    candidates = [item for item in parent.iterdir() if (item / filename).exists()]
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item / filename).stat().st_mtime)


def latest_report_json():
    if not REPORTS_DIR.exists():
        return None
    candidates = list(REPORTS_DIR.glob("*.json"))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def read_meta(run_dir):
    meta_path = run_dir / "run-meta.json"
    if not meta_path.exists():
        return {}
    try:
        return read_json(meta_path)
    except json.JSONDecodeError:
        return {}


def read_error(run_dir):
    error_path = run_dir / "run-error.json"
    if not error_path.exists():
        return None
    try:
        return read_json(error_path)
    except json.JSONDecodeError:
        return {"message": error_path.read_text(encoding="utf-8", errors="replace")}


def graph_base_url(graph):
    return (graph or {}).get("baseUrl", "").rstrip("/")


def selected_run_and_baseline():
    default_run = RUNS_DIR / "discovery-target-java-v2"
    if (default_run / "discovery.json").exists() and (DEFAULT_BASELINE / "discovery.json").exists():
        fallback = (default_run, DEFAULT_BASELINE)
    else:
        fallback = (latest_dir(RUNS_DIR, "discovery.json"), latest_dir(BASELINES_DIR, "discovery.json"))

    if not RUNS_DIR.exists():
        return fallback

    candidates = [item for item in RUNS_DIR.iterdir() if (item / "discovery.json").exists() and (item / "run-meta.json").exists()]
    if not candidates:
        return fallback

    run_dir = max(candidates, key=lambda item: (item / "discovery.json").stat().st_mtime)
    meta = read_meta(run_dir)
    baseline_name = meta.get("baselineName")
    baseline_dir = BASELINES_DIR / baseline_name if baseline_name else fallback[1]
    if not baseline_dir or not (baseline_dir / "discovery.json").exists():
        baseline_dir = fallback[1]
    return run_dir, baseline_dir


def node_id(prefix, path):
    safe = path.strip("/") or "root"
    safe = "".join(ch if ch.isalnum() else "-" for ch in safe).strip("-") or "root"
    return f"{prefix}-{safe}"


def artifact_json(run_dir, item):
    artifact = item.get("artifact")
    if not artifact:
        return None
    path = run_dir / "artifacts" / artifact
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text[:4000]


def diff_bucket(diffs):
    by_entity = {}
    collection_removed = {"pages": set(), "apiEndpoints": set()}
    collection_added = {"pages": set(), "apiEndpoints": set()}

    for item in diffs:
        entity = item.get("entity", "")
        if entity in {"pages", "apiEndpoints"} and item.get("kind") in {"removed", "added"}:
            key = item.get("old") or item.get("new")
            if item.get("kind") == "removed":
                collection_removed[entity].add(key)
            else:
                collection_added[entity].add(key)
            by_entity.setdefault(f"{entity}:{key}", []).append(item)
            continue
        by_entity.setdefault(entity, []).append(item)
    return by_entity, collection_removed, collection_added


def severity_for(items, exists_old=True, exists_new=True):
    if exists_old and not exists_new:
        return "removed"
    if not exists_old and exists_new:
        return "changed"
    if any(item.get("severity") == "fail" for item in items):
        return "fail"
    if items:
        return "changed"
    return "ok"


def short_message(items, fallback):
    if not items:
        return fallback
    return items[0].get("message", fallback)


def review_diff(item):
    severity = item.get("severity", "review")
    if severity == "review":
        severity = "changed"
    return {
        "severity": severity,
        "title": item.get("message", "Изменение требует ревью"),
        "text": f"{item.get('entity', '')}: {item.get('kind', '')}",
        "old": item.get("old"),
        "new": item.get("new"),
        "patch": item.get("patch", []),
    }


def build_page_node(path, old_page, new_page, items, index):
    current = new_page or old_page or {}
    status = severity_for(items, old_page is not None, new_page is not None)
    return {
        "id": node_id("page", path),
        "type": "page",
        "label": path,
        "title": current.get("title") or path,
        "status": status,
        "x": 42,
        "y": 46 + index * 130,
        "summary": short_message(items, f"Page snapshot: {current.get('status', '-')}."),
        "details": {
            "url": current.get("url", path),
            "method": "GET",
            "baselineStatus": old_page.get("status") if old_page else "not discovered",
            "currentStatus": new_page.get("status") if new_page else "not discovered",
            "headers": {},
            "payload": None,
            "schema": "HTML page snapshot",
            "visibleTextDiff": visible_diff(old_page, new_page),
            "response": {
                "baseline": old_page.get("visibleText", []) if old_page else None,
                "current": new_page.get("visibleText", []) if new_page else None,
            },
            "diffs": [review_diff(item) for item in items],
        },
    }


def build_api_node(path, old_api, new_api, items, index, baseline_dir, run_dir):
    current = new_api or old_api or {}
    status = severity_for(items, old_api is not None, new_api is not None)
    return {
        "id": node_id("api", path),
        "type": "endpoint",
        "label": f"GET {path}",
        "title": path,
        "status": status,
        "x": 390 + (index % 2) * 320,
        "y": 46 + (index // 2) * 130,
        "summary": short_message(items, f"API snapshot: {current.get('status', '-')}."),
        "details": {
            "url": current.get("url", path),
            "method": "GET",
            "baselineStatus": old_api.get("status") if old_api else "not discovered",
            "currentStatus": new_api.get("status") if new_api else "not discovered",
            "requestHeaders": {"user-agent": "autonomous-discovery-mvp/0.1"},
            "responseHeaders": {},
            "payload": {"baseline": None, "current": None},
            "response": {
                "baseline": artifact_json(baseline_dir, old_api) if old_api else None,
                "current": artifact_json(run_dir, new_api) if new_api else None,
            },
            "schema": {
                "baseline": old_api.get("schema") if old_api else None,
                "current": new_api.get("schema") if new_api else None,
            },
            "diffs": [review_diff(item) for item in items],
        },
    }


def visible_diff(old_page, new_page):
    if not old_page or not new_page:
        return []
    old = old_page.get("visibleText", [])
    new = new_page.get("visibleText", [])
    return list(discover.difflib.unified_diff(old, new, lineterm=""))


def build_edges(graph, nodes):
    known = {node["label"]: node["id"] for node in nodes}
    result = []
    seen = set()
    for edge in graph.get("edges", []):
        source = edge.get("from")
        target = edge.get("target")
        if source not in known or target not in known:
            continue
        pair = [known[source], known[target]]
        key = tuple(pair)
        if key not in seen:
            seen.add(key)
            result.append(pair)
    return result


def build_state():
    run_dir, baseline_dir = selected_run_and_baseline()

    if not baseline_dir or not run_dir:
        return empty_state()

    baseline = read_json(baseline_dir / "discovery.json")
    current = read_json(run_dir / "discovery.json")
    diffs = discover.compare_graphs(baseline, current)
    by_entity, removed, added = diff_bucket(diffs)

    nodes = []
    page_paths = sorted(set(baseline.get("pages", {})) | set(current.get("pages", {})))
    for index, path in enumerate(page_paths):
        items = by_entity.get(f"page:{path}", [])
        items += by_entity.get(f"pages:{path}", [])
        nodes.append(build_page_node(path, baseline.get("pages", {}).get(path), current.get("pages", {}).get(path), items, index))

    api_paths = sorted(set(baseline.get("apiEndpoints", {})) | set(current.get("apiEndpoints", {})))
    for index, path in enumerate(api_paths):
        items = by_entity.get(f"api:{path}", [])
        items += by_entity.get(f"apiEndpoints:{path}", [])
        nodes.append(build_api_node(path, baseline.get("apiEndpoints", {}).get(path), current.get("apiEndpoints", {}).get(path), items, index, baseline_dir, run_dir))

    fail_count = sum(1 for item in diffs if item.get("severity") == "fail")
    report = latest_report_json()
    target = target_from_config(current.get("baseUrl", ""))
    current_summary = {**current.get("summary", {}), "diffs": len(diffs), "critical": fail_count}
    return {
        "project": current.get("name", "Regression Graph"),
        "mode": "live",
        "target": target,
        "baseline": {
            "id": baseline_dir.name,
            "label": baseline_dir.name,
            "capturedAt": baseline.get("capturedAt", ""),
            "summary": baseline.get("summary", {}),
        },
        "current": {
            "id": run_dir.name,
            "label": run_dir.name,
            "capturedAt": current.get("capturedAt", ""),
            "summary": current_summary,
            "reportUrl": f"/reports/{report.name}" if report else None,
        },
        "runs": list_runs(run_dir, len(diffs), fail_count),
        "nodes": nodes,
        "edges": build_edges(current, nodes),
    }


def target_from_config(base_url):
    config = read_json(DEFAULT_CONFIG) if DEFAULT_CONFIG.exists() else {}
    limits = config.get("limits", {})
    return {
        "project": config.get("name", "target"),
        "environment": "Local/Staging",
        "baseUrl": base_url,
        "authProfile": "No auth",
        "policy": "GET only",
        "startUrls": config.get("startPaths", ["/"]),
        "seedApiPaths": config.get("seedApiPaths", []),
        "limits": {
            "maxPages": limits.get("maxPages", 20),
            "maxDepth": limits.get("maxDepth", 2),
            "rateLimitMs": limits.get("rateLimitMs", 150),
            "requestTimeoutSec": limits.get("requestTimeoutSec", 10),
            "overallTimeoutSec": limits.get("overallTimeoutSec", 300),
            "maxActionsPerPage": 0,
        },
        "guardrails": [
            {"title": "Лимит запросов", "text": "Discovery runner делает паузы между запросами и не запускает опасные методы."},
            {"title": "Политика действий", "text": "Текущий MVP использует только GET и seed API endpoints из конфигурации."},
            {"title": "Baseline", "text": "Любой успешный run можно утвердить как новый baseline через API."},
            {"title": "Артефакты", "text": "HTML/JSON ответы сохраняются в runs/<run>/artifacts и доступны для ревью."},
        ],
    }


def list_runs(current_run_dir, diff_count, fail_count):
    rows = []
    if RUNS_DIR.exists():
        for item in sorted(RUNS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            graph_path = item / "discovery.json"
            error = read_error(item)
            if not graph_path.exists() and not error:
                continue
            graph = read_json(graph_path) if graph_path.exists() else {}
            meta = read_meta(item)
            is_current = item == current_run_dir
            run_diff_count = diff_count if is_current else 0
            status = "fail" if error or (is_current and fail_count) else "changed" if is_current and diff_count else "passed"
            rows.append({
                "id": item.name,
                "label": item.name,
                "environment": graph.get("baseUrl", "") or meta.get("baseUrl", ""),
                "startedAt": graph.get("capturedAt", ""),
                "pages": graph.get("summary", {}).get("pages", 0),
                "endpoints": graph.get("summary", {}).get("apiEndpoints", 0),
                "diffs": run_diff_count,
                "status": status,
                "error": error,
            })
    return rows


def empty_state():
    return {
        "project": "Regression Graph",
        "mode": "empty",
        "target": target_from_config(""),
        "baseline": {"id": None, "label": "Нет baseline", "capturedAt": "", "summary": {"pages": 0, "apiEndpoints": 0, "edges": 0}},
        "current": {"id": None, "label": "Нет run", "capturedAt": "", "summary": {"pages": 0, "apiEndpoints": 0, "edges": 0, "diffs": 0, "critical": 0}},
        "runs": list_runs(None, 0, 0),
        "nodes": [],
        "edges": [],
    }


def make_temp_config(payload):
    config = read_json(DEFAULT_CONFIG) if DEFAULT_CONFIG.exists() else {}
    config["name"] = payload.get("name") or config.get("name", "custom-discovery")
    config["startPaths"] = payload.get("startPaths") or ["/"]
    config["seedApiPaths"] = payload.get("seedApiPaths") or []
    limits = config.setdefault("limits", {})
    limits["maxPages"] = int(payload.get("maxPages") or limits.get("maxPages", 20))
    limits["maxDepth"] = int(payload.get("maxDepth") or limits.get("maxDepth", 2))
    limits["rateLimitMs"] = int(payload.get("rateLimitMs") or limits.get("rateLimitMs", 150))
    limits["requestTimeoutSec"] = int(payload.get("requestTimeoutSec") or limits.get("requestTimeoutSec", 10))
    limits["overallTimeoutSec"] = int(payload.get("overallTimeoutSec") or limits.get("overallTimeoutSec", 300))
    config["allowedPathPrefixes"] = payload.get("allowedPathPrefixes") or ["/", "/api/"]
    path = ROOT / ".runtime" / "last-discovery-config.json"
    write_json(path, config)
    return path


def run_discovery(payload):
    base_url = payload.get("baseUrl", "").strip()
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("baseUrl должен начинаться с http:// или https://")
    config_path = make_temp_config(payload)
    run_name = payload.get("runName") or f"ui-run-{time.strftime('%Y%m%d-%H%M%S')}"
    run_dir = safe_child_dir(RUNS_DIR, run_name)
    baseline_name = payload.get("baselineName") or "ui-baseline"
    baseline_dir = safe_child_dir(BASELINES_DIR, baseline_name)
    write_json(run_dir / "run-meta.json", {
        "baseUrl": base_url,
        "baselineName": baseline_name,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "product-ui",
    })
    command = [
        sys.executable,
        str(ROOT / "discover.py"),
        "discover",
        "--config",
        str(config_path),
        "--base-url",
        base_url,
        "--out",
        str(run_dir),
    ]
    overall_timeout_sec = int(payload.get("overallTimeoutSec") or read_json(config_path).get("limits", {}).get("overallTimeoutSec", 300))
    try:
        completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=overall_timeout_sec)
    except subprocess.TimeoutExpired as exc:
        message = format_timeout_error(base_url, run_name, overall_timeout_sec, exc)
        write_run_error(run_dir, base_url, message, "timeout", command)
        raise RuntimeError(message)
    if completed.returncode != 0:
        message = format_discovery_error(completed.stderr or completed.stdout or f"Discovery failed with {completed.returncode}")
        write_run_error(run_dir, base_url, message, "process_error", command)
        raise RuntimeError(message)

    baseline_exists = (baseline_dir / "discovery.json").exists()
    baseline_graph = read_json(baseline_dir / "discovery.json") if baseline_exists else None
    base_url_changed = baseline_exists and graph_base_url(baseline_graph) != base_url.rstrip("/")
    should_approve = payload.get("approveAsBaseline") or not baseline_exists or base_url_changed

    if should_approve:
        if baseline_dir.exists():
            shutil.rmtree(baseline_dir)
        shutil.copytree(run_dir, baseline_dir)
        baseline_action = "approved_first_baseline" if not baseline_exists or base_url_changed else "approved"
    else:
        report_path = REPORTS_DIR / f"{run_name}-report.html"
        diffs = discover.compare_graphs(read_json(baseline_dir / "discovery.json"), read_json(run_dir / "discovery.json"))
        report_path.write_text(discover.render_report(read_json(baseline_dir / "discovery.json"), read_json(run_dir / "discovery.json"), diffs), encoding="utf-8")
        write_json(report_path.with_suffix(".json"), diffs)
        baseline_action = "compared"

    return {"ok": True, "run": run_name, "baseline": baseline_name, "action": baseline_action, "stdout": completed.stdout}


def write_run_error(run_dir, base_url, message, kind, command):
    write_json(run_dir / "run-error.json", {
        "kind": kind,
        "message": message,
        "baseUrl": base_url,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "command": command,
    })


def format_discovery_error(message):
    if "WinError 10013" in message:
        return (
            "Windows запретил исходящее сетевое подключение: WinError 10013. "
            "Если ты запускаешь UI из Codex-сессии, внешний интернет может быть заблокирован sandbox-политикой. "
            "Останови сервер и запусти run_product_ui.bat обычным двойным кликом или из обычного PowerShell, "
            "а затем повтори discovery для сайта, на который у тебя есть разрешение. "
            f"Исходная ошибка: {message.strip()}"
        )
    return message.strip()


def format_timeout_error(base_url, run_name, timeout_sec, exc):
    return (
        f"Discovery run '{run_name}' для {base_url} не уложился в общий лимит {timeout_sec} секунд. "
        "Для внешних сайтов это обычно значит, что crawler набрал слишком много страниц или часть URL долго отвечает. "
        "Попробуй уменьшить Максимум pages до 3-5, Max depth до 1, очистить seed API endpoints, "
        "поставить timeout одного запроса 5 секунд или увеличить общий timeout до 300-600 секунд. "
        f"Техническая ошибка: {exc}"
    )


def approve_run(payload):
    run_id = payload.get("runId")
    baseline_name = payload.get("baselineName") or "ui-baseline"
    if not run_id:
        raise ValueError("runId is required")
    run_dir = safe_child_dir(RUNS_DIR, run_id)
    if not (run_dir / "discovery.json").exists():
        raise ValueError(f"Run not found: {run_id}")
    baseline_dir = safe_child_dir(BASELINES_DIR, baseline_name)
    if baseline_dir.exists():
        shutil.rmtree(baseline_dir)
    shutil.copytree(run_dir, baseline_dir)
    return {"ok": True, "baseline": baseline_name, "run": run_id}


def delete_run(payload):
    run_id = payload.get("runId")
    if not run_id:
        raise ValueError("runId is required")
    run_dir = safe_child_dir(RUNS_DIR, run_id)
    if not run_dir.exists() or not ((run_dir / "discovery.json").exists() or (run_dir / "run-error.json").exists()):
        raise ValueError(f"Run not found: {run_id}")
    shutil.rmtree(run_dir)
    return {"ok": True, "deleted": run_id}


class ProductHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path in {"/", "/ui", "/ui/"}:
            return self.send_file(UI_DIR / "index.html", "text/html; charset=utf-8")
        if path == "/api/state":
            return self.send_json(build_state())
        if path in {"/app.js", "/styles.css", "/sample-data.js"}:
            return self.send_static(UI_DIR, path.removeprefix("/"))
        if path.startswith("/ui/"):
            return self.send_static(UI_DIR, path.removeprefix("/ui/"))
        if path.startswith("/reports/"):
            return self.send_static(REPORTS_DIR, path.removeprefix("/reports/"))
        self.send_error(404)

    def do_POST(self):
        try:
            payload = self.read_payload()
            if self.path == "/api/discovery/run":
                return self.send_json(run_discovery(payload))
            if self.path == "/api/baseline/approve":
                return self.send_json(approve_run(payload))
            if self.path == "/api/runs/delete":
                return self.send_json(delete_run(payload))
            self.send_error(404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)

    def read_payload(self):
        length = int(self.headers.get("content-length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_static(self, root, relative):
        target = (root / relative).resolve()
        root = root.resolve()
        if not str(target).startswith(str(root)) or not target.exists() or not target.is_file():
            return self.send_error(404)
        content_type = "text/plain; charset=utf-8"
        if target.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif target.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif target.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif target.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        return self.send_file(target, content_type)

    def send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[product-ui] {self.address_string()} {fmt % args}")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), ProductHandler)
    print(f"Product UI server: http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
