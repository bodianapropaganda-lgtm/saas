window.SCAN_DATA = {
  project: "Target Commerce",
  target: {
    project: "Target Commerce",
    environment: "Staging",
    baseUrl: "http://127.0.0.1:8131",
    authProfile: "Test user: qa-catalog-owner",
    policy: "GET + safe POST allowlist",
    startUrls: ["/", "/catalog", "/cart"],
    seedApiPaths: ["/api/health", "/api/products", "/api/cart/summary"],
    limits: {
      maxPages: 20,
      maxDepth: 2,
      rateLimitMs: 150,
      maxActionsPerPage: 12
    },
    guardrails: [
      {
        title: "Лимит запросов",
        text: "Runner делает паузы между запросами и ограничивает параллельность, чтобы не перегружать test env."
      },
      {
        title: "Политика действий",
        text: "Опасные POST/PUT/DELETE выполняются только по allowlist и только на тестовых данных."
      },
      {
        title: "Reset hook",
        text: "Перед прогоном можно вызвать сброс фикстур, чтобы baseline и новый run сравнивались на одинаковом состоянии."
      },
      {
        title: "Маскирование",
        text: "Токены, requestId, timestamps и персональные поля маскируются до попадания в артефакты."
      }
    ]
  },
  runs: [
    {
      id: "run-v2",
      label: "Discovery релиза v2",
      environment: "Staging",
      startedAt: "2026-06-24 12:18",
      pages: 11,
      endpoints: 11,
      diffs: 34,
      status: "fail"
    },
    {
      id: "baseline-v1",
      label: "Baseline v1",
      environment: "Staging",
      startedAt: "2026-06-24 12:00",
      pages: 13,
      endpoints: 13,
      diffs: 0,
      status: "passed"
    },
    {
      id: "run-v1-draft",
      label: "Черновой discovery",
      environment: "QA sandbox",
      startedAt: "2026-06-23 18:42",
      pages: 8,
      endpoints: 9,
      diffs: 7,
      status: "changed"
    }
  ],
  baseline: {
    id: "baseline-v1",
    label: "Baseline v1",
    capturedAt: "2026-06-24T12:00:00Z",
    summary: { pages: 13, endpoints: 13, edges: 338 }
  },
  current: {
    id: "release-v2",
    label: "Релиз v2",
    capturedAt: "2026-06-24T12:18:00Z",
    summary: { pages: 11, endpoints: 11, edges: 242, diffs: 34, critical: 4 }
  },
  nodes: [
    {
      id: "page-home",
      type: "page",
      label: "/",
      title: "Home",
      status: "changed",
      x: 42,
      y: 46,
      summary: "Стартовая страница: изменилась выдача, текст и счетчики.",
      details: {
        url: "/",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        visibleTextDiff: [
          "- Commerce home",
          "+ Revenue dashboard: home",
          "- Products: 10",
          "+ Products: 8",
          "- Cart total: 649.00",
          "+ Cart total: 439.20"
        ],
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        },
        payload: null,
        schema: "HTML page snapshot",
        diffs: [
          { severity: "review", title: "Изменился видимый текст", text: "Изменился заголовок, промо-текст и агрегированные счетчики." },
          { severity: "review", title: "Изменилась DOM-структура", text: "Карточек товара стало 8 вместо 10." }
        ]
      }
    },
    {
      id: "page-catalog",
      type: "page",
      label: "/catalog",
      title: "Catalog",
      status: "changed",
      x: 42,
      y: 176,
      summary: "Каталог показывает 8 товаров вместо 10.",
      details: {
        url: "/catalog",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        visibleTextDiff: [
          "- Catalog overview",
          "+ Revenue dashboard: catalog overview",
          "- SSO Pack",
          "- Compliance Archive",
          "+ Workflow Rules Pro"
        ],
        headers: {
          "content-type": "text/html; charset=utf-8"
        },
        payload: null,
        schema: "HTML page snapshot",
        diffs: [
          { severity: "review", title: "Изменились карточки товаров", text: "Удалены карточки SKU-009 и SKU-010." }
        ]
      }
    },
    {
      id: "page-cart",
      type: "page",
      label: "/cart",
      title: "Cart",
      status: "changed",
      x: 42,
      y: 306,
      summary: "Корзина изменила subtotal и threshold.",
      details: {
        url: "/cart",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        visibleTextDiff: [
          "- Cart summary",
          "+ Cart revenue summary",
          "- Cart total: 649.00",
          "+ Cart total: 439.20"
        ],
        headers: {
          "content-type": "text/html; charset=utf-8"
        },
        payload: null,
        schema: "HTML page snapshot",
        diffs: [
          { severity: "review", title: "Изменился UI корзины", text: "UI отражает новый subtotal из API." }
        ]
      }
    },
    {
      id: "api-products",
      type: "endpoint",
      label: "GET /api/products",
      title: "Products API",
      status: "fail",
      x: 390,
      y: 176,
      summary: "Критичное изменение схемы: price стал float|string.",
      details: {
        url: "/api/products",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        requestHeaders: {
          "user-agent": "autonomous-discovery-mvp/0.1",
          "accept": "application/json"
        },
        responseHeaders: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        },
        payload: {
          baseline: null,
          current: null
        },
        response: {
          baseline: {
            version: "v1",
            count: 10,
            items: [
              { id: "1", title: "Starter Analytics", sku: "SKU-001", price: 19.9, inStock: true },
              { id: "6", title: "Workflow Rules", sku: "SKU-006", price: 69.9, inStock: true },
              { id: "9", title: "SSO Pack", sku: "SKU-009", price: 99.9, inStock: true },
              { id: "10", title: "Compliance Archive", sku: "SKU-010", price: 109.9, inStock: true }
            ]
          },
          current: {
            version: "v2",
            count: 8,
            items: [
              { id: "1", title: "Starter Analytics", sku: "SKU-001", price: 19.9, inStock: true },
              { id: "3", title: "Audit Export", sku: "SKU-003", price: "39.90", inStock: true },
              { id: "6", title: "Workflow Rules Pro", sku: "SKU-006", price: 69.9, inStock: true }
            ]
          }
        },
        schema: {
          baseline: {
            count: "int",
            items: [{ id: "str", title: "str", sku: "str", price: "float", inStock: "bool" }],
            version: "str"
          },
          current: {
            count: "int",
            items: [{ id: "str", title: "str", sku: "str", price: { oneOf: ["float", "str"] }, inStock: "bool" }],
            version: "str"
          }
        },
        diffs: [
          { severity: "fail", title: "Изменилась schema", text: "items[].price: float -> float|string" },
          { severity: "review", title: "Изменился body", text: "count 10 -> 8, удалены SKU-009/SKU-010, переименован SKU-006." }
        ]
      }
    },
    {
      id: "api-cart",
      type: "endpoint",
      label: "GET /api/cart/summary",
      title: "Cart Summary API",
      status: "changed",
      x: 390,
      y: 306,
      summary: "Subtotal и freeShippingThreshold изменились.",
      details: {
        url: "/api/cart/summary",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        requestHeaders: {
          "user-agent": "autonomous-discovery-mvp/0.1",
          "accept": "application/json"
        },
        responseHeaders: {
          "content-type": "application/json; charset=utf-8"
        },
        payload: {
          baseline: null,
          current: null
        },
        response: {
          baseline: { version: "v1", itemsCount: 10, currency: "USD", subtotal: 649.0, freeShippingThreshold: 50 },
          current: { version: "v2", itemsCount: 8, currency: "USD", subtotal: 439.2, freeShippingThreshold: 75 }
        },
        schema: {
          currency: "str",
          freeShippingThreshold: "int",
          itemsCount: "int",
          subtotal: "float",
          version: "str"
        },
        diffs: [
          { severity: "review", title: "Изменились бизнес-значения", text: "itemsCount 10 -> 8, subtotal 649.0 -> 439.2." }
        ]
      }
    },
    {
      id: "api-health",
      type: "endpoint",
      label: "GET /api/health",
      title: "Health API",
      status: "changed",
      x: 390,
      y: 46,
      summary: "Версия backend изменилась с v1 на v2.",
      details: {
        url: "/api/health",
        method: "GET",
        baselineStatus: 200,
        currentStatus: 200,
        requestHeaders: {
          "user-agent": "autonomous-discovery-mvp/0.1"
        },
        responseHeaders: {
          "content-type": "application/json; charset=utf-8"
        },
        payload: {
          baseline: null,
          current: null
        },
        response: {
          baseline: { ok: true, service: "target-commerce", version: "v1", requestId: "<ignored>" },
          current: { ok: true, service: "target-commerce", version: "v2", requestId: "<ignored>" }
        },
        schema: {
          ok: "bool",
          service: "str",
          version: "str",
          requestId: "str"
        },
        diffs: [
          { severity: "review", title: "Изменилась версия", text: "version v1 -> v2." }
        ]
      }
    },
    {
      id: "api-product-9",
      type: "endpoint",
      label: "GET /api/products/9",
      title: "Удаленный Product API",
      status: "removed",
      x: 710,
      y: 176,
      summary: "Endpoint исчез из discovery graph.",
      details: {
        url: "/api/products/9",
        method: "GET",
        baselineStatus: 200,
        currentStatus: "not discovered",
        requestHeaders: {
          "user-agent": "autonomous-discovery-mvp/0.1"
        },
        responseHeaders: {
          "content-type": "application/json; charset=utf-8"
        },
        payload: {
          baseline: null,
          current: null
        },
        response: {
          baseline: { id: "9", title: "SSO Pack", sku: "SKU-009", price: 99.9, inStock: true },
          current: null
        },
        schema: {
          baseline: { id: "str", title: "str", sku: "str", price: "float", inStock: "bool" },
          current: null
        },
        diffs: [
          { severity: "fail", title: "Endpoint удален", text: "Endpoint был в baseline, но не обнаружен в новом graph." }
        ]
      }
    }
  ],
  edges: [
    ["page-home", "api-health"],
    ["page-home", "api-products"],
    ["page-catalog", "api-products"],
    ["page-cart", "api-cart"],
    ["api-products", "api-product-9"],
    ["page-home", "page-catalog"],
    ["page-home", "page-cart"],
    ["page-catalog", "api-cart"]
  ]
};
