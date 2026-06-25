package com.regressiongraph.util;

import java.nio.file.Files;
import java.nio.file.Path;

public final class PathSafety {
    private PathSafety() {
    }

    public static Path childDirectory(Path parent, String name) {
        if (name == null || name.isBlank() || name.contains("..") || name.contains("/") || name.contains("\\")) {
            throw new IllegalArgumentException("Incorrect directory name");
        }
        Path normalizedParent = parent.toAbsolutePath().normalize();
        Path child = normalizedParent.resolve(name).normalize();
        if (!child.startsWith(normalizedParent)) {
            throw new IllegalArgumentException("Path escapes workspace");
        }
        return child;
    }

    public static Path existingArtifact(Path runsDir, String runId, String artifactName) {
        Path runDir = childDirectory(runsDir, runId);
        Path artifactsDir = runDir.resolve("artifacts").toAbsolutePath().normalize();
        Path target = artifactsDir.resolve(artifactName).normalize();
        if (!target.startsWith(artifactsDir) || !Files.isRegularFile(target)) {
            throw new IllegalArgumentException("Artifact not found");
        }
        return target;
    }

    public static String safeFileName(String value, String fallback) {
        String raw = value == null || value.isBlank() ? fallback : value;
        String safe = raw.replaceAll("[^A-Za-z0-9._-]+", "_");
        if (safe.length() > 120) {
            safe = safe.substring(0, 90) + "_" + Integer.toHexString(raw.hashCode());
        }
        return safe.isBlank() ? fallback : safe;
    }
}
