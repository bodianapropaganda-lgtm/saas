import argparse
import json
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import discover


NETWORK_RESOURCE_TYPES = {"fetch", "xhr"}
API_CONTENT_TYPES = ("application/json", "text/json", "application/problem+json", "text/plain")
CLICKABLE_SELECTOR = "a, button, [role=button], input[type=button], input[type=submit], [onclick]"
UNSAFE_ACTION_WORDS = {
    "delete", "remove", "logout", "log out", "sign out", "pay", "payment", "purchase",
    "order", "checkout", "submit", "confirm", "cancel", "disable", "deactivate",
    "удал", "выйти", "оплат", "заказ", "подтверд", "отмен", "отключ",
}
SYSTEM_BROWSER_CANDIDATES = [
    Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
    Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
    Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
    Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
]


def read_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False, sort_keys=True)


def canonical_path(base_url, value):
    absolute = urljoin(base_url, value)
    parsed_base = urlparse(base_url)
    parsed = urlparse(absolute)
    if parsed.netloc != parsed_base.netloc:
        return None
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def response_content_type(response):
    return (response.headers.get("content-type") or "").split(";")[0].lower()


def should_capture_response(response):
    request = response.request
    content_type = response_content_type(response)
    if request.resource_type in NETWORK_RESOURCE_TYPES:
        return True
    return any(content_type.startswith(item) for item in API_CONTENT_TYPES)


def safe_action_text(value):
    text = discover.normalize_scalar(value or "").lower()
    if not text:
        return ""
    if len(text) > 120:
        text = text[:120]
    if any(word in text for word in UNSAFE_ACTION_WORDS):
        return ""
    return text


def same_origin_url(base_url, value):
    if not value:
        return True
    parsed_base = urlparse(base_url)
    parsed = urlparse(urljoin(base_url, value))
    return parsed.netloc == parsed_base.netloc


def action_candidates(page, base_url, limit):
    if limit <= 0:
        return []
    try:
        raw_items = page.locator(CLICKABLE_SELECTOR).evaluate_all(
            """elements => elements.map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim(),
                href: el.getAttribute('href') || '',
                role: el.getAttribute('role') || '',
                type: el.getAttribute('type') || '',
                disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
                visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
            }))"""
        )
    except Exception:
        return []

    candidates = []
    seen = set()
    for item in raw_items:
        text = safe_action_text(item.get("text") or item.get("href"))
        if not text or item.get("disabled") or not item.get("visible"):
            continue
        href = item.get("href") or ""
        input_type = (item.get("type") or "").lower()
        if input_type == "submit":
            continue
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        if href and not same_origin_url(base_url, href):
            continue
        key = (item.get("tag"), text, href)
        if key in seen:
            continue
        seen.add(key)
        candidates.append({
            "index": item["index"],
            "tag": item.get("tag") or "",
            "text": text,
            "href": href,
            "role": item.get("role") or "",
            "type": input_type,
        })
        if len(candidates) >= limit:
            break
    return candidates


def normalize_body(text, content_type):
    try:
        parsed = json.loads(text)
        return discover.normalize_json(parsed), discover.json_schema(parsed), parsed
    except json.JSONDecodeError:
        return discover.normalize_scalar(text), "text", text


def screenshot_artifact_name(kind, identity):
    return discover.safe_artifact_name(f"{kind}-screenshot", identity, "png")


def capture_screenshot(page, artifacts_dir, kind, identity):
    artifact_name = screenshot_artifact_name(kind, identity)
    try:
        page.screenshot(path=str(artifacts_dir / artifact_name), full_page=True)
        return artifact_name
    except Exception:
        return None


def artifact_url(run_id, artifact_name):
    if not run_id or not artifact_name:
        return None
    return f"/artifacts/{run_id}/{artifact_name}"


def capture_network_response(base_url, response, artifacts_dir):
    request = response.request
    path = canonical_path(base_url, response.url)
    if not path:
        return None

    content_type = response_content_type(response)
    try:
        body = response.text()
    except Exception as exc:
        body = f"<body unavailable: {exc}>"

    normalized, schema, parsed = normalize_body(body, content_type)
    artifact_name = discover.api_artifact_name(path)
    (artifacts_dir / artifact_name).write_text(body, encoding="utf-8", errors="replace")

    post_data = request.post_data
    request_body = None
    if post_data:
        try:
            request_body = json.loads(post_data)
        except json.JSONDecodeError:
            request_body = post_data

    return {
        "path": path,
        "url": response.url,
        "method": request.method,
        "status": response.status,
        "resourceType": request.resource_type,
        "contentType": content_type,
        "bodyBytes": len(body.encode("utf-8", errors="replace")),
        "artifact": artifact_name,
        "requestHeaders": request.headers,
        "responseHeaders": response.headers,
        "requestBody": request_body,
        "normalizedBody": normalized,
        "schema": schema,
    }


def merge_endpoint(api_endpoints, captured, source):
    existing = api_endpoints.get(captured["path"])
    if existing:
        sources = existing.setdefault("sources", [])
        if source and source not in sources:
            sources.append(source)
        existing.update(captured)
        existing["sources"] = sources
        return existing
    captured["sources"] = [source] if source else []
    api_endpoints[captured["path"]] = captured
    return captured


def visible_text(page):
    try:
        return page.locator("body").inner_text(timeout=2000).splitlines()
    except Exception:
        return []


def capture_page(base_url, path, page, artifacts_dir, source):
    url = urljoin(base_url, path)
    html = page.content()
    parser = discover.DiscoveryParser()
    parser.feed(html)
    artifact_name = discover.page_artifact_name(path)
    screenshot_name = capture_screenshot(page, artifacts_dir, "page", path)
    (artifacts_dir / artifact_name).write_text(html, encoding="utf-8", errors="replace")
    return {
        "path": path,
        "url": url,
        "source": source,
        "status": 200,
        "elapsedMs": 0,
        "bodyBytes": len(html.encode("utf-8", errors="replace")),
        "artifact": artifact_name,
        "screenshotArtifact": screenshot_name,
        "title": page.title(),
        "visibleText": [discover.normalize_scalar(line.strip()) for line in visible_text(page) if line.strip()],
        "tagCounts": discover.count_values(parser.tags),
        "links": sorted(set(parser.links)),
        "forms": parser.forms,
        "assets": sorted(set(parser.assets)),
        "buttons": parser.buttons,
        "apiHints": sorted(set(parser.api_hints)),
    }


def run_safe_actions(page, base_url, path, artifacts_dir, pages, api_endpoints, edges, edge_seen, current_page_path, current_action, max_actions, request_timeout_sec):
    actions = {}
    candidates = action_candidates(page, base_url, max_actions)
    for action_index, candidate in enumerate(candidates, start=1):
        action_id = f"{path}#action-{action_index}"
        before_url = page.url
        before_endpoint_count = len(api_endpoints)
        current_page_path[0] = path
        current_action[0] = action_id
        action_record = {
            "id": action_id,
            "page": path,
            "index": action_index,
            "tag": candidate["tag"],
            "text": candidate["text"],
            "href": candidate["href"],
            "status": "pending",
            "beforeUrl": before_url,
            "afterUrl": before_url,
            "networkBefore": before_endpoint_count,
            "networkAfter": before_endpoint_count,
            "newEndpoints": [],
        }
        try:
            locator = page.locator(CLICKABLE_SELECTOR).nth(candidate["index"])
            locator.click(timeout=request_timeout_sec * 1000, trial=False)
            page.wait_for_timeout(min(1000, request_timeout_sec * 1000))
            try:
                page.wait_for_load_state("networkidle", timeout=min(4000, request_timeout_sec * 1000))
            except PlaywrightTimeoutError:
                pass
            after_url = page.url
            after_path = canonical_path(base_url, after_url) or path
            action_record["afterUrl"] = after_url
            action_record["afterPath"] = after_path
            action_record["screenshotArtifact"] = capture_screenshot(page, artifacts_dir, "action", action_id)
            action_record["status"] = "clicked"
            action_record["networkAfter"] = len(api_endpoints)
            action_record["newEndpoints"] = sorted(
                endpoint_path for endpoint_path, endpoint in api_endpoints.items()
                if action_id in endpoint.get("sources", [])
            )
            if after_path != path:
                pages[after_path] = capture_page(base_url, after_path, page, artifacts_dir, f"browser-action:{action_id}")
                add_edge(edges, edge_seen, {"from": path, "type": f"action:{candidate['text']}", "target": after_path})
                try:
                    page.goto(urljoin(base_url, path), wait_until="domcontentloaded")
                    page.wait_for_load_state("networkidle", timeout=min(4000, request_timeout_sec * 1000))
                except PlaywrightTimeoutError:
                    pass
        except Exception as exc:
            action_record["status"] = "skipped"
            action_record["error"] = str(exc)
        actions[action_id] = action_record
        current_action[0] = None
    return actions


def add_edge(edges, seen, edge):
    discover.add_edge(edges, seen, edge)


def launch_chromium(playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception as first_error:
        for candidate in SYSTEM_BROWSER_CANDIDATES:
            if candidate.exists():
                return playwright.chromium.launch(headless=True, executable_path=str(candidate))
        raise first_error


def discover_browser(args):
    config = read_json(args.config)
    out_dir = Path(args.out)
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    limits = config.get("limits", {})
    max_pages = int(limits.get("maxPages", 5))
    max_actions_per_page = int(limits.get("maxActionsPerPage", 0))
    request_timeout_sec = int(limits.get("requestTimeoutSec", 10))
    overall_timeout_sec = int(limits.get("overallTimeoutSec", 120))
    start_paths = config.get("startPaths", ["/"])[:max_pages]
    seed_api_paths = config.get("seedApiPaths", [])

    pages = {}
    api_endpoints = {}
    actions = {}
    console_events = []
    edges = []
    edge_seen = set()

    with sync_playwright() as p:
        browser = launch_chromium(p)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        page.set_default_timeout(request_timeout_sec * 1000)
        page.set_default_navigation_timeout(request_timeout_sec * 1000)

        def on_response(response):
            if not should_capture_response(response):
                return
            captured = capture_network_response(args.base_url, response, artifacts_dir)
            if not captured:
                return
            source = current_action[0] or current_page_path[0]
            merge_endpoint(api_endpoints, captured, source)
            edge_type = f"action:{captured['method']}" if current_action[0] else f"network:{captured['method']}"
            add_edge(edges, edge_seen, {"from": current_page_path[0], "type": edge_type, "target": captured["path"]})

        current_page_path = ["/"]
        current_action = [None]
        page.on("response", on_response)
        page.on("console", lambda msg: console_events.append({
            "type": msg.type,
            "text": msg.text,
            "page": current_page_path[0],
            "action": current_action[0],
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))
        page.on("pageerror", lambda exc: console_events.append({
            "type": "pageerror",
            "text": str(exc),
            "page": current_page_path[0],
            "action": current_action[0],
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))

        started = time.time()
        for path in start_paths:
            if time.time() - started > overall_timeout_sec:
                break
            current_page_path[0] = path
            url = urljoin(args.base_url, path)
            try:
                page.goto(url, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=min(5000, request_timeout_sec * 1000))
                except PlaywrightTimeoutError:
                    pass
                pages[path] = capture_page(args.base_url, path, page, artifacts_dir, "browser-start")
                actions.update(run_safe_actions(
                    page,
                    args.base_url,
                    path,
                    artifacts_dir,
                    pages,
                    api_endpoints,
                    edges,
                    edge_seen,
                    current_page_path,
                    current_action,
                    max_actions_per_page,
                    request_timeout_sec,
                ))
            except Exception as exc:
                pages[path] = {
                    "path": path,
                    "url": url,
                    "source": "browser-start",
                    "status": "navigation-error",
                    "error": str(exc),
                    "visibleText": [],
                    "tagCounts": {},
                    "links": [],
                    "forms": [],
                    "assets": [],
                    "buttons": [],
                    "apiHints": [],
                }

        for api_path in seed_api_paths:
            if api_path in api_endpoints:
                continue
            current_page_path[0] = api_path
            url = urljoin(args.base_url, api_path)
            try:
                response = page.request.get(url, timeout=request_timeout_sec * 1000)
                body = response.text()
                content_type = (response.headers.get("content-type") or "").split(";")[0].lower()
                normalized, schema, parsed = normalize_body(body, content_type)
                artifact_name = discover.api_artifact_name(api_path)
                (artifacts_dir / artifact_name).write_text(body, encoding="utf-8", errors="replace")
                api_endpoints[api_path] = {
                    "path": api_path,
                    "url": url,
                    "method": "GET",
                    "status": response.status,
                    "resourceType": "seed",
                    "contentType": content_type,
                    "bodyBytes": len(body.encode("utf-8", errors="replace")),
                    "artifact": artifact_name,
                    "requestHeaders": {},
                    "responseHeaders": response.headers,
                    "requestBody": None,
                    "normalizedBody": normalized,
                    "schema": schema,
                }
                add_edge(edges, edge_seen, {"from": "/", "type": "seed:GET", "target": api_path})
            except Exception as exc:
                api_endpoints[api_path] = {
                    "path": api_path,
                    "url": url,
                    "method": "GET",
                    "status": "request-error",
                    "error": str(exc),
                    "resourceType": "seed",
                    "contentType": "",
                    "bodyBytes": 0,
                    "artifact": None,
                    "requestHeaders": {},
                    "responseHeaders": {},
                    "requestBody": None,
                    "normalizedBody": None,
                    "schema": None,
                }

        browser.close()

    console_artifact = None
    if console_events:
        console_artifact = "console-log.json"
        write_json(artifacts_dir / console_artifact, console_events)

    graph = {
        "name": config.get("name", "browser-discovery-run"),
        "baseUrl": args.base_url,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runner": "browser-network",
        "limits": limits,
        "pages": pages,
        "apiEndpoints": api_endpoints,
        "actions": actions,
        "console": {
            "events": console_events,
            "artifact": console_artifact,
            "errors": [item for item in console_events if item.get("type") in {"error", "pageerror"}],
        },
        "edges": edges,
        "summary": {
            "pages": len(pages),
            "apiEndpoints": len(api_endpoints),
            "actions": len(actions),
            "consoleErrors": len([item for item in console_events if item.get("type") in {"error", "pageerror"}]),
            "edges": len(edges),
        },
    }
    write_json(out_dir / "discovery.json", graph)
    print(f"Browser discovery graph saved to {out_dir / 'discovery.json'}")
    print(f"Pages: {len(pages)}")
    print(f"API endpoints: {len(api_endpoints)}")
    print(f"Edges: {len(edges)}")


def main():
    parser = argparse.ArgumentParser(description="Browser network discovery MVP")
    parser.add_argument("discover", nargs="?")
    parser.add_argument("--config", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    discover_browser(args)


if __name__ == "__main__":
    main()
