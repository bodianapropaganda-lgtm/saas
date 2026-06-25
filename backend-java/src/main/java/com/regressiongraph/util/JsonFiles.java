package com.regressiongraph.util;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class JsonFiles {
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonFiles() {
    }

    public static JsonNode read(Path path) {
        try {
            if (!Files.exists(path)) {
                return MAPPER.createObjectNode();
            }
            return MAPPER.readTree(path.toFile());
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }

    public static ObjectNode readObject(Path path) {
        JsonNode node = read(path);
        return node.isObject() ? (ObjectNode) node : MAPPER.createObjectNode();
    }

    public static ObjectNode objectChild(ObjectNode parent, String field) {
        JsonNode existing = parent.path(field);
        if (existing.isObject()) {
            return (ObjectNode) existing;
        }
        ObjectNode created = MAPPER.createObjectNode();
        parent.set(field, created);
        return created;
    }

    public static void write(Path path, JsonNode value) {
        try {
            Files.createDirectories(path.getParent());
            MAPPER.writeValue(path.toFile(), value);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot write JSON file: " + path, e);
        }
    }
}
