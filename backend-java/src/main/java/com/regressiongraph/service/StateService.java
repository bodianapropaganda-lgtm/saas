package com.regressiongraph.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.config.AppPaths;
import com.regressiongraph.util.JsonFiles;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.stereotype.Service;

@Service
public class StateService {
    private final AppPaths paths;
    private final DiffService diffService;
    private final StorageV2Service storage;

    public StateService(AppPaths paths, DiffService diffService, StorageV2Service storage) {
        this.paths = paths;
        this.diffService = diffService;
        this.storage = storage;
    }

    public ObjectNode buildState() {
        Selection selection = selectedRunAndBaseline();
        if (selection.runDir() == null || selection.baselineDir() == null) {
            return emptyState();
        }
        ObjectNode baseline = JsonFiles.readObject(selection.baselineDir().resolve("discovery.json"));
        ObjectNode current = JsonFiles.readObject(selection.runDir().resolve("discovery.json"));
        ArrayNode diffs = diffService.compare(baseline, current);
        Buckets buckets = bucketDiffs(diffs);
        ArrayNode nodes = JsonFiles.MAPPER.createArrayNode();
        buildPageNodes(nodes, baseline, current, buckets, selection);
        buildApiNodes(nodes, baseline, current, buckets, selection);
        ArrayNode actions = buildActions(baseline.path("actions"), current.path("actions"), buckets, selection);
        int critical = criticalCount(diffs);

        ObjectNode state = JsonFiles.MAPPER.createObjectNode();
        state.put("project", current.path("name").asText("Regression Graph"));
        state.put("mode", "live");
        state.set("target", targetFromConfig(current.path("baseUrl").asText("")));
        state.set("baseline", baselineInfo(selection.baselineDir(), baseline));
        state.set("current", currentInfo(selection.runDir(), current, diffs.size(), critical));
        state.set("storage", storage.modelState());
        state.set("runs", listRuns(selection.runDir(), diffs.size(), critical));
        state.set("nodes", nodes);
        state.set("actions", actions);
        state.set("console", current.path("console").isObject() ? current.path("console").deepCopy() : emptyConsole());
        state.set("edges", buildEdges(current, nodes));
        return state;
    }

    private void buildPageNodes(ArrayNode nodes, JsonNode baseline, JsonNode current, Buckets buckets, Selection selection) {
        TreeSet<String> paths = unionKeys(baseline.path("pages"), current.path("pages"));
        int index = 0;
        for (String path : paths) {
            JsonNode oldPage = baseline.path("pages").path(path);
            JsonNode newPage = current.path("pages").path(path);
            ArrayNode items = buckets.items("page:" + path, "pages:" + path);
            ObjectNode node = baseNode("page", path, path, status(items, !oldPage.isMissingNode(), !newPage.isMissingNode()), index++);
            JsonNode active = !newPage.isMissingNode() ? newPage : oldPage;
            node.put("title", active.path("title").asText(path));
            node.put("summary", shortMessage(items, "Page snapshot: " + active.path("status").asText("-")));
            ObjectNode details = JsonFiles.MAPPER.createObjectNode();
            details.put("url", active.path("url").asText(path));
            details.put("method", "GET");
            details.put("baselineStatus", oldPage.path("status").asText("not discovered"));
            details.put("currentStatus", newPage.path("status").asText("not discovered"));
            details.set("artifacts", artifacts(selection, oldPage, newPage));
            details.put("schema", "HTML page snapshot");
            ObjectNode response = JsonFiles.MAPPER.createObjectNode();
            response.set("baseline", oldPage.path("visibleText"));
            response.set("current", newPage.path("visibleText"));
            details.set("response", response);
            details.set("visibleTextDiff", patchFromItems(items));
            details.set("diffs", reviewDiffs(items));
            node.set("details", details);
            nodes.add(node);
        }
    }

    private void buildApiNodes(ArrayNode nodes, JsonNode baseline, JsonNode current, Buckets buckets, Selection selection) {
        TreeSet<String> paths = unionKeys(baseline.path("apiEndpoints"), current.path("apiEndpoints"));
        int index = 0;
        for (String path : paths) {
            JsonNode oldApi = baseline.path("apiEndpoints").path(path);
            JsonNode newApi = current.path("apiEndpoints").path(path);
            ArrayNode items = buckets.items("api:" + path, "apiEndpoints:" + path);
            ObjectNode node = baseNode("endpoint", "GET " + path, path,
                    status(items, !oldApi.isMissingNode(), !newApi.isMissingNode()), index++);
            JsonNode active = !newApi.isMissingNode() ? newApi : oldApi;
            node.put("title", path);
            node.put("summary", shortMessage(items, "API snapshot: " + active.path("status").asText("-")));
            ObjectNode details = JsonFiles.MAPPER.createObjectNode();
            details.put("url", active.path("url").asText(path));
            details.put("method", active.path("method").asText("GET"));
            details.put("resourceType", active.path("resourceType").asText(""));
            details.set("sources", active.path("sources"));
            details.put("baselineStatus", oldApi.path("status").asText("not discovered"));
            details.put("currentStatus", newApi.path("status").asText("not discovered"));
            details.set("requestHeaders", active.path("requestHeaders"));
            details.set("responseHeaders", active.path("responseHeaders"));
            details.set("artifacts", apiArtifacts(selection, oldApi, newApi));
            ObjectNode payload = JsonFiles.MAPPER.createObjectNode();
            payload.set("baseline", oldApi.path("requestBody"));
            payload.set("current", newApi.path("requestBody"));
            details.set("payload", payload);
            ObjectNode response = JsonFiles.MAPPER.createObjectNode();
            response.set("baseline", artifactJson(selection.baselineDir(), oldApi));
            response.set("current", artifactJson(selection.runDir(), newApi));
            details.set("response", response);
            ObjectNode schema = JsonFiles.MAPPER.createObjectNode();
            schema.set("baseline", oldApi.path("schema"));
            schema.set("current", newApi.path("schema"));
            details.set("schema", schema);
            details.set("diffs", reviewDiffs(items));
            node.set("details", details);
            nodes.add(node);
        }
    }

    private ArrayNode buildActions(JsonNode oldActions, JsonNode newActions, Buckets buckets, Selection selection) {
        ArrayNode rows = JsonFiles.MAPPER.createArrayNode();
        for (String id : unionKeys(oldActions, newActions)) {
            JsonNode oldAction = oldActions.path(id);
            JsonNode newAction = newActions.path(id);
            JsonNode active = !newAction.isMissingNode() ? newAction : oldAction;
            ArrayNode items = buckets.items("action:" + id, "actions:" + id);
            ObjectNode row = JsonFiles.MAPPER.createObjectNode();
            row.put("id", id);
            row.put("label", active.path("text").asText(id));
            row.put("page", active.path("page").asText(""));
            row.put("status", status(items, !oldAction.isMissingNode(), !newAction.isMissingNode()));
            row.put("actionStatus", active.path("status").asText("-"));
            row.set("newEndpoints", active.path("newEndpoints"));
            row.set("artifacts", artifacts(selection, oldAction, newAction));
            row.set("diffs", reviewDiffs(items));
            rows.add(row);
        }
        return rows;
    }

    private ObjectNode baseNode(String type, String label, String key, String status, int index) {
        ObjectNode node = JsonFiles.MAPPER.createObjectNode();
        node.put("id", nodeId("endpoint".equals(type) ? "api" : "page", key));
        node.put("type", type);
        node.put("label", label);
        node.put("status", status);
        node.put("x", "endpoint".equals(type) ? 390 + (index % 2) * 320 : 42);
        node.put("y", 46 + ("endpoint".equals(type) ? (index / 2) : index) * 130);
        return node;
    }

    private ArrayNode buildEdges(JsonNode graph, ArrayNode nodes) {
        Map<String, String> known = new HashMap<>();
        nodes.forEach(node -> {
            known.put(node.path("label").asText(), node.path("id").asText());
            known.put(node.path("title").asText(node.path("label").asText()), node.path("id").asText());
        });
        ArrayNode edges = JsonFiles.MAPPER.createArrayNode();
        for (JsonNode edge : graph.path("edges")) {
            String from = known.get(edge.path("from").asText());
            String target = known.get(edge.path("target").asText());
            if (from != null && target != null) {
                ArrayNode pair = JsonFiles.MAPPER.createArrayNode();
                pair.add(from);
                pair.add(target);
                edges.add(pair);
            }
        }
        return edges;
    }

    private ObjectNode targetFromConfig(String baseUrl) {
        ObjectNode config = JsonFiles.readObject(paths.defaultConfig());
        ObjectNode target = JsonFiles.MAPPER.createObjectNode();
        target.put("project", config.path("name").asText("target"));
        target.put("environment", "Local/Staging");
        target.put("baseUrl", baseUrl);
        target.put("authProfile", "No auth");
        target.put("policy", "GET only");
        target.set("startUrls", config.path("startPaths"));
        target.set("seedApiPaths", config.path("seedApiPaths"));
        target.set("limits", config.path("limits"));
        target.set("guardrails", JsonFiles.MAPPER.createArrayNode());
        return target;
    }

    private ArrayNode listRuns(Path selectedRun, int selectedDiffs, int selectedCritical) {
        ArrayNode runs = JsonFiles.MAPPER.createArrayNode();
        try (var stream = Files.exists(paths.runsDir()) ? Files.list(paths.runsDir()) : java.util.stream.Stream.<Path>empty()) {
            stream.filter(Files::isDirectory)
                    .filter(path -> Files.exists(path.resolve("discovery.json")) || Files.exists(path.resolve("run-error.json")))
                    .sorted((a, b) -> Long.compare(modified(b), modified(a)))
                    .forEach(path -> runs.add(runRow(path, selectedRun, selectedDiffs, selectedCritical)));
        } catch (Exception ignored) {
        }
        return runs;
    }

    private ObjectNode runRow(Path runDir, Path selectedRun, int selectedDiffs, int selectedCritical) {
        ObjectNode graph = JsonFiles.readObject(runDir.resolve("discovery.json"));
        ObjectNode meta = JsonFiles.readObject(runDir.resolve("run-meta.json"));
        JsonNode error = JsonFiles.read(runDir.resolve("run-error.json"));
        boolean isCurrent = runDir.equals(selectedRun);
        ObjectNode row = JsonFiles.MAPPER.createObjectNode();
        row.put("id", runDir.getFileName().toString());
        row.put("label", runDir.getFileName().toString());
        row.put("environment", graph.path("baseUrl").asText(meta.path("baseUrl").asText("")));
        row.put("startedAt", graph.path("capturedAt").asText(meta.path("createdAt").asText(error.path("createdAt").asText(""))));
        row.put("pages", graph.path("summary").path("pages").asInt(0));
        row.put("endpoints", graph.path("summary").path("apiEndpoints").asInt(0));
        row.put("diffs", isCurrent ? selectedDiffs : 0);
        row.put("status", !error.isMissingNode() && !error.isEmpty() ? "fail" : isCurrent && selectedCritical > 0 ? "fail" : isCurrent && selectedDiffs > 0 ? "changed" : "passed");
        row.set("error", error.isMissingNode() || error.isEmpty() ? JsonFiles.MAPPER.nullNode() : error);
        return row;
    }

    private Selection selectedRunAndBaseline() {
        Path latest = latestDir(paths.runsDir(), "discovery.json");
        if (latest == null) {
            return new Selection(null, null);
        }
        ObjectNode meta = JsonFiles.readObject(latest.resolve("run-meta.json"));
        Path baseline = paths.baselinesDir().resolve(meta.path("baselineName").asText("ui-baseline"));
        if (!Files.exists(baseline.resolve("discovery.json"))) {
            baseline = latest;
        }
        JsonNode runGraph = JsonFiles.read(latest.resolve("discovery.json"));
        JsonNode baselineGraph = JsonFiles.read(baseline.resolve("discovery.json"));
        if (!trimRight(runGraph.path("baseUrl").asText(""), "/").equals(trimRight(baselineGraph.path("baseUrl").asText(""), "/"))) {
            baseline = latest;
        }
        return new Selection(latest, baseline);
    }

    private Path latestDir(Path parent, String fileName) {
        try (var stream = Files.exists(parent) ? Files.list(parent) : java.util.stream.Stream.<Path>empty()) {
            return stream.filter(Files::isDirectory)
                    .filter(path -> Files.exists(path.resolve(fileName)))
                    .max((a, b) -> Long.compare(modified(a.resolve(fileName)), modified(b.resolve(fileName))))
                    .orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    private ObjectNode emptyState() {
        ObjectNode state = JsonFiles.MAPPER.createObjectNode();
        state.put("project", "Regression Graph");
        state.put("mode", "empty");
        state.set("target", targetFromConfig(""));
        state.set("baseline", summaryInfo("No baseline"));
        state.set("current", summaryInfo("No run"));
        state.set("storage", storage.modelState());
        state.set("runs", listRuns(null, 0, 0));
        state.set("nodes", JsonFiles.MAPPER.createArrayNode());
        state.set("actions", JsonFiles.MAPPER.createArrayNode());
        state.set("console", emptyConsole());
        state.set("edges", JsonFiles.MAPPER.createArrayNode());
        return state;
    }

    private ObjectNode baselineInfo(Path dir, JsonNode graph) {
        ObjectNode node = summaryInfo(dir.getFileName().toString());
        node.put("id", dir.getFileName().toString());
        node.put("capturedAt", graph.path("capturedAt").asText(""));
        node.set("summary", graph.path("summary"));
        return node;
    }

    private ObjectNode currentInfo(Path dir, JsonNode graph, int diffs, int critical) {
        ObjectNode node = baselineInfo(dir, graph);
        node.path("summary");
        ObjectNode summary = graph.path("summary").isObject()
                ? (ObjectNode) graph.path("summary").deepCopy()
                : JsonFiles.MAPPER.createObjectNode();
        summary.put("diffs", diffs);
        summary.put("critical", critical);
        node.set("summary", summary);
        node.put("reportUrl", Files.exists(paths.reportsDir().resolve(dir.getFileName() + "-report.html")) ? "/reports/" + dir.getFileName() + "-report.html" : null);
        return node;
    }

    private ObjectNode summaryInfo(String label) {
        ObjectNode node = JsonFiles.MAPPER.createObjectNode();
        node.putNull("id");
        node.put("label", label);
        node.put("capturedAt", "");
        ObjectNode summary = JsonFiles.MAPPER.createObjectNode();
        summary.put("pages", 0);
        summary.put("apiEndpoints", 0);
        summary.put("edges", 0);
        summary.put("diffs", 0);
        summary.put("critical", 0);
        node.set("summary", summary);
        return node;
    }

    private ObjectNode emptyConsole() {
        ObjectNode console = JsonFiles.MAPPER.createObjectNode();
        console.set("events", JsonFiles.MAPPER.createArrayNode());
        console.set("errors", JsonFiles.MAPPER.createArrayNode());
        console.putNull("artifactUrl");
        return console;
    }

    private ObjectNode artifacts(Selection selection, JsonNode oldItem, JsonNode newItem) {
        ObjectNode artifacts = JsonFiles.MAPPER.createObjectNode();
        artifacts.put("baselineHtml", artifactLink(selection.baselineDir(), oldItem.path("artifact").asText("")));
        artifacts.put("currentHtml", artifactLink(selection.runDir(), newItem.path("artifact").asText("")));
        artifacts.put("baselineScreenshot", artifactLink(selection.baselineDir(), oldItem.path("screenshotArtifact").asText("")));
        artifacts.put("currentScreenshot", artifactLink(selection.runDir(), newItem.path("screenshotArtifact").asText("")));
        return artifacts;
    }

    private ObjectNode apiArtifacts(Selection selection, JsonNode oldItem, JsonNode newItem) {
        ObjectNode artifacts = JsonFiles.MAPPER.createObjectNode();
        artifacts.put("baselineResponse", artifactLink(selection.baselineDir(), oldItem.path("artifact").asText("")));
        artifacts.put("currentResponse", artifactLink(selection.runDir(), newItem.path("artifact").asText("")));
        return artifacts;
    }

    private JsonNode artifactJson(Path runDir, JsonNode item) {
        String artifact = item.path("artifact").asText("");
        if (artifact.isBlank()) {
            return JsonFiles.MAPPER.nullNode();
        }
        Path path = runDir.resolve("artifacts").resolve(artifact);
        return JsonFiles.read(path);
    }

    private String artifactLink(Path runDir, String artifact) {
        if (artifact == null || artifact.isBlank() || runDir == null) {
            return null;
        }
        return Files.exists(runDir.resolve("artifacts").resolve(artifact)) ? "/artifacts/" + runDir.getFileName() + "/" + artifact : null;
    }

    private ArrayNode reviewDiffs(ArrayNode items) {
        ArrayNode result = JsonFiles.MAPPER.createArrayNode();
        for (JsonNode item : items) {
            ObjectNode view = JsonFiles.MAPPER.createObjectNode();
            String severity = item.path("severity").asText("review");
            view.put("severity", "review".equals(severity) ? "changed" : severity);
            view.put("title", item.path("message").asText("Change requires review"));
            view.put("text", item.path("entity").asText("") + ": " + item.path("kind").asText(""));
            view.set("old", item.path("old"));
            view.set("new", item.path("new"));
            view.set("patch", item.path("patch"));
            result.add(view);
        }
        return result;
    }

    private ArrayNode patchFromItems(ArrayNode items) {
        ArrayNode patch = JsonFiles.MAPPER.createArrayNode();
        for (JsonNode item : items) {
            for (JsonNode line : item.path("patch")) {
                patch.add(line.asText());
            }
        }
        return patch;
    }

    private String status(ArrayNode items, boolean existsOld, boolean existsNew) {
        if (existsOld && !existsNew) {
            return "removed";
        }
        if (!existsOld && existsNew) {
            return "changed";
        }
        for (JsonNode item : items) {
            if ("fail".equals(item.path("severity").asText())) {
                return "fail";
            }
        }
        return items.isEmpty() ? "ok" : "changed";
    }

    private String shortMessage(ArrayNode items, String fallback) {
        return items.isEmpty() ? fallback : items.get(0).path("message").asText(fallback);
    }

    private int criticalCount(ArrayNode diffs) {
        int count = 0;
        for (JsonNode item : diffs) {
            if ("fail".equals(item.path("severity").asText())) {
                count++;
            }
        }
        return count;
    }

    private Buckets bucketDiffs(ArrayNode diffs) {
        Buckets buckets = new Buckets();
        for (JsonNode item : diffs) {
            String entity = item.path("entity").asText("");
            if (("pages".equals(entity) || "apiEndpoints".equals(entity))
                    && ("removed".equals(item.path("kind").asText()) || "added".equals(item.path("kind").asText()))) {
                String key = item.path("old").asText(item.path("new").asText(""));
                buckets.add(entity + ":" + key, item);
            } else {
                buckets.add(entity, item);
            }
        }
        return buckets;
    }

    private TreeSet<String> unionKeys(JsonNode left, JsonNode right) {
        TreeSet<String> keys = new TreeSet<>();
        if (left != null && left.isObject()) {
            left.properties().forEach(entry -> keys.add(entry.getKey()));
        }
        if (right != null && right.isObject()) {
            right.properties().forEach(entry -> keys.add(entry.getKey()));
        }
        return keys;
    }

    private String nodeId(String prefix, String path) {
        String safe = path.replaceAll("^/+", "").replaceAll("[^A-Za-z0-9]+", "-").replaceAll("^-|-$", "");
        if (safe.isBlank()) {
            safe = "root";
        }
        return prefix + "-" + safe;
    }

    private long modified(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    private String trimRight(String value, String suffix) {
        String result = value == null ? "" : value;
        while (result.endsWith(suffix)) {
            result = result.substring(0, result.length() - suffix.length());
        }
        return result;
    }

    private record Selection(Path runDir, Path baselineDir) {
    }

    private static class Buckets {
        private final Map<String, ArrayNode> map = new HashMap<>();

        void add(String key, JsonNode value) {
            map.computeIfAbsent(key, ignored -> JsonFiles.MAPPER.createArrayNode()).add(value);
        }

        ArrayNode items(String... keys) {
            ArrayNode result = JsonFiles.MAPPER.createArrayNode();
            for (String key : keys) {
                ArrayNode found = map.get(key);
                if (found != null) {
                    found.forEach(result::add);
                }
            }
            return result;
        }
    }
}
