import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


PRODUCTS_V1 = [
    {"id": i, "title": f"Product {i}", "price": round(10 + i * 1.75, 2)}
    for i in range(1, 11)
]

PRODUCTS_V2 = [
    {"id": i, "title": f"Product {i}", "price": round(10 + i * 1.75, 2)}
    for i in range(1, 9)
]
PRODUCTS_V2[2]["price"] = "15.25"
PRODUCTS_V2[5]["title"] = "Product 6 - renamed"


def page_html(version, products):
    heading = "Featured products" if version == "v1" else "Featured products this week"
    promo = "Free shipping over $50" if version == "v1" else "Free shipping over $75"
    cards = "\n".join(
        f"""
        <article class="card" data-product-id="{p['id']}">
          <h2>{p['title']}</h2>
          <span class="price">{p['price']}</span>
        </article>
        """
        for p in products
    )
    return f"""<!doctype html>
<html>
  <head>
    <title>Demo Commerce</title>
    <style>
      body {{ font-family: Arial, sans-serif; margin: 40px; }}
      main {{ max-width: 900px; margin: 0 auto; }}
      .grid {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }}
      .card {{ border: 1px solid #ddd; padding: 12px; border-radius: 6px; }}
      .price {{ color: #0a6; font-weight: bold; }}
    </style>
  </head>
  <body>
    <main>
      <h1>{heading}</h1>
      <p>{promo}</p>
      <p>Total products: {len(products)}</p>
      <section class="grid">
        {cards}
      </section>
    </main>
  </body>
</html>"""


class DemoHandler(BaseHTTPRequestHandler):
    app_version = "v1"

    def do_GET(self):
        parsed = urlparse(self.path)
        products = PRODUCTS_V1 if self.app_version == "v1" else PRODUCTS_V2

        if parsed.path == "/":
            self.respond(200, "text/html; charset=utf-8", page_html(self.app_version, products))
            return

        if parsed.path == "/api/products":
            body = {
                "version": self.app_version,
                "generatedAt": "2026-06-24T00:00:00Z",
                "items": products,
                "count": len(products),
            }
            self.respond_json(200, body)
            return

        if parsed.path == "/api/health":
            self.respond_json(200, {"ok": True, "version": self.app_version, "requestId": "req-12345"})
            return

        self.respond_json(404, {"error": "not found"})

    def respond_json(self, status, value):
        self.respond(status, "application/json; charset=utf-8", json.dumps(value, indent=2))

    def respond(self, status, content_type, body):
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=["v1", "v2"], default="v1")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    DemoHandler.app_version = args.version
    server = ThreadingHTTPServer(("127.0.0.1", args.port), DemoHandler)
    print(f"Demo app {args.version} running at http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
