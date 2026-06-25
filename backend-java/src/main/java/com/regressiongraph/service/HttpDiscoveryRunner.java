package com.regressiongraph.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.util.JsonFiles;
import com.regressiongraph.util.PathSafety;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.stereotype.Service;

@Service
public class HttpDiscoveryRunner {
    public ObjectNode discover(ObjectNode config, String baseUrl, Path outDir) {
        try {
            Path artifactsDir = outDir.resolve("artifacts");
            Files.createDirectories(artifactsDir);
            ObjectNode limits = JsonFiles.objectChild(config, "limits");
            int maxPages = limits.path("maxPages").asInt(20);
            int maxDepth = limits.path("maxDepth").asInt(2);
            int rateLimitMs = limits.path("rateLimitMs").asInt(150);
            int requestTimeoutSec = limits.path("requestTimeoutSec").asInt(10);
            Set<String> allowedPrefixes = strings(config.path("allowedPathPrefixes"));
            if (allowedPrefixes.isEmpty()) {
                allowedPrefixes.add("/");
                allowedPrefixes.add("/api/");
            }

            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(requestTimeoutSec))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();

            ObjectNode pages = JsonFiles.MAPPER.createObjectNode();
            ObjectNode apiEndpoints = JsonFiles.MAPPER.createObjectNode();
            ArrayNode edges = JsonFiles.MAPPER.createArrayNode();
            Set<String> edgeSeen = new HashSet<>();
            ArrayDeque<Route> queue = new ArrayDeque<>();
            Set<String> queued = new HashSet<>();
            for (String path : strings(config.path("startPaths"))) {
                queue.add(new Route(normalizePath(path), 0));
                queued.add(normalizePath(path));
            }
            if (queue.isEmpty()) {
                queue.add(new Route("/", 0));
                queued.add("/");
            }

            while (!queue.isEmpty() && pages.size() < maxPages) {
                Route route = queue.removeFirst();
                HttpResponse<String> response = fetch(client, baseUrl, route.path(), requestTimeoutSec);
                ObjectNode page = pageSnapshot(baseUrl, route.path(), response, artifactsDir);
                pages.set(route.path(), page);
                if (response != null && response.body() != null && response.statusCode() < 500) {
                    Document document = Jsoup.parse(response.body(), absolute(baseUrl, route.path()));
                    LinkedHashSet<String> links = new LinkedHashSet<>();
                    document.select("a[href]").forEach(link -> {
                        String normalized = normalizeInternal(baseUrl, link.absUrl("href"));
                        if (normalized != null && allowed(normalized, allowedPrefixes)) {
                            links.add(normalized);
                        }
                    });
                    ArrayNode linkArray = JsonFiles.MAPPER.createArrayNode();
                    links.forEach(linkArray::add);
                    page.set("links", linkArray);
                    if (route.depth() < maxDepth) {
                        for (String linked : links) {
                            if (!queued.contains(linked) && !linked.startsWith("/api/") && pages.size() + queue.size() < maxPages) {
                                queue.add(new Route(linked, route.depth() + 1));
                                queued.add(linked);
                                addEdge(edges, edgeSeen, route.path(), "link", linked);
                            }
                        }
                    }
                }
                sleep(rateLimitMs);
            }

            for (String seed : strings(config.path("seedApiPaths"))) {
                String path = normalizePath(seed);
                HttpResponse<String> response = fetch(client, baseUrl, path, requestTimeoutSec);
                apiEndpoints.set(path, apiSnapshot(baseUrl, path, response, artifactsDir, "seed"));
                addEdge(edges, edgeSeen, "/", "seed:GET", path);
                sleep(rateLimitMs);
            }

            ObjectNode graph = JsonFiles.MAPPER.createObjectNode();
            graph.put("name", config.path("name").asText("java-discovery"));
            graph.put("baseUrl", trimRight(baseUrl, "/"));
            graph.put("capturedAt", Instant.now().toString());
            graph.set("limits", limits.deepCopy());
            graph.set("pages", pages);
            graph.set("apiEndpoints", apiEndpoints);
            graph.set("actions", JsonFiles.MAPPER.createObjectNode());
            graph.set("edges", edges);
            ObjectNode console = JsonFiles.MAPPER.createObjectNode();
            console.set("events", JsonFiles.MAPPER.createArrayNode());
            console.set("errors", JsonFiles.MAPPER.createArrayNode());
            graph.set("console", console);
            ObjectNode summary = JsonFiles.MAPPER.createObjectNode();
            summary.put("pages", pages.size());
            summary.put("apiEndpoints", apiEndpoints.size());
            summary.put("edges", edges.size());
            graph.set("summary", summary);
            JsonFiles.write(outDir.resolve("discovery.json"), graph);
            return graph;
        } catch (Exception e) {
            throw new IllegalStateException("Java HTTP discovery failed: " + e.getMessage(), e);
        }
    }

    private ObjectNode pageSnapshot(String baseUrl, String path, HttpResponse<String> response, Path artifactsDir) throws IOException {
        ObjectNode page = JsonFiles.MAPPER.createObjectNode();
        String artifact = "page-" + PathSafety.safeFileName(path, "root") + ".html";
        String body = response == null ? "" : response.body();
        Files.writeString(artifactsDir.resolve(artifact), body == null ? "" : body, StandardCharsets.UTF_8);
        Document document = Jsoup.parse(body == null ? "" : body, absolute(baseUrl, path));
        page.put("path", path);
        page.put("url", absolute(baseUrl, path));
        page.put("source", "java-http");
        page.put("status", response == null ? "request-error" : String.valueOf(response.statusCode()));
        page.put("title", document.title());
        page.put("artifact", artifact);
        page.set("visibleText", visibleText(document));
        page.set("tagCounts", tagCounts(document));
        if (!page.has("links")) {
            page.set("links", JsonFiles.MAPPER.createArrayNode());
        }
        return page;
    }

    private ObjectNode apiSnapshot(String baseUrl, String path, HttpResponse<String> response, Path artifactsDir, String source) throws IOException {
        ObjectNode api = JsonFiles.MAPPER.createObjectNode();
        String artifact = "api-" + PathSafety.safeFileName(path, "api") + ".json";
        String body = response == null ? "" : response.body();
        JsonNode normalizedBody;
        try {
            normalizedBody = JsonFiles.MAPPER.readTree(body);
        } catch (Exception e) {
            normalizedBody = JsonFiles.MAPPER.getNodeFactory().textNode(body == null ? "" : body);
        }
        Files.writeString(artifactsDir.resolve(artifact), body == null ? "" : body, StandardCharsets.UTF_8);
        api.put("path", path);
        api.put("url", absolute(baseUrl, path));
        api.put("method", "GET");
        api.put("status", response == null ? "request-error" : String.valueOf(response.statusCode()));
        api.put("resourceType", "seed-api");
        ArrayNode sources = JsonFiles.MAPPER.createArrayNode();
        sources.add(source);
        api.set("sources", sources);
        api.set("requestHeaders", JsonFiles.MAPPER.createObjectNode());
        api.set("responseHeaders", headers(response));
        api.putNull("requestBody");
        api.set("normalizedBody", normalizedBody);
        api.set("schema", schema(normalizedBody));
        api.put("artifact", artifact);
        return api;
    }

    private HttpResponse<String> fetch(HttpClient client, String baseUrl, String path, int timeoutSec) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(absolute(baseUrl, path)))
                    .timeout(Duration.ofSeconds(timeoutSec))
                    .header("User-Agent", "regression-graph-java/0.1")
                    .GET()
                    .build();
            return client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private ArrayNode visibleText(Document document) {
        ArrayNode lines = JsonFiles.MAPPER.createArrayNode();
        document.body().text().lines()
                .map(String::trim)
                .filter(line -> !line.isBlank())
                .limit(80)
                .forEach(lines::add);
        return lines;
    }

    private ObjectNode tagCounts(Document document) {
        ObjectNode counts = JsonFiles.MAPPER.createObjectNode();
        Map<String, Integer> values = new HashMap<>();
        document.getAllElements().forEach(element -> values.merge(element.tagName(), 1, Integer::sum));
        values.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> counts.put(entry.getKey(), entry.getValue()));
        return counts;
    }

    private ObjectNode headers(HttpResponse<String> response) {
        ObjectNode headers = JsonFiles.MAPPER.createObjectNode();
        if (response == null) {
            return headers;
        }
        response.headers().map().forEach((key, values) -> headers.put(key, String.join(", ", values)));
        return headers;
    }

    private JsonNode schema(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            return JsonFiles.MAPPER.getNodeFactory().textNode("null");
        }
        if (value.isObject()) {
            ObjectNode schema = JsonFiles.MAPPER.createObjectNode();
            value.properties().forEach(entry -> schema.set(entry.getKey(), schema(entry.getValue())));
            return schema;
        }
        if (value.isArray()) {
            ArrayNode array = JsonFiles.MAPPER.createArrayNode();
            if (!value.isEmpty()) {
                array.add(schema(value.get(0)));
            }
            return array;
        }
        return JsonFiles.MAPPER.getNodeFactory().textNode(value.getNodeType().name().toLowerCase());
    }

    private void addEdge(ArrayNode edges, Set<String> seen, String from, String type, String target) {
        String key = from + "|" + type + "|" + target;
        if (!seen.add(key)) {
            return;
        }
        ObjectNode edge = JsonFiles.MAPPER.createObjectNode();
        edge.put("from", from);
        edge.put("type", type);
        edge.put("target", target);
        edges.add(edge);
    }

    private Set<String> strings(JsonNode node) {
        Set<String> values = new LinkedHashSet<>();
        if (node != null && node.isArray()) {
            node.forEach(item -> {
                if (!item.asText("").isBlank()) {
                    values.add(item.asText());
                }
            });
        }
        return values;
    }

    private boolean allowed(String path, Set<String> prefixes) {
        return prefixes.stream().anyMatch(path::startsWith);
    }

    private String normalizeInternal(String baseUrl, String rawUrl) {
        try {
            URI base = URI.create(baseUrl);
            URI uri = URI.create(rawUrl);
            if (!base.getHost().equalsIgnoreCase(uri.getHost())) {
                return null;
            }
            return normalizePath((uri.getRawPath() == null || uri.getRawPath().isBlank() ? "/" : uri.getRawPath())
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
        } catch (Exception e) {
            return null;
        }
    }

    private String normalizePath(String path) {
        if (path == null || path.isBlank()) {
            return "/";
        }
        if (path.startsWith("http://") || path.startsWith("https://")) {
            URI uri = URI.create(path);
            return normalizePath((uri.getRawPath() == null ? "/" : uri.getRawPath())
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
        }
        return path.startsWith("/") ? path : "/" + path;
    }

    private String absolute(String baseUrl, String path) {
        return trimRight(baseUrl, "/") + normalizePath(path);
    }

    private String trimRight(String value, String suffix) {
        String result = value == null ? "" : value;
        while (result.endsWith(suffix)) {
            result = result.substring(0, result.length() - suffix.length());
        }
        return result;
    }

    private void sleep(int millis) {
        if (millis <= 0) {
            return;
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private record Route(String path, int depth) {
    }
}
