package com.regressiongraph.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.util.JsonFiles;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.stereotype.Service;

@Service
public class DiffService {
    public ArrayNode compare(JsonNode oldGraph, JsonNode newGraph) {
        ArrayNode diffs = JsonFiles.MAPPER.createArrayNode();
        Set<String> ignored = ignoredKeys(oldGraph, newGraph);
        compareCollectionKeys(diffs, "pages", oldGraph.path("pages"), newGraph.path("pages"));
        compareCollectionKeys(diffs, "apiEndpoints", oldGraph.path("apiEndpoints"), newGraph.path("apiEndpoints"));
        compareCollectionKeys(diffs, "actions", oldGraph.path("actions"), newGraph.path("actions"));
        comparePages(diffs, oldGraph.path("pages"), newGraph.path("pages"));
        compareApis(diffs, oldGraph.path("apiEndpoints"), newGraph.path("apiEndpoints"), ignored);
        compareActions(diffs, oldGraph.path("actions"), newGraph.path("actions"));
        compareEdges(diffs, oldGraph.path("edges"), newGraph.path("edges"));
        return diffs;
    }

    private void comparePages(ArrayNode diffs, JsonNode oldPages, JsonNode newPages) {
        for (String path : intersection(fieldNames(oldPages), fieldNames(newPages))) {
            JsonNode oldPage = oldPages.path(path);
            JsonNode newPage = newPages.path(path);
            for (String field : List.of("status", "title", "tagCounts", "visibleText")) {
                if (!oldPage.path(field).equals(newPage.path(field))) {
                    ArrayNode patch = JsonFiles.MAPPER.createArrayNode();
                    if ("visibleText".equals(field)) {
                        for (String line : simplePatch(oldPage.path(field), newPage.path(field))) {
                            patch.add(line);
                        }
                    }
                    diffs.add(diff("page:" + path, field, "review", oldPage.path(field), newPage.path(field),
                            "Page " + field + " changed", patch));
                }
            }
        }
    }

    private void compareApis(ArrayNode diffs, JsonNode oldApis, JsonNode newApis, Set<String> ignored) {
        for (String path : intersection(fieldNames(oldApis), fieldNames(newApis))) {
            JsonNode oldApi = oldApis.path(path);
            JsonNode newApi = newApis.path(path);
            if (!oldApi.path("status").equals(newApi.path("status"))) {
                diffs.add(diff("api:" + path, "status", "fail", oldApi.path("status"), newApi.path("status"),
                        "API status changed", null));
            }
            JsonNode oldSchema = stripIgnored(oldApi.path("schema"), ignored);
            JsonNode newSchema = stripIgnored(newApi.path("schema"), ignored);
            if (!oldSchema.equals(newSchema)) {
                diffs.add(diff("api:" + path, "schema", "fail", oldSchema, newSchema, "API schema changed", null));
            }
            JsonNode oldBody = stripIgnored(oldApi.path("normalizedBody"), ignored);
            JsonNode newBody = stripIgnored(newApi.path("normalizedBody"), ignored);
            if (!oldBody.equals(newBody)) {
                ArrayNode patch = JsonFiles.MAPPER.createArrayNode();
                for (String line : simplePatchLines(oldBody, newBody)) {
                    patch.add(line);
                }
                diffs.add(diff("api:" + path, "body", "review", oldBody, newBody, "API body changed", patch));
            }
        }
    }

    private void compareActions(ArrayNode diffs, JsonNode oldActions, JsonNode newActions) {
        for (String id : intersection(fieldNames(oldActions), fieldNames(newActions))) {
            JsonNode oldAction = oldActions.path(id);
            JsonNode newAction = newActions.path(id);
            for (String field : List.of("status", "afterPath", "newEndpoints")) {
                if (!oldAction.path(field).equals(newAction.path(field))) {
                    diffs.add(diff("action:" + id, field, "review", oldAction.path(field), newAction.path(field),
                            "Action " + field + " changed", null));
                }
            }
        }
    }

    private void compareEdges(ArrayNode diffs, JsonNode oldEdges, JsonNode newEdges) {
        List<String> oldList = edgeKeys(oldEdges);
        List<String> newList = edgeKeys(newEdges);
        if (!oldList.equals(newList)) {
            ArrayNode patch = JsonFiles.MAPPER.createArrayNode();
            for (String line : simplePatch(oldList, newList)) {
                patch.add(line);
            }
            diffs.add(diff("graph", "edges", "review", JsonFiles.MAPPER.valueToTree(oldList),
                    JsonFiles.MAPPER.valueToTree(newList), "Discovery graph edges changed", patch));
        }
    }

    private void compareCollectionKeys(ArrayNode diffs, String name, JsonNode oldItems, JsonNode newItems) {
        Set<String> oldKeys = fieldNames(oldItems);
        Set<String> newKeys = fieldNames(newItems);
        String removedSeverity = "pages".equals(name) ? "review" : "fail";
        for (String key : difference(oldKeys, newKeys)) {
            diffs.add(diff(name, "removed", removedSeverity, text(key), JsonFiles.MAPPER.nullNode(),
                    name + " item removed: " + key, null));
        }
        for (String key : difference(newKeys, oldKeys)) {
            diffs.add(diff(name, "added", "review", JsonFiles.MAPPER.nullNode(), text(key),
                    name + " item added: " + key, null));
        }
    }

    private ObjectNode diff(String entity, String kind, String severity, JsonNode oldValue, JsonNode newValue,
                            String message, JsonNode patch) {
        ObjectNode item = JsonFiles.MAPPER.createObjectNode();
        item.put("entity", entity);
        item.put("kind", kind);
        item.put("severity", severity);
        item.set("old", oldValue == null ? JsonFiles.MAPPER.nullNode() : oldValue);
        item.set("new", newValue == null ? JsonFiles.MAPPER.nullNode() : newValue);
        item.put("message", message);
        item.set("patch", patch == null ? JsonFiles.MAPPER.createArrayNode() : patch);
        return item;
    }

    private Set<String> ignoredKeys(JsonNode oldGraph, JsonNode newGraph) {
        Set<String> ignored = new TreeSet<>();
        for (JsonNode graph : List.of(oldGraph, newGraph)) {
            for (JsonNode item : graph.path("limits").path("ignoreJsonKeys")) {
                if (!item.asText("").isBlank()) {
                    ignored.add(item.asText().toLowerCase());
                }
            }
        }
        return ignored;
    }

    private JsonNode stripIgnored(JsonNode value, Set<String> ignored) {
        if (ignored.isEmpty() || value == null || value.isMissingNode()) {
            return value;
        }
        if (value.isObject()) {
            ObjectNode copy = JsonFiles.MAPPER.createObjectNode();
            value.properties().forEach(entry -> {
                if (!ignored.contains(entry.getKey().toLowerCase())) {
                    copy.set(entry.getKey(), stripIgnored(entry.getValue(), ignored));
                }
            });
            return copy;
        }
        if (value.isArray()) {
            ArrayNode copy = JsonFiles.MAPPER.createArrayNode();
            value.forEach(item -> copy.add(stripIgnored(item, ignored)));
            return copy;
        }
        return value;
    }

    private List<String> simplePatch(JsonNode oldValue, JsonNode newValue) {
        List<String> oldLines = new ArrayList<>();
        List<String> newLines = new ArrayList<>();
        oldValue.forEach(item -> oldLines.add(item.asText()));
        newValue.forEach(item -> newLines.add(item.asText()));
        return simplePatch(oldLines, newLines);
    }

    private List<String> simplePatchLines(JsonNode oldValue, JsonNode newValue) {
        try {
            return simplePatch(
                    JsonFiles.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(oldValue).lines().toList(),
                    JsonFiles.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(newValue).lines().toList());
        } catch (Exception e) {
            return List.of("- " + oldValue, "+ " + newValue);
        }
    }

    private List<String> simplePatch(List<String> oldLines, List<String> newLines) {
        if (oldLines.equals(newLines)) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        oldLines.stream().filter(line -> !newLines.contains(line)).limit(80).forEach(line -> result.add("-" + line));
        newLines.stream().filter(line -> !oldLines.contains(line)).limit(80).forEach(line -> result.add("+" + line));
        return result;
    }

    private List<String> edgeKeys(JsonNode edges) {
        List<String> keys = new ArrayList<>();
        for (JsonNode edge : edges) {
            keys.add(edge.path("from").asText() + " --" + edge.path("type").asText() + "--> " + edge.path("target").asText());
        }
        keys.sort(String::compareTo);
        return keys;
    }

    private Set<String> fieldNames(JsonNode node) {
        Set<String> names = new TreeSet<>();
        if (node != null && node.isObject()) {
            node.properties().forEach(entry -> names.add(entry.getKey()));
        }
        return names;
    }

    private Set<String> intersection(Set<String> left, Set<String> right) {
        Set<String> result = new TreeSet<>(left);
        result.retainAll(right);
        return result;
    }

    private Set<String> difference(Set<String> left, Set<String> right) {
        Set<String> result = new TreeSet<>(left);
        result.removeAll(right);
        return result;
    }

    private JsonNode text(String value) {
        return JsonFiles.MAPPER.getNodeFactory().textNode(value);
    }
}
