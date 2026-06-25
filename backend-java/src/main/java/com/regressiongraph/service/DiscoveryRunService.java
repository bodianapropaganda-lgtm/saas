package com.regressiongraph.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.config.AppPaths;
import com.regressiongraph.util.JsonFiles;
import com.regressiongraph.util.PathSafety;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import org.springframework.stereotype.Service;

@Service
public class DiscoveryRunService {
    private final AppPaths paths;
    private final HttpDiscoveryRunner httpDiscoveryRunner;
    private final DiffService diffService;
    private final StorageV2Service storage;

    public DiscoveryRunService(AppPaths paths, HttpDiscoveryRunner httpDiscoveryRunner, DiffService diffService,
                               StorageV2Service storage) {
        this.paths = paths;
        this.httpDiscoveryRunner = httpDiscoveryRunner;
        this.diffService = diffService;
        this.storage = storage;
    }

    public ObjectNode run(ObjectNode payload) {
        String baseUrl = payload.path("baseUrl").asText("").trim();
        if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
            throw new IllegalArgumentException("baseUrl must start with http:// or https://");
        }
        String runId = payload.path("runName").asText("");
        if (runId.isBlank()) {
            runId = "ui-run-" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC).format(Instant.now());
        }
        String baselineId = payload.path("baselineName").asText("ui-baseline");
        Path runDir = PathSafety.childDirectory(paths.runsDir(), runId);
        Path baselineDir = PathSafety.childDirectory(paths.baselinesDir(), baselineId);
        ObjectNode config = buildConfig(payload);

        try {
            Files.createDirectories(runDir);
            writeRunMeta(runDir, payload, baseUrl, baselineId);
            storage.recordRunStarted(runId, baseUrl, baselineId, runDir);
            ObjectNode graph = httpDiscoveryRunner.discover(config, baseUrl, runDir);

            boolean baselineExists = Files.exists(baselineDir.resolve("discovery.json"));
            boolean baseUrlChanged = baselineExists
                    && !trimRight(JsonFiles.read(baselineDir.resolve("discovery.json")).path("baseUrl").asText(""), "/")
                    .equals(trimRight(baseUrl, "/"));
            boolean approve = payload.path("approveAsBaseline").asBoolean(false) || !baselineExists || baseUrlChanged;
            String action;
            int diffs = 0;
            int critical = 0;
            if (approve) {
                deleteDirectory(baselineDir);
                copyDirectory(runDir, baselineDir);
                storage.recordBaseline(baselineId, runId, baselineDir, graph);
                action = (!baselineExists || baseUrlChanged) ? "approved_first_baseline" : "approved";
            } else {
                ArrayNode diffItems = diffService.compare(JsonFiles.read(baselineDir.resolve("discovery.json")), graph);
                diffs = diffItems.size();
                for (JsonNode item : diffItems) {
                    if ("fail".equals(item.path("severity").asText())) {
                        critical++;
                    }
                }
                Files.createDirectories(paths.reportsDir());
                Path reportJson = paths.reportsDir().resolve(runId + "-report.json");
                JsonFiles.write(reportJson, diffItems);
                action = "compared";
            }
            storage.recordRunSuccess(runId, graph, baselineId, action, diffs, critical);
            ObjectNode result = JsonFiles.MAPPER.createObjectNode();
            result.put("ok", true);
            result.put("run", runId);
            result.put("baseline", baselineId);
            result.put("action", action);
            result.put("runner", "java-http");
            return result;
        } catch (Exception e) {
            ObjectNode error = JsonFiles.MAPPER.createObjectNode();
            error.put("kind", "java_discovery_error");
            error.put("message", e.getMessage());
            error.put("baseUrl", baseUrl);
            error.put("createdAt", Instant.now().toString());
            JsonFiles.write(runDir.resolve("run-error.json"), error);
            storage.recordRunError(runId, baseUrl, baselineId, runDir.resolve("run-error.json"));
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public ObjectNode approve(ObjectNode payload) {
        String runId = payload.path("runId").asText("");
        String baselineId = payload.path("baselineName").asText("ui-baseline");
        if (runId.isBlank()) {
            throw new IllegalArgumentException("runId is required");
        }
        Path runDir = PathSafety.childDirectory(paths.runsDir(), runId);
        if (!Files.exists(runDir.resolve("discovery.json"))) {
            throw new IllegalArgumentException("Run not found: " + runId);
        }
        Path baselineDir = PathSafety.childDirectory(paths.baselinesDir(), baselineId);
        deleteDirectory(baselineDir);
        copyDirectory(runDir, baselineDir);
        storage.recordBaseline(baselineId, runId, baselineDir, (ObjectNode) JsonFiles.read(runDir.resolve("discovery.json")));
        ObjectNode result = JsonFiles.MAPPER.createObjectNode();
        result.put("ok", true);
        result.put("baseline", baselineId);
        result.put("run", runId);
        return result;
    }

    public ObjectNode deleteRun(ObjectNode payload) {
        String runId = payload.path("runId").asText("");
        if (runId.isBlank()) {
            throw new IllegalArgumentException("runId is required");
        }
        Path runDir = PathSafety.childDirectory(paths.runsDir(), runId);
        if (!Files.exists(runDir)) {
            throw new IllegalArgumentException("Run not found: " + runId);
        }
        ObjectNode meta = JsonFiles.readObject(runDir.resolve("run-meta.json"));
        String baselineId = meta.path("baselineName").asText("");
        deleteReport(runId);
        String removedBaseline = removeOwnedBaseline(runDir, baselineId, runId);
        deleteDirectory(runDir);
        storage.deleteRun(runId);
        if (removedBaseline != null) {
            storage.deleteBaseline(removedBaseline);
        }
        ObjectNode result = JsonFiles.MAPPER.createObjectNode();
        result.put("ok", true);
        result.put("deleted", runId);
        result.put("removedBaseline", removedBaseline);
        return result;
    }

    private ObjectNode buildConfig(ObjectNode payload) {
        ObjectNode config = JsonFiles.readObject(paths.defaultConfig());
        config.put("name", payload.path("name").asText(config.path("name").asText("java-discovery")));
        copyArray(payload, config, "startPaths", "/");
        copyArray(payload, config, "seedApiPaths", null);
        copyArray(payload, config, "allowedPathPrefixes", "/");
        ObjectNode limits = JsonFiles.objectChild(config, "limits");
        copyInt(payload, limits, "maxPages", 20);
        copyInt(payload, limits, "maxDepth", 2);
        copyInt(payload, limits, "rateLimitMs", 150);
        copyInt(payload, limits, "requestTimeoutSec", 10);
        copyInt(payload, limits, "overallTimeoutSec", 300);
        copyInt(payload, limits, "maxActionsPerPage", 0);
        if (payload.has("ignoreJsonKeys") && payload.path("ignoreJsonKeys").isArray()) {
            limits.set("ignoreJsonKeys", payload.path("ignoreJsonKeys").deepCopy());
        }
        return config;
    }

    private void copyArray(ObjectNode source, ObjectNode target, String field, String fallback) {
        if (source.has(field) && source.path(field).isArray()) {
            target.set(field, source.path(field).deepCopy());
        } else if (!target.has(field)) {
            ArrayNode values = JsonFiles.MAPPER.createArrayNode();
            if (fallback != null) {
                values.add(fallback);
            }
            target.set(field, values);
        }
    }

    private void copyInt(ObjectNode source, ObjectNode target, String field, int fallback) {
        if (source.has(field)) {
            target.put(field, source.path(field).asInt(fallback));
        } else if (!target.has(field)) {
            target.put(field, fallback);
        }
    }

    private void writeRunMeta(Path runDir, ObjectNode payload, String baseUrl, String baselineId) {
        ObjectNode meta = JsonFiles.MAPPER.createObjectNode();
        meta.put("baseUrl", baseUrl);
        meta.put("baselineName", baselineId);
        meta.put("createdAt", Instant.now().toString());
        meta.put("discoveryMode", payload.path("discoveryMode").asText("http"));
        meta.put("source", "spring-boot-product-ui");
        meta.put("runner", "java-http");
        JsonFiles.write(runDir.resolve("run-meta.json"), meta);
    }

    private String removeOwnedBaseline(Path runDir, String baselineId, String runId) {
        if (baselineId == null || baselineId.isBlank()) {
            return null;
        }
        Path baselineDir = paths.baselinesDir().resolve(baselineId);
        if (!Files.exists(baselineDir.resolve("discovery.json"))) {
            return null;
        }
        JsonNode runGraph = JsonFiles.read(runDir.resolve("discovery.json"));
        JsonNode baselineGraph = JsonFiles.read(baselineDir.resolve("discovery.json"));
        if (!fingerprint(runGraph).equals(fingerprint(baselineGraph))) {
            return null;
        }
        try (var stream = Files.exists(paths.runsDir()) ? Files.list(paths.runsDir()) : java.util.stream.Stream.<Path>empty()) {
            boolean referenced = stream
                    .filter(Files::isDirectory)
                    .filter(path -> !path.getFileName().toString().equals(runId))
                    .map(path -> JsonFiles.readObject(path.resolve("run-meta.json")).path("baselineName").asText(""))
                    .anyMatch(baselineId::equals);
            if (referenced) {
                return null;
            }
        } catch (IOException ignored) {
            return null;
        }
        deleteDirectory(baselineDir);
        return baselineId;
    }

    private String fingerprint(JsonNode graph) {
        return graph.path("baseUrl").asText("") + "|" + graph.path("capturedAt").asText("") + "|" + graph.path("summary");
    }

    private void deleteReport(String runId) {
        try {
            Files.deleteIfExists(paths.reportsDir().resolve(runId + "-report.html"));
            Files.deleteIfExists(paths.reportsDir().resolve(runId + "-report.json"));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot delete reports for " + runId, e);
        }
    }

    private void copyDirectory(Path source, Path target) {
        try {
            Files.walk(source).forEach(path -> {
                try {
                    Path relative = source.relativize(path);
                    Path destination = target.resolve(relative);
                    if (Files.isDirectory(path)) {
                        Files.createDirectories(destination);
                    } else {
                        Files.createDirectories(destination.getParent());
                        Files.copy(path, destination, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    }
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            });
        } catch (IOException e) {
            throw new IllegalStateException("Cannot copy directory " + source + " to " + target, e);
        }
    }

    private void deleteDirectory(Path path) {
        if (!Files.exists(path)) {
            return;
        }
        try (var stream = Files.walk(path)) {
            stream.sorted(Comparator.reverseOrder()).forEach(item -> {
                try {
                    Files.deleteIfExists(item);
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            });
        } catch (IOException e) {
            throw new IllegalStateException("Cannot delete directory: " + path, e);
        }
    }

    private String trimRight(String value, String suffix) {
        String result = value == null ? "" : value;
        while (result.endsWith(suffix)) {
            result = result.substring(0, result.length() - suffix.length());
        }
        return result;
    }
}
