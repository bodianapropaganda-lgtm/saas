package com.example.targetapp;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

public class TargetAppServer {
    private final String version;
    private final int port;

    public TargetAppServer(String version, int port) {
        this.version = version;
        this.port = port;
    }

    public static void main(String[] args) throws Exception {
        String version = argValue(args, "--version").orElse("v1");
        int port = Integer.parseInt(argValue(args, "--port").orElse("8020"));
        new TargetAppServer(version, port).start();
    }

    private static Optional<String> argValue(String[] args, String name) {
        for (int i = 0; i < args.length - 1; i++) {
            if (name.equals(args[i])) {
                return Optional.of(args[i + 1]);
            }
        }
        return Optional.empty();
    }

    private void start() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", this::handleHome);
        server.createContext("/api/health", this::handleHealth);
        server.createContext("/api/products", this::handleProducts);
        server.createContext("/api/cart/summary", this::handleCartSummary);
        server.setExecutor(null);
        System.out.printf(Locale.ROOT, "Target app %s running at http://127.0.0.1:%d%n", version, port);
        server.start();
    }

    private void handleHome(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod()) || !"/".equals(exchange.getRequestURI().getPath())) {
            json(exchange, 404, "{\"error\":\"not found\"}");
            return;
        }

        List<Product> products = products();
        String title = isV2() ? "Revenue dashboard: catalog overview" : "Catalog overview";
        String promo = isV2() ? "Promo threshold changed to 75 USD" : "Promo threshold: free shipping from 50 USD";
        StringBuilder cards = new StringBuilder();
        for (Product product : products) {
            cards.append("""
                <article class="product-card" data-product-id="%s">
                  <h2>%s</h2>
                  <p class="sku">%s</p>
                  <p class="price">%s</p>
                </article>
                """.formatted(product.id(), escape(product.title()), product.sku(), product.priceJsonValue()));
        }

        String html = """
            <!doctype html>
            <html>
              <head>
                <meta charset="utf-8">
                <title>Target Commerce</title>
                <style>
                  body { margin: 0; font-family: Arial, sans-serif; background: #f4f7fb; color: #162033; }
                  main { max-width: 1040px; margin: 0 auto; padding: 32px; }
                  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
                  h1 { margin: 0 0 8px; font-size: 32px; }
                  .version { border: 1px solid #cfd7e6; border-radius: 6px; padding: 8px 10px; background: white; }
                  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
                  .metric, .product-card { background: white; border: 1px solid #dfe5ef; border-radius: 8px; padding: 14px; }
                  .metric strong { display: block; font-size: 24px; }
                  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
                  .product-card h2 { margin: 0 0 8px; font-size: 18px; }
                  .sku { color: #647084; }
                  .price { color: #087a55; font-weight: 700; }
                </style>
              </head>
              <body>
                <main>
                  <header>
                    <div>
                      <h1>%s</h1>
                      <p>%s</p>
                    </div>
                    <div class="version">Backend version: %s</div>
                  </header>
                  <section class="summary">
                    <div class="metric"><span>Products</span><strong>%d</strong></div>
                    <div class="metric"><span>In stock</span><strong>%d</strong></div>
                    <div class="metric"><span>Cart total</span><strong>%s</strong></div>
                  </section>
                  <section class="grid">
                    %s
                  </section>
                </main>
              </body>
            </html>
            """.formatted(title, promo, version, products.size(), inStock(products), cartTotal(products), cards);
        html(exchange, 200, html);
    }

    private void handleHealth(HttpExchange exchange) throws IOException {
        json(exchange, 200, """
            {
              "ok": true,
              "service": "target-commerce",
              "version": "%s",
              "requestId": "req-20260624-target"
            }
            """.formatted(version));
    }

    private void handleProducts(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            json(exchange, 405, "{\"error\":\"method not allowed\"}");
            return;
        }

        String path = exchange.getRequestURI().getPath();
        if ("/api/products".equals(path)) {
            List<Product> products = products();
            StringBuilder items = new StringBuilder();
            for (int i = 0; i < products.size(); i++) {
                if (i > 0) {
                    items.append(",");
                }
                items.append(products.get(i).toJson());
            }
            json(exchange, 200, """
                {
                  "version": "%s",
                  "generatedAt": "2026-06-24T00:00:00Z",
                  "count": %d,
                  "items": [%s]
                }
                """.formatted(version, products.size(), items));
            return;
        }

        String prefix = "/api/products/";
        if (path.startsWith(prefix)) {
            String id = path.substring(prefix.length());
            for (Product product : products()) {
                if (product.id().equals(id)) {
                    json(exchange, 200, product.toJson());
                    return;
                }
            }
            json(exchange, 404, "{\"error\":\"product not found\"}");
            return;
        }

        json(exchange, 404, "{\"error\":\"not found\"}");
    }

    private void handleCartSummary(HttpExchange exchange) throws IOException {
        List<Product> products = products();
        json(exchange, 200, """
            {
              "version": "%s",
              "itemsCount": %d,
              "currency": "USD",
              "subtotal": %s,
              "freeShippingThreshold": %d
            }
            """.formatted(version, products.size(), cartTotal(products), isV2() ? 75 : 50));
    }

    private List<Product> products() {
        List<Product> base = new ArrayList<>(List.of(
            new Product("1", "Starter Analytics", "SKU-001", new BigDecimal("19.90"), true, false),
            new Product("2", "Team Dashboard", "SKU-002", new BigDecimal("29.90"), true, false),
            new Product("3", "Audit Export", "SKU-003", new BigDecimal("39.90"), true, false),
            new Product("4", "SLA Monitor", "SKU-004", new BigDecimal("49.90"), true, false),
            new Product("5", "Alert Routing", "SKU-005", new BigDecimal("59.90"), false, false),
            new Product("6", "Workflow Rules", "SKU-006", new BigDecimal("69.90"), true, false),
            new Product("7", "Usage Forecast", "SKU-007", new BigDecimal("79.90"), true, false),
            new Product("8", "Premium Support", "SKU-008", new BigDecimal("89.90"), true, false),
            new Product("9", "SSO Pack", "SKU-009", new BigDecimal("99.90"), true, false),
            new Product("10", "Compliance Archive", "SKU-010", new BigDecimal("109.90"), true, false)
        ));

        if (!isV2()) {
            return base;
        }

        List<Product> changed = new ArrayList<>(base.subList(0, 8));
        changed.set(2, new Product("3", "Audit Export", "SKU-003", new BigDecimal("39.90"), true, true));
        changed.set(5, new Product("6", "Workflow Rules Pro", "SKU-006", new BigDecimal("69.90"), true, false));
        return changed;
    }

    private boolean isV2() {
        return "v2".equals(version);
    }

    private static long inStock(List<Product> products) {
        return products.stream().filter(Product::inStock).count();
    }

    private static String cartTotal(List<Product> products) {
        BigDecimal total = BigDecimal.ZERO;
        for (Product product : products) {
            total = total.add(product.price());
        }
        return total.toPlainString();
    }

    private static String escape(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;");
    }

    private static void html(HttpExchange exchange, int status, String body) throws IOException {
        respond(exchange, status, "text/html; charset=utf-8", body);
    }

    private static void json(HttpExchange exchange, int status, String body) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        headers.add("Access-Control-Allow-Origin", "*");
        respond(exchange, status, "application/json; charset=utf-8", body);
    }

    private static void respond(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.add("Content-Type", contentType);
        headers.add("Content-Length", String.valueOf(payload.length));
        exchange.sendResponseHeaders(status, payload.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(payload);
        }
    }

    private record Product(String id, String title, String sku, BigDecimal price, boolean inStock, boolean priceAsString) {
        String priceJsonValue() {
            String value = price.toPlainString();
            return priceAsString ? "\"" + value + "\"" : value;
        }

        String toJson() {
            return """
                {
                  "id": "%s",
                  "title": "%s",
                  "sku": "%s",
                  "price": %s,
                  "inStock": %s
                }
                """.formatted(id, jsonEscape(title), sku, priceJsonValue(), inStock);
        }

        private static String jsonEscape(String value) {
            return value.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }
}
