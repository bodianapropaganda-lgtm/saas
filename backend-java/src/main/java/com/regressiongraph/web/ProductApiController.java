package com.regressiongraph.web;

import tools.jackson.databind.node.ObjectNode;
import com.regressiongraph.service.DiscoveryRunService;
import com.regressiongraph.service.StateService;
import com.regressiongraph.util.JsonFiles;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ProductApiController {
    private final StateService stateService;
    private final DiscoveryRunService discoveryRunService;

    public ProductApiController(StateService stateService, DiscoveryRunService discoveryRunService) {
        this.stateService = stateService;
        this.discoveryRunService = discoveryRunService;
    }

    @GetMapping("/api/state")
    public ObjectNode state() {
        return stateService.buildState();
    }

    @PostMapping("/api/discovery/run")
    public ObjectNode runDiscovery(@RequestBody ObjectNode payload) {
        return discoveryRunService.run(payload);
    }

    @PostMapping("/api/baseline/approve")
    public ObjectNode approveBaseline(@RequestBody ObjectNode payload) {
        return discoveryRunService.approve(payload);
    }

    @PostMapping("/api/runs/delete")
    public ObjectNode deleteRun(@RequestBody ObjectNode payload) {
        return discoveryRunService.deleteRun(payload);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ObjectNode> handle(Exception exception) {
        ObjectNode body = JsonFiles.MAPPER.createObjectNode();
        body.put("ok", false);
        body.put("error", exception.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }
}
