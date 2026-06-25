package com.regressiongraph.config;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AppPaths {
    private final Path root;

    public AppPaths(@Value("${regression-graph.workspace:..}") String workspace) {
        this.root = Path.of(workspace).toAbsolutePath().normalize();
    }

    public Path root() {
        return root;
    }

    public Path uiDir() {
        return root.resolve("ui");
    }

    public Path runsDir() {
        return root.resolve("runs");
    }

    public Path baselinesDir() {
        return root.resolve("baselines");
    }

    public Path reportsDir() {
        return root.resolve("reports");
    }

    public Path runtimeDir() {
        return root.resolve(".runtime");
    }

    public Path defaultConfig() {
        return root.resolve("discovery").resolve("target-java.json");
    }
}
