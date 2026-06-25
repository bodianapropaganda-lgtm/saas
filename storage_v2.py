import json
import time
from pathlib import Path


SCHEMA_VERSION = 2
DEFAULT_PROJECT_ID = "default-project"
DEFAULT_TARGET_ID = "default-target"


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False, sort_keys=True)


def safe_record_name(value):
    text = str(value or "record")
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in text)[:160] or "record"


class StorageV2:
    """Small JSON document store for the product UI state model.

    The discovery artifacts still live in runs/, baselines/ and reports/.
    Storage V2 keeps a normalized index over those files so the product
    can reason in projects, targets, runs and baselines instead of guessing
    state from folder names.
    """

    def __init__(self, root):
        self.root = Path(root)
        self.index_path = self.root / "index.json"
        self.runs_dir = self.root / "runs"
        self.baselines_dir = self.root / "baselines"

    def load_index(self):
        index = read_json(self.index_path)
        if index:
            return index
        return {
            "schemaVersion": SCHEMA_VERSION,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "projects": {},
        }

    def save_index(self, index):
        index["schemaVersion"] = SCHEMA_VERSION
        index["updatedAt"] = now_iso()
        write_json(self.index_path, index)

    def ensure_target(self, project_name="Regression Graph", target_name="Default target", base_url=""):
        index = self.load_index()
        projects = index.setdefault("projects", {})
        project = projects.setdefault(DEFAULT_PROJECT_ID, {
            "id": DEFAULT_PROJECT_ID,
            "name": project_name,
            "createdAt": now_iso(),
            "targets": {},
        })
        project["name"] = project_name or project.get("name") or "Regression Graph"
        targets = project.setdefault("targets", {})
        target = targets.setdefault(DEFAULT_TARGET_ID, {
            "id": DEFAULT_TARGET_ID,
            "name": target_name,
            "baseUrl": base_url,
            "createdAt": now_iso(),
            "runs": [],
            "currentRunId": None,
            "baselineId": None,
        })
        target["name"] = target_name or target.get("name") or "Default target"
        if base_url:
            target["baseUrl"] = base_url
        target["updatedAt"] = now_iso()
        self.save_index(index)
        return project, target

    def run_path(self, run_id):
        return self.runs_dir / f"{safe_record_name(run_id)}.json"

    def baseline_path(self, baseline_id):
        return self.baselines_dir / f"{safe_record_name(baseline_id)}.json"

    def record_run_started(self, run_id, base_url, baseline_id, run_dir):
        project, target = self.ensure_target(base_url=base_url)
        record = {
            "id": run_id,
            "projectId": project["id"],
            "targetId": target["id"],
            "status": "running",
            "baseUrl": base_url,
            "baselineId": baseline_id,
            "runDir": str(run_dir),
            "startedAt": now_iso(),
            "finishedAt": None,
            "summary": {"pages": 0, "apiEndpoints": 0, "edges": 0},
            "diffs": 0,
            "critical": 0,
            "errorPath": None,
            "reportHtml": None,
            "reportJson": None,
        }
        write_json(self.run_path(run_id), record)
        self._attach_run(target["id"], run_id, baseline_id, current=True)
        return record

    def record_existing_run(self, run_id, meta, graph=None, error=None, report_html=None, report_json=None):
        if read_json(self.run_path(run_id)):
            return
        graph = graph or {}
        base_url = graph.get("baseUrl") or meta.get("baseUrl", "")
        baseline_id = meta.get("baselineName")
        status = "failed" if error else "completed"
        started_at = meta.get("createdAt") or graph.get("capturedAt")
        finished_at = graph.get("capturedAt")
        if error:
            started_at = started_at or error.get("createdAt")
            finished_at = error.get("createdAt")
        record = {
            "id": run_id,
            "projectId": DEFAULT_PROJECT_ID,
            "targetId": DEFAULT_TARGET_ID,
            "status": status,
            "baseUrl": base_url,
            "baselineId": baseline_id,
            "runDir": meta.get("runDir"),
            "startedAt": started_at,
            "finishedAt": finished_at,
            "summary": graph.get("summary", {"pages": 0, "apiEndpoints": 0, "edges": 0}),
            "diffs": 0,
            "critical": 0,
            "errorPath": meta.get("errorPath"),
            "reportHtml": str(report_html) if report_html else None,
            "reportJson": str(report_json) if report_json else None,
        }
        self.ensure_target(base_url=base_url)
        write_json(self.run_path(run_id), record)
        self._attach_run(DEFAULT_TARGET_ID, run_id, baseline_id, current=status == "completed")

    def record_run_success(self, run_id, graph, baseline_id, action, report_html=None, report_json=None, diffs=0, critical=0):
        record = read_json(self.run_path(run_id), {})
        record.update({
            "status": "completed",
            "baseUrl": graph.get("baseUrl", record.get("baseUrl", "")),
            "baselineId": baseline_id,
            "finishedAt": graph.get("capturedAt") or now_iso(),
            "summary": graph.get("summary", {}),
            "action": action,
            "diffs": diffs,
            "critical": critical,
            "reportHtml": str(report_html) if report_html else record.get("reportHtml"),
            "reportJson": str(report_json) if report_json else record.get("reportJson"),
        })
        write_json(self.run_path(run_id), record)
        self._attach_run(record.get("targetId", DEFAULT_TARGET_ID), run_id, baseline_id, current=True)

    def record_run_error(self, run_id, base_url, baseline_id, error_path):
        record = read_json(self.run_path(run_id), {})
        record.update({
            "id": run_id,
            "projectId": DEFAULT_PROJECT_ID,
            "targetId": DEFAULT_TARGET_ID,
            "status": "failed",
            "baseUrl": base_url,
            "baselineId": baseline_id,
            "finishedAt": now_iso(),
            "errorPath": str(error_path),
        })
        write_json(self.run_path(run_id), record)
        self._attach_run(DEFAULT_TARGET_ID, run_id, baseline_id, current=False)

    def record_baseline(self, baseline_id, run_id, baseline_dir, graph):
        self.ensure_target(base_url=graph.get("baseUrl", ""))
        record = {
            "id": baseline_id,
            "projectId": DEFAULT_PROJECT_ID,
            "targetId": DEFAULT_TARGET_ID,
            "runId": run_id,
            "baselineDir": str(baseline_dir),
            "baseUrl": graph.get("baseUrl", ""),
            "capturedAt": graph.get("capturedAt") or now_iso(),
            "summary": graph.get("summary", {}),
        }
        write_json(self.baseline_path(baseline_id), record)
        index = self.load_index()
        target = index["projects"][DEFAULT_PROJECT_ID]["targets"][DEFAULT_TARGET_ID]
        target["baselineId"] = baseline_id
        target["updatedAt"] = now_iso()
        self.save_index(index)

    def delete_run(self, run_id):
        path = self.run_path(run_id)
        if path.exists():
            path.unlink()
        index = self.load_index()
        for project in index.get("projects", {}).values():
            for target in project.get("targets", {}).values():
                target["runs"] = [item for item in target.get("runs", []) if item != run_id]
                if target.get("currentRunId") == run_id:
                    target["currentRunId"] = target["runs"][0] if target["runs"] else None
                target["updatedAt"] = now_iso()
        self.save_index(index)

    def delete_baseline(self, baseline_id):
        path = self.baseline_path(baseline_id)
        if path.exists():
            path.unlink()
        index = self.load_index()
        for project in index.get("projects", {}).values():
            for target in project.get("targets", {}).values():
                if target.get("baselineId") == baseline_id:
                    target["baselineId"] = None
        self.save_index(index)

    def model_state(self):
        index = self.load_index()
        runs = sorted(self.runs_dir.glob("*.json")) if self.runs_dir.exists() else []
        baselines = sorted(self.baselines_dir.glob("*.json")) if self.baselines_dir.exists() else []
        target = index.get("projects", {}).get(DEFAULT_PROJECT_ID, {}).get("targets", {}).get(DEFAULT_TARGET_ID, {})
        return {
            "schemaVersion": SCHEMA_VERSION,
            "projectId": DEFAULT_PROJECT_ID,
            "targetId": DEFAULT_TARGET_ID,
            "targetName": target.get("name", "Default target"),
            "baseUrl": target.get("baseUrl", ""),
            "currentRunId": target.get("currentRunId"),
            "baselineId": target.get("baselineId"),
            "runRecords": len(runs),
            "baselineRecords": len(baselines),
            "updatedAt": index.get("updatedAt"),
        }

    def _attach_run(self, target_id, run_id, baseline_id, current):
        index = self.load_index()
        project = index.setdefault("projects", {}).setdefault(DEFAULT_PROJECT_ID, {
            "id": DEFAULT_PROJECT_ID,
            "name": "Regression Graph",
            "createdAt": now_iso(),
            "targets": {},
        })
        target = project.setdefault("targets", {}).setdefault(target_id, {
            "id": target_id,
            "name": "Default target",
            "baseUrl": "",
            "createdAt": now_iso(),
            "runs": [],
            "currentRunId": None,
            "baselineId": None,
        })
        runs = [item for item in target.get("runs", []) if item != run_id]
        target["runs"] = [run_id] + runs
        if current:
            target["currentRunId"] = run_id
        if baseline_id:
            target["baselineId"] = baseline_id
        target["updatedAt"] = now_iso()
        self.save_index(index)
