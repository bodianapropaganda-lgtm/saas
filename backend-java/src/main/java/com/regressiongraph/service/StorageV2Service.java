package com.regressiongraph.service;

import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.config.AppPaths;
import com.regressiongraph.util.JsonFiles;
import com.regressiongraph.util.PathSafety;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import org.springframework.stereotype.Service;

@Service
public class StorageV2Service {
    private static final int SCHEMA_VERSION = 2;
    private static final String PROJECT_ID = "default-project";
    private static final String TARGET_ID = "default-target";

    private final AppPaths paths;

    public StorageV2Service(AppPaths paths) {
        this.paths = paths;
    }

    public ObjectNode modelState() {
        ObjectNode index = loadIndex();
        ObjectNode target = target(index);
        ObjectNode state = JsonFiles.MAPPER.createObjectNode();
        state.put("schemaVersion", SCHEMA_VERSION);
        state.put("projectId", PROJECT_ID);
        state.put("targetId", TARGET_ID);
        state.put("targetName", target.path("name").asText("Default target"));
        state.put("baseUrl", target.path("baseUrl").asText(""));
        state.put("currentRunId", textOrNull(target, "currentRunId"));
        state.put("baselineId", textOrNull(target, "baselineId"));
        state.put("runRecords", countJson(paths.runtimeDir().resolve("storage-v2").resolve("runs")));
        state.put("baselineRecords", countJson(paths.runtimeDir().resolve("storage-v2").resolve("baselines")));
        state.put("updatedAt", index.path("updatedAt").asText(""));
        return state;
    }

    public void recordRunStarted(String runId, String baseUrl, String baselineId, Path runDir) {
        ObjectNode record = runRecord(runId, baseUrl, baselineId, runDir);
        record.put("status", "running");
        JsonFiles.write(runPath(runId), record);
        attachRun(runId, baselineId, true, baseUrl);
    }

    public void recordRunSuccess(String runId, ObjectNode graph, String baselineId, String action, int diffs, int critical) {
        ObjectNode record = JsonFiles.readObject(runPath(runId));
        record.put("status", "completed");
        record.put("baseUrl", graph.path("baseUrl").asText(record.path("baseUrl").asText("")));
        record.put("baselineId", baselineId);
        record.put("finishedAt", graph.path("capturedAt").asText(now()));
        record.set("summary", graph.path("summary"));
        record.put("action", action);
        record.put("diffs", diffs);
        record.put("critical", critical);
        JsonFiles.write(runPath(runId), record);
        attachRun(runId, baselineId, true, graph.path("baseUrl").asText(""));
    }

    public void recordRunError(String runId, String baseUrl, String baselineId, Path errorPath) {
        ObjectNode record = JsonFiles.readObject(runPath(runId));
        record.put("id", runId);
        record.put("projectId", PROJECT_ID);
        record.put("targetId", TARGET_ID);
        record.put("status", "failed");
        record.put("baseUrl", baseUrl);
        record.put("baselineId", baselineId);
        record.put("finishedAt", now());
        record.put("errorPath", errorPath.toString());
        JsonFiles.write(runPath(runId), record);
        attachRun(runId, baselineId, false, baseUrl);
    }

    public void recordBaseline(String baselineId, String runId, Path baselineDir, ObjectNode graph) {
        ObjectNode record = JsonFiles.MAPPER.createObjectNode();
        record.put("id", baselineId);
        record.put("projectId", PROJECT_ID);
        record.put("targetId", TARGET_ID);
        record.put("runId", runId);
        record.put("baselineDir", baselineDir.toString());
        record.put("baseUrl", graph.path("baseUrl").asText(""));
        record.put("capturedAt", graph.path("capturedAt").asText(now()));
        record.set("summary", graph.path("summary"));
        JsonFiles.write(baselinePath(baselineId), record);

        ObjectNode index = loadIndex();
        ObjectNode target = target(index);
        target.put("baselineId", baselineId);
        target.put("updatedAt", now());
        saveIndex(index);
    }

    public void deleteRun(String runId) {
        try {
            Files.deleteIfExists(runPath(runId));
        } catch (Exception e) {
            throw new IllegalStateException("Cannot delete run record: " + runId, e);
        }
        ObjectNode index = loadIndex();
        ObjectNode target = target(index);
        ArrayNode nextRuns = JsonFiles.MAPPER.createArrayNode();
        for (var item : target.withArray("runs")) {
            if (!runId.equals(item.asText())) {
                nextRuns.add(item.asText());
            }
        }
        target.set("runs", nextRuns);
        if (runId.equals(target.path("currentRunId").asText(""))) {
            target.put("currentRunId", nextRuns.isEmpty() ? null : nextRuns.get(0).asText());
        }
        target.put("updatedAt", now());
        saveIndex(index);
    }

    public void deleteBaseline(String baselineId) {
        try {
            Files.deleteIfExists(baselinePath(baselineId));
        } catch (Exception e) {
            throw new IllegalStateException("Cannot delete baseline record: " + baselineId, e);
        }
    }

    private ObjectNode runRecord(String runId, String baseUrl, String baselineId, Path runDir) {
        ObjectNode record = JsonFiles.MAPPER.createObjectNode();
        record.put("id", runId);
        record.put("projectId", PROJECT_ID);
        record.put("targetId", TARGET_ID);
        record.put("baseUrl", baseUrl);
        record.put("baselineId", baselineId);
        record.put("runDir", runDir.toString());
        record.put("startedAt", now());
        record.putNull("finishedAt");
        record.putNull("errorPath");
        record.putNull("reportHtml");
        record.putNull("reportJson");
        record.put("diffs", 0);
        record.put("critical", 0);
        ObjectNode summary = JsonFiles.MAPPER.createObjectNode();
        summary.put("pages", 0);
        summary.put("apiEndpoints", 0);
        summary.put("edges", 0);
        record.set("summary", summary);
        return record;
    }

    private void attachRun(String runId, String baselineId, boolean current, String baseUrl) {
        ObjectNode index = loadIndex();
        ObjectNode target = target(index);
        if (baseUrl != null && !baseUrl.isBlank()) {
            target.put("baseUrl", baseUrl);
        }
        ArrayNode runs = JsonFiles.MAPPER.createArrayNode();
        runs.add(runId);
        for (var item : target.withArray("runs")) {
            if (!runId.equals(item.asText())) {
                runs.add(item.asText());
            }
        }
        target.set("runs", runs);
        if (current) {
            target.put("currentRunId", runId);
        }
        if (baselineId != null && !baselineId.isBlank()) {
            target.put("baselineId", baselineId);
        }
        target.put("updatedAt", now());
        saveIndex(index);
    }

    private ObjectNode loadIndex() {
        ObjectNode index = JsonFiles.readObject(indexPath());
        if (!index.has("projects")) {
            index.put("schemaVersion", SCHEMA_VERSION);
            index.put("createdAt", now());
            index.put("updatedAt", now());
            index.set("projects", JsonFiles.MAPPER.createObjectNode());
        }
        target(index);
        return index;
    }

    private ObjectNode target(ObjectNode index) {
        ObjectNode projects = JsonFiles.objectChild(index, "projects");
        ObjectNode project = JsonFiles.objectChild(projects, PROJECT_ID);
        project.put("id", PROJECT_ID);
        if (!project.hasNonNull("name")) {
            project.put("name", "Regression Graph");
        }
        if (!project.hasNonNull("createdAt")) {
            project.put("createdAt", now());
        }
        ObjectNode targets = JsonFiles.objectChild(project, "targets");
        ObjectNode target = JsonFiles.objectChild(targets, TARGET_ID);
        target.put("id", TARGET_ID);
        if (!target.hasNonNull("name")) {
            target.put("name", "Default target");
        }
        if (!target.has("runs")) {
            target.set("runs", JsonFiles.MAPPER.createArrayNode());
        }
        return target;
    }

    private void saveIndex(ObjectNode index) {
        index.put("schemaVersion", SCHEMA_VERSION);
        index.put("updatedAt", now());
        JsonFiles.write(indexPath(), index);
    }

    private Path indexPath() {
        return paths.runtimeDir().resolve("storage-v2").resolve("index.json");
    }

    private Path runPath(String runId) {
        return paths.runtimeDir().resolve("storage-v2").resolve("runs")
                .resolve(PathSafety.safeFileName(runId, "run") + ".json");
    }

    private Path baselinePath(String baselineId) {
        return paths.runtimeDir().resolve("storage-v2").resolve("baselines")
                .resolve(PathSafety.safeFileName(baselineId, "baseline") + ".json");
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static String textOrNull(ObjectNode node, String field) {
        return node.hasNonNull(field) ? node.path(field).asText() : null;
    }

    private static long countJson(Path dir) {
        try (var stream = Files.exists(dir) ? Files.list(dir) : java.util.stream.Stream.<Path>empty()) {
            return stream.filter(path -> path.toString().endsWith(".json")).count();
        } catch (Exception e) {
            return 0;
        }
    }
}
