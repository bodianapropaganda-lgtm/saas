package com.regressiongraph.web;

import com.regressiongraph.config.AppPaths;
import com.regressiongraph.util.PathSafety;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StaticFileController {
    private final AppPaths paths;

    public StaticFileController(AppPaths paths) {
        this.paths = paths;
    }

    @GetMapping(value = {
            "/",
            "/ui",
            "/ui/",
            "/target",
            "/runs",
            "/review",
            "/catalog",
            "/catalog/endpoints",
            "/catalog/pages",
            "/catalog/seed",
            "/actions",
            "/graph"
    })
    public ResponseEntity<Resource> index() throws IOException {
        return file(paths.uiDir().resolve("index.html"), "text/html; charset=utf-8");
    }

    @GetMapping("/app.js")
    public ResponseEntity<Resource> appJs() throws IOException {
        return file(paths.uiDir().resolve("app.js"), "text/javascript; charset=utf-8");
    }

    @GetMapping("/styles.css")
    public ResponseEntity<Resource> styles() throws IOException {
        return file(paths.uiDir().resolve("styles.css"), "text/css; charset=utf-8");
    }

    @GetMapping("/reports/{fileName}")
    public ResponseEntity<Resource> report(@PathVariable String fileName) throws IOException {
        Path report = paths.reportsDir().resolve(fileName).toAbsolutePath().normalize();
        if (!report.startsWith(paths.reportsDir().toAbsolutePath().normalize()) || !Files.isRegularFile(report)) {
            return ResponseEntity.notFound().build();
        }
        return file(report, contentType(report));
    }

    @GetMapping("/artifacts/{runId}/{artifactName}")
    public ResponseEntity<Resource> artifact(@PathVariable String runId, @PathVariable String artifactName) throws IOException {
        Path artifact = PathSafety.existingArtifact(paths.runsDir(), runId, artifactName);
        return file(artifact, contentType(artifact));
    }

    private ResponseEntity<Resource> file(Path path, String contentType) throws IOException {
        if (!Files.isRegularFile(path)) {
            return ResponseEntity.notFound().build();
        }
        ByteArrayResource resource = new ByteArrayResource(Files.readAllBytes(path));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .contentLength(resource.contentLength())
                .body(resource);
    }

    private String contentType(Path path) {
        String name = path.getFileName().toString().toLowerCase();
        if (name.endsWith(".html")) {
            return "text/html; charset=utf-8";
        }
        if (name.endsWith(".css")) {
            return "text/css; charset=utf-8";
        }
        if (name.endsWith(".js")) {
            return "text/javascript; charset=utf-8";
        }
        if (name.endsWith(".json")) {
            return "application/json; charset=utf-8";
        }
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".txt") || name.endsWith(".log")) {
            return "text/plain; charset=utf-8";
        }
        return "application/octet-stream";
    }
}
