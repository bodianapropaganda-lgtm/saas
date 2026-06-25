let data = null;
let activeView = "overview";
let selectedId = null;
let selectedRunId = null;
let selectedActionId = null;
let selectedIssueKey = null;
let endpointFilter = "all";
let catalogMode = "discovered";
const ignoredIssues = new Set(JSON.parse(localStorage.getItem("ignoredIssues") || "[]"));
const manualSeedApiPaths = new Set(JSON.parse(localStorage.getItem("manualSeedApiPaths") || "[]"));
let manualSeedEndpointSpecs = JSON.parse(localStorage.getItem("manualSeedEndpointSpecs") || "[]");
const graphState = {
  scale: 1,
  x: 0,
  y: 0,
  showAllEdges: false
};

const viewRoutes = {
  overview: "/",
  target: "/target",
  runs: "/runs",
  review: "/review",
  catalog: "/catalog/endpoints",
  actions: "/actions",
  graph: "/graph"
};

const viewRoot = document.getElementById("view-root");
const detailsEl = document.getElementById("details-drawer");
const viewTitleEl = document.getElementById("view-title");
const topbarProjectEl = document.getElementById("topbar-project");
const statusStripEl = document.getElementById("status-strip");
const drawerResize = {
  active: false,
  min: 340,
  maxViewportRatio: 0.5
};

const viewTitles = {
  overview: "Обзор regression discovery",
  target: "Цель сканирования",
  runs: "История прогонов",
  review: "Очередь ревью",
  catalog: "Каталог discovery",
  actions: "Actions: page -> action -> network",
  graph: "Graph поведения"
};

function statusLabel(status) {
  return {
    changed: "Изменено",
    fail: "Ошибка",
    removed: "Удалено",
    ok: "OK",
    passed: "Пройдено",
    running: "Выполняется",
    queued: "В очереди"
  }[status] || status;
}

function severityLabel(severity) {
  return {
    review: "На ревью",
    fail: "Ошибка",
    changed: "Изменено",
    removed: "Удалено",
    ok: "OK"
  }[severity] || severity;
}

async function loadState() {
  showLoading();
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(`API вернул ${response.status}`);
    data = await response.json();
    selectedId = selectedId || data.nodes[0]?.id || null;
    renderShell();
    updateActiveRouteUi();
    renderView();
  } catch (error) {
    viewRoot.innerHTML = `
      <section class="card">
        <h2>UI нужно открыть через product server</h2>
        <p class="muted">Сейчас страница не может получить реальные данные ядра. Запусти <code>run_product_ui.bat</code> и открой <code>http://127.0.0.1:8765</code>.</p>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
    detailsEl.innerHTML = "";
  }
}

function showLoading() {
  viewRoot.innerHTML = `<section class="card"><h2>Загружаю реальные данные ядра...</h2><p class="muted">Читаю runs, baselines и reports.</p></section>`;
}

function renderShell() {
  topbarProjectEl.textContent = `Проект: ${data.project}`;
  const baselinePages = data.baseline.summary.pages || 0;
  const currentPages = data.current.summary.pages || 0;
  const diffCount = data.current.summary.diffs || 0;
  const critical = data.current.summary.critical || 0;
  statusStripEl.innerHTML = `
    <article><span>Baseline</span><strong>${data.baseline.label || "нет"} · ${baselinePages} pages</strong></article>
    <article><span>Текущий прогон</span><strong>${data.current.label || "нет"} · ${diffCount} diff</strong></article>
    <article><span>Критично</span><strong>${critical} ошибок</strong></article>
    <article><span>Последний запуск</span><strong>${formatDate(data.current.capturedAt)}</strong></article>
    <article><span>Storage V2</span><strong>${data.storage?.runRecords || 0} runs · schema ${data.storage?.schemaVersion || "-"}</strong></article>
  `;
}

function saveIgnoredIssues() {
  localStorage.setItem("ignoredIssues", JSON.stringify([...ignoredIssues]));
}

function saveManualSeedApiPaths() {
  localStorage.setItem("manualSeedApiPaths", JSON.stringify([...manualSeedApiPaths].sort()));
}

function saveManualSeedEndpointSpecs() {
  localStorage.setItem("manualSeedEndpointSpecs", JSON.stringify(manualSeedEndpointSpecs));
}

function configuredSeedApiPaths() {
  return [...new Set([...(data?.target?.seedApiPaths || []), ...manualSeedApiPaths, ...manualSeedEndpointSpecs.map((item) => item.path)])].filter(Boolean).sort();
}

function seedEndpointSpecs() {
  const byPath = new Map();
  configuredSeedApiPaths().forEach((path) => byPath.set(path, {path, method: "GET"}));
  manualSeedEndpointSpecs.forEach((item) => byPath.set(item.path, {...item, method: item.method || "GET"}));
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function applyRouteFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);
  const routeView = {
    "/": "overview",
    "/ui": "overview",
    "/target": "target",
    "/runs": "runs",
    "/review": "review",
    "/catalog": "catalog",
    "/catalog/endpoints": "catalog",
    "/catalog/pages": "catalog",
    "/catalog/seed": "catalog",
    "/actions": "actions",
    "/graph": "graph"
  }[path] || "overview";

  activeView = routeView;
  if (path === "/catalog/pages") catalogMode = "pages";
  if (path === "/catalog/seed") catalogMode = "seed";
  if (path === "/catalog" || path === "/catalog/endpoints") catalogMode = "discovered";
  selectedId = params.get("entity");
  selectedRunId = params.get("run");
  selectedActionId = params.get("action");
  selectedIssueKey = params.get("issue");
}

function routeForView(view) {
  if (view === "catalog") {
    if (catalogMode === "pages") return "/catalog/pages";
    if (catalogMode === "seed") return "/catalog/seed";
    return "/catalog/endpoints";
  }
  return viewRoutes[view] || "/";
}

function syncUrl(replace = false) {
  const params = new URLSearchParams();
  if (selectedRunId) params.set("run", selectedRunId);
  if (selectedActionId) params.set("action", selectedActionId);
  if (selectedId && !selectedRunId && !selectedActionId) params.set("entity", selectedId);
  if (selectedIssueKey) params.set("issue", selectedIssueKey);
  const query = params.toString();
  const next = `${routeForView(activeView)}${query ? `?${query}` : ""}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", next);
}

function selectedNode() {
  if (selectedRunId) return null;
  return data.nodes.find((node) => node.id === selectedId) || data.nodes[0] || null;
}

function selectedRun() {
  return data.runs.find((run) => run.id === selectedRunId) || null;
}

function selectedAction() {
  if (!selectedActionId) return null;
  return (data.actions || []).find((action) => action.id === selectedActionId) || null;
}

function endpointNodes() {
  return data.nodes.filter((node) => node.type === "endpoint");
}

function setView(view, options = {}) {
  activeView = view;
  if (!options.preserveSelection) {
    selectedId = null;
    selectedRunId = null;
    selectedActionId = null;
    selectedIssueKey = null;
  }
  updateActiveRouteUi();
  syncUrl(options.replaceUrl);
  renderView();
}

function updateActiveRouteUi() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeView);
  });
  viewTitleEl.textContent = viewTitles[activeView] || viewTitles.overview;
}

function renderView() {
  if (!data) return;
  if (activeView === "target") renderTargetView();
  if (activeView === "runs") renderRunsView();
  if (activeView === "review") renderReviewView();
  if (activeView === "catalog") renderCatalogView();
  if (activeView === "actions") renderActionsView();
  if (activeView === "graph") renderGraphView();
  if (activeView === "overview") renderOverviewView();
  renderDetails();
}

function renderOverviewView() {
  viewRoot.innerHTML = `
    <div class="view-grid">
      <section class="two-col">
        <article class="card">
          <div class="section-title">
            <div>
              <h2>Текущий regression-прогон</h2>
              <p>Реальное сравнение последнего discovery run с утвержденным baseline.</p>
            </div>
            ${data.current.reportUrl ? `<a class="button-link" href="${data.current.reportUrl}" target="_blank">Открыть HTML report</a>` : ""}
          </div>
          <div class="run-list">${data.runs.map(runCard).join("") || emptyLine("Прогонов пока нет.")}</div>
        </article>
        <article class="card">
          <div class="section-title">
            <div>
              <h2>Что требует внимания</h2>
              <p>Изменения из реального diff, которые нужно принять как норму или разобрать как баг.</p>
            </div>
          </div>
          <div class="review-list">${reviewItems().slice(0, 4).map(reviewItem).join("") || emptyLine("Отличий нет.")}</div>
        </article>
      </section>
      ${renderConsoleSummary()}
      <section class="graph-card">
        <div class="section-title">
          <div>
            <h2>Схема UI/API</h2>
            <p>Построена из последнего discovery.json: страницы, endpoint и найденные связи.</p>
          </div>
          <div class="inline-actions">
            <button class="secondary" data-view="catalog" type="button">Каталог endpoint</button>
            <button class="secondary" data-view="graph" type="button">Полный graph</button>
          </div>
        </div>
        <div class="graph" id="overview-graph"></div>
      </section>
    </div>
  `;
  bindViewButtons();
  bindRunButtons();
  bindReviewButtons();
  renderGraphInto(document.getElementById("overview-graph"), data.nodes, data.edges);
}

function renderConsoleSummary() {
  const errors = data.console?.errors || [];
  const artifactUrl = data.console?.artifactUrl;
  return `
    <section class="card console-card">
      <div class="section-title">
        <div>
          <h2>Browser console</h2>
          <p>${errors.length ? `${errors.length} console/page errors captured during browser run.` : "Console errors не найдены в текущем browser run."}</p>
        </div>
        ${artifactUrl ? `<a class="button-link" href="${artifactUrl}" target="_blank">Открыть console-log.json</a>` : ""}
      </div>
      ${errors.length ? `
        <div class="console-list">
          ${errors.slice(0, 5).map((item) => `<div class="console-item"><span class="pill fail">${escapeHtml(item.type)}</span><strong>${escapeHtml(item.page || "-")}</strong><p>${escapeHtml(item.text || "")}</p></div>`).join("")}
        </div>
      ` : emptyLine("Ошибок в browser console нет.")}
    </section>
  `;
}

function renderTargetView() {
  const target = data.target;
  viewRoot.innerHTML = `
    <section class="two-col">
      <article class="config-card">
        <div class="section-title">
          <div>
            <h2>Цель сканирования</h2>
            <p>Эта форма запускает реальный discovery-runner поверх текущего core.</p>
          </div>
          <span class="badge">${target.environment}</span>
        </div>
        <form id="run-form" class="form-grid">
          <label class="field">
            <span>Название прогона</span>
            <input name="runName" value="ui-run-${dateStamp()}">
          </label>
          <label class="field">
            <span>Baseline</span>
            <input name="baselineName" value="${data.baseline.id || "ui-baseline"}">
          </label>
          <label class="field full">
            <span>Base URL</span>
            <input name="baseUrl" value="${target.baseUrl || "http://127.0.0.1:8131"}">
          </label>
          <label class="field full">
            <span>Discovery mode</span>
            <select name="discoveryMode">
              <option value="http">HTTP only: pages + seed API</option>
              <option value="browser" selected>Browser + Network: pages + XHR/fetch</option>
            </select>
          </label>
          <label class="field">
            <span>Максимум pages</span>
            <input name="maxPages" value="${target.limits.maxPages}">
          </label>
          <label class="field">
            <span>Max depth</span>
            <input name="maxDepth" value="${target.limits.maxDepth}">
          </label>
          <label class="field">
            <span>Лимит запросов, ms</span>
            <input name="rateLimitMs" value="${target.limits.rateLimitMs}">
          </label>
          <label class="field">
            <span>Timeout одного запроса, sec</span>
            <input name="requestTimeoutSec" value="${target.limits.requestTimeoutSec || 10}">
          </label>
          <label class="field">
            <span>Общий timeout прогона, sec</span>
            <input name="overallTimeoutSec" value="${target.limits.overallTimeoutSec || 300}">
          </label>
          <label class="field">
            <span>Безопасных действий на page</span>
            <input name="maxActionsPerPage" value="${target.limits.maxActionsPerPage || 0}">
          </label>
          <label class="field">
            <span>Первый прогон сделать baseline</span>
            <select name="approveAsBaseline">
              <option value="false" selected>Нет, сравнить</option>
              <option value="true">Да, утвердить baseline</option>
            </select>
          </label>
          <label class="field full">
            <span>Стартовые URL</span>
            <textarea name="startPaths">${target.startUrls.join("\n")}</textarea>
          </label>
          <label class="field full">
            <span>Стартовые API endpoints</span>
            <textarea name="seedApiPaths">${configuredSeedApiPaths().join("\n")}</textarea>
          </label>
          <label class="field full">
            <span>Ignore JSON keys</span>
            <textarea name="ignoreJsonKeys">${(target.limits.ignoreJsonKeys || []).join("\n")}</textarea>
          </label>
        </form>
        <div class="toolbar">
          <button class="primary" id="run-discovery" type="button">Запустить discovery</button>
          <button class="ghost" id="refresh-state" type="button">Обновить состояние</button>
        </div>
        <div id="run-result" class="notice muted">Готов к запуску. Для внешних сайтов используй только свои стенды или сайты с разрешением.</div>
      </article>
      <article class="card">
        <div class="section-title">
          <div>
            <h2>Ограничения запуска</h2>
            <p>Текущий MVP запускает только безопасный HTTP discovery без браузерного JS.</p>
          </div>
        </div>
        <div class="target-list">
          ${target.guardrails.map((item) => `<div class="target-item"><h3>${item.title}</h3><p class="muted">${item.text}</p></div>`).join("")}
          <div class="target-item">
            <h3>Ignore JSON keys</h3>
            <p class="muted">Эти поля удаляются из API body/schema перед сравнением baseline и current. Подходит для requestId, timestamp, generatedAt и других динамических значений.</p>
          </div>
        </div>
      </article>
    </section>
  `;
  document.getElementById("run-discovery").addEventListener("click", runDiscoveryFromForm);
  document.getElementById("refresh-state").addEventListener("click", loadState);
}

async function runDiscoveryFromForm() {
  const form = document.getElementById("run-form");
  const result = document.getElementById("run-result");
  const formData = new FormData(form);
  const payload = {
    runName: formData.get("runName"),
    baselineName: formData.get("baselineName"),
    baseUrl: formData.get("baseUrl"),
    discoveryMode: formData.get("discoveryMode"),
    maxPages: formData.get("maxPages"),
    maxDepth: formData.get("maxDepth"),
    rateLimitMs: formData.get("rateLimitMs"),
    requestTimeoutSec: formData.get("requestTimeoutSec"),
    overallTimeoutSec: formData.get("overallTimeoutSec"),
    maxActionsPerPage: formData.get("maxActionsPerPage"),
    ignoreJsonKeys: lines(formData.get("ignoreJsonKeys")),
    approveAsBaseline: formData.get("approveAsBaseline") === "true",
    startPaths: lines(formData.get("startPaths")),
    seedApiPaths: lines(formData.get("seedApiPaths"))
  };
  payload.seedApiPaths.forEach((path) => manualSeedApiPaths.add(path));
  saveManualSeedApiPaths();
  result.className = "notice";
  result.textContent = "Discovery выполняется. Это может занять несколько секунд...";
  try {
    const response = await fetch("/api/discovery/run", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Ошибка запуска");
    result.textContent = `Готово: ${body.run}, действие: ${body.action}. Обновляю данные...`;
    selectedId = null;
    await loadState();
    setView("overview");
  } catch (error) {
    result.className = "notice error";
    result.textContent = error.message;
  }
}

function renderRunsView() {
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>История прогонов</h2>
          <p>Список discovery.json из папки runs. Ненужные тестовые прогоны можно удалить из рабочей папки.</p>
        </div>
        <button class="primary" data-view="target" type="button">Новый прогон</button>
      </div>
      <table class="table">
        <thead><tr><th>Run</th><th>Target</th><th>Pages</th><th>Endpoints</th><th>Diff</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${data.runs.map((run) => `
            <tr>
              <td><button data-run-details="${run.id}" type="button">${run.label}</button><br><span class="muted">${formatDate(run.startedAt || run.error?.createdAt)}</span></td>
              <td>${run.environment}</td>
              <td>${run.pages}</td>
              <td>${run.endpoints}</td>
              <td>${run.diffs}</td>
              <td><button class="status-button" data-run-details="${run.id}" type="button"><span class="pill ${run.status}">${statusLabel(run.status)}</span></button></td>
              <td><button class="ghost danger" data-delete-run="${run.id}" type="button">Удалить</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
  bindViewButtons();
  document.querySelectorAll("[data-delete-run]").forEach((button) => {
    button.addEventListener("click", () => deleteRun(button.dataset.deleteRun));
  });
  bindRunButtons();
}

async function deleteRun(runId) {
  const confirmed = confirm(`Удалить результаты прогона "${runId}" из папки runs? Baseline затронут не будет.`);
  if (!confirmed) return;
  const response = await fetch("/api/runs/delete", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({runId})
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    alert(body.error || "Не удалось удалить run");
    return;
  }
  if (selectedId && selectedId.includes(runId)) selectedId = null;
  await loadState();
  setView("runs");
}

function renderReviewView() {
  viewRoot.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Очередь ревью</h2>
          <p>Diff items из сравнения baseline и последнего discovery run.</p>
        </div>
        <div class="toolbar">
          <button class="ghost" id="approve-current" type="button">Принять текущий run как baseline</button>
        </div>
      </div>
      <div class="review-list">${reviewItems().map(reviewItem).join("") || emptyLine("Отличий нет.")}</div>
    </section>
  `;
  bindReviewButtons();
  document.getElementById("approve-current").addEventListener("click", approveCurrentRun);
}

async function approveCurrentRun() {
  if (!data.current.id) return;
  const response = await fetch("/api/baseline/approve", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({runId: data.current.id, baselineName: data.baseline.id || "ui-baseline"})
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    alert(body.error || "Не удалось обновить baseline");
    return;
  }
  selectedId = null;
  await loadState();
}

function renderCatalogView() {
  const catalogNodes = catalogNodesForMode();
  const rows = catalogNodes.filter((node) => endpointFilter === "all" || node.status === endpointFilter);
  const emptyCatalog = catalogNodes.length === 0;
  const endpointCount = data.nodes.filter((node) => node.type === "endpoint").length;
  const pageCount = data.nodes.filter((node) => node.type === "page").length;
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>Каталог discovery</h2>
          <p>API endpoints отделены от page routes, чтобы обычные страницы сайта не выглядели как backend endpoints.</p>
        </div>
        <span class="badge">${endpointCount} API · ${pageCount} pages · ${seedEndpointSpecs().length} seed</span>
      </div>
      <div class="segmented">
        <button class="${catalogMode === "discovered" ? "active" : ""}" data-catalog-mode="discovered" type="button">API endpoints</button>
        <button class="${catalogMode === "pages" ? "active" : ""}" data-catalog-mode="pages" type="button">Page routes</button>
        <button class="${catalogMode === "seed" ? "active" : ""}" data-catalog-mode="seed" type="button">Seed expectations</button>
      </div>
      ${catalogMode === "seed" ? renderSeedEndpointCatalog() : renderDiscoveredEndpointCatalog(rows, emptyCatalog)}
    </section>
  `;
  bindEntityButtons();
  bindViewButtons();
  bindCatalogModeButtons();
  bindSeedEndpointButtons();
  document.querySelectorAll(".filter-control").forEach((button) => {
    button.addEventListener("click", () => {
      endpointFilter = button.dataset.filter;
      renderCatalogView();
      renderDetails();
    });
  });
}

function discoveredCatalogNodes() {
  return data.nodes.filter((node) => node.type === "endpoint");
}

function pageCatalogNodes() {
  return data.nodes.filter((node) => node.type === "page");
}

function catalogNodesForMode() {
  if (catalogMode === "pages") return pageCatalogNodes();
  if (catalogMode === "seed") return [];
  return discoveredCatalogNodes();
}

function renderDiscoveredEndpointCatalog(rows, emptyCatalog) {
  return `
    <div class="section-subbar">
      <div class="toolbar">
        ${["all", "changed", "fail", "removed"].map((value) => `<button class="secondary filter-control ${endpointFilter === value ? "active" : ""}" data-filter="${value}" type="button">${filterLabel(value)}</button>`).join("")}
      </div>
    </div>
    ${emptyCatalog ? endpointEmptyState() : ""}
    <table class="table">
      <thead><tr><th>${catalogMode === "pages" ? "Page route" : "API endpoint"}</th><th>Тип</th><th>Status</th><th>Что сняли</th><th>Diff</th></tr></thead>
      <tbody>
        ${rows.map((node) => `
          <tr>
            <td><button data-entity="${node.id}" type="button">${node.label}</button><br><span class="muted">${node.details.url}</span></td>
            <td>${node.type === "endpoint" ? "API endpoint" : "Page route"}</td>
            <td><span class="pill ${node.status}">${statusLabel(node.status)}</span></td>
            <td>${node.type === "endpoint" ? schemaSummary(node) : "HTML, visible text, links, forms"}</td>
            <td>${node.summary}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderSeedEndpointCatalog() {
  const seeds = seedEndpointSpecs();
  return `
    <div class="seed-panel">
      <div class="section-title compact">
        <div>
          <h2>Seed expectations</h2>
          <p>Здесь тестировщик вручную задаёт endpoint и ожидания. В следующем прогоне seed будет вызван, а результат можно сравнить с текущим API snapshot.</p>
        </div>
      </div>
      <form id="seed-form" class="seed-form">
        <label class="field">
          <span>Path или полный URL</span>
          <input name="seedPath" placeholder="/api/products или https://example.com/api/products">
        </label>
        <label class="field">
          <span>Method</span>
          <select name="method">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>
        <label class="field">
          <span>Expected status</span>
          <input name="expectedStatus" placeholder="200">
        </label>
        <label class="field full">
          <span>Expected request headers</span>
          <textarea name="expectedHeaders" placeholder='{"accept":"application/json"}'></textarea>
        </label>
        <label class="field full">
          <span>Expected request body</span>
          <textarea name="expectedRequest" placeholder='{"userId":"demo"}'></textarea>
        </label>
        <label class="field full">
          <span>Expected response / schema</span>
          <textarea name="expectedResponse" placeholder='{"items":[{"id":"number","name":"string"}]}'></textarea>
        </label>
        <button class="primary" type="submit">Добавить endpoint</button>
      </form>
      <div class="seed-list">
        ${seeds.map((spec) => {
          const state = seedExpectationState(spec);
          return `
          <div class="seed-item ${state.status}">
            <div>
              <div class="seed-title">
                <strong>${spec.method || "GET"} ${spec.path}</strong>
                <span class="pill ${state.status}">${state.label}</span>
              </div>
              <small>${state.text}</small>
              ${seedExpectationSummary(spec)}
            </div>
            <button class="ghost danger" data-remove-seed="${encodeURIComponent(spec.path)}" type="button">Удалить</button>
          </div>
        `;
        }).join("") || emptyLine("Seed expectations пока не заданы. Добавь первый endpoint выше.")}
      </div>
      <div class="empty-actions">
        <button class="secondary" data-view="target" type="button">Открыть форму запуска</button>
      </div>
    </div>
  `;
}

function endpointEmptyState() {
  const isPages = catalogMode === "pages";
  return `
    <div class="empty-state">
      <h3>${isPages ? "Page routes пока не найдены" : "API endpoints пока не найдены"}</h3>
      <p>${isPages ? "Здесь появляются обычные страницы сайта, найденные через стартовые URL и crawl по ссылкам." : "Здесь появляются только backend/API endpoints: seed API, XHR/fetch и JSON/text API responses. Обычные страницы сайта вынесены во вкладку Page routes."}</p>
      <div class="empty-actions">
        <button class="primary" data-catalog-mode="seed" type="button">Добавить seed expectation</button>
        <button class="secondary" data-view="graph" type="button">Смотреть pages graph</button>
      </div>
    </div>
  `;
}

function seedExpectationState(spec) {
  const found = endpointNodes().find((node) => endpointPath(node) === spec.path);
  if (!found) {
    return {
      status: "removed",
      label: "Не найден",
      text: "В текущем прогоне нет API snapshot для этого seed endpoint."
    };
  }

  const mismatches = [];
  const expectedStatus = String(spec.expectedStatus || "").trim();
  if (expectedStatus && String(found.details.currentStatus) !== expectedStatus) {
    mismatches.push(`status ${found.details.currentStatus} вместо ${expectedStatus}`);
  }
  if (spec.expectedResponse && !responseMatchesExpectation(found, spec.expectedResponse)) {
    mismatches.push("response/schema отличается от ожидания");
  }

  if (mismatches.length) {
    return {status: "fail", label: "Не совпало", text: mismatches.join("; ")};
  }
  return {status: "passed", label: "Найден", text: "Endpoint есть в текущем прогоне. Базовые ожидания не нарушены."};
}

function seedExpectationSummary(spec) {
  const chips = [
    spec.expectedStatus ? `status ${spec.expectedStatus}` : "",
    spec.expectedHeaders ? "headers" : "",
    spec.expectedRequest ? "request" : "",
    spec.expectedResponse ? "response/schema" : ""
  ].filter(Boolean);
  if (!chips.length) return `<div class="seed-meta">Ожидания пока не заданы: проверяем факт наличия endpoint.</div>`;
  return `<div class="seed-meta">${chips.map((item) => `<span>${item}</span>`).join("")}</div>`;
}

function endpointPath(node) {
  if (node.title) return node.title;
  try {
    return new URL(node.details.url).pathname;
  } catch {
    return node.details.url || node.label;
  }
}

function responseMatchesExpectation(node, expectation) {
  const expected = String(expectation || "").trim();
  if (!expected) return true;
  const response = stringify(node.details.response?.current);
  const schema = stringify(node.details.schema?.current || node.details.schema);
  return response.includes(expected) || schema.includes(expected);
}

function renderActionsView() {
  const actions = data.actions || [];
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>Actions</h2>
          <p>Цепочки, которые browser-runner собрал после безопасных кликов: page -> action -> network endpoints.</p>
        </div>
        <span class="badge">${actions.length} actions</span>
      </div>
      ${actions.length ? renderActionsTable(actions) : actionsEmptyState()}
    </section>
  `;
  bindActionButtons();
  bindEntityButtons();
  bindViewButtons();
}

function renderActionsTable(actions) {
  return `
    <table class="table actions-table">
      <thead><tr><th>Action</th><th>Page</th><th>Network</th><th>Endpoints</th><th>Status</th></tr></thead>
      <tbody>
        ${actions.map((action) => `
          <tr class="${selectedActionId === action.id ? "selected-row" : ""}">
            <td>
              <button data-action="${encodeURIComponent(action.id)}" type="button">${escapeHtml(action.label)}</button>
              <br><span class="muted">${escapeHtml(action.tag || "element")} · ${escapeHtml(action.id)}</span>
            </td>
            <td>${escapeHtml(action.page || "-")}<br><span class="muted">${escapeHtml(action.afterPath || action.afterUrl || "-")}</span></td>
            <td>${action.networkBefore} -> ${action.networkAfter}</td>
            <td>
              <div class="endpoint-chips">
                ${(action.newEndpoints || []).map((path, index) => `
                  <button class="endpoint-chip" data-entity="${action.endpointNodeIds[index] || ""}" type="button">${escapeHtml(path)}</button>
                `).join("") || `<span class="muted">Новых endpoint не найдено</span>`}
              </div>
            </td>
            <td><span class="pill ${action.status}">${statusLabel(action.status)}</span><br><span class="muted">${escapeHtml(action.actionStatus || "-")}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function actionsEmptyState() {
  return `
    <div class="empty-state">
      <h3>Actions пока не записаны</h3>
      <p>Открой цель сканирования, выбери Browser + Network и поставь “Безопасных действий на page” больше 0. После прогона здесь появятся клики и endpoints, которые они вызвали.</p>
      <div class="empty-actions">
        <button class="primary" data-view="target" type="button">Настроить action crawling</button>
      </div>
    </div>
  `;
}

function renderGraphView() {
  viewRoot.innerHTML = `
    <section class="graph-card">
      <div class="section-title">
        <div>
          <h2>Graph UI/API поведения</h2>
          <p>Связи page -> endpoint из discovery graph.</p>
        </div>
        <span class="badge">Pages + endpoints</span>
      </div>
      <div class="graph" id="full-graph"></div>
    </section>
  `;
  renderGraphInto(document.getElementById("full-graph"), data.nodes, data.edges);
}

function runCard(run) {
  return `
    <div class="run-item">
      <h3><button data-run-details="${run.id}" type="button">${run.label}</button></h3>
      <p class="muted">${run.environment} · ${formatDate(run.startedAt || run.error?.createdAt)}</p>
      <div class="toolbar">
        <button class="status-button" data-run-details="${run.id}" type="button"><span class="pill ${run.status}">${statusLabel(run.status)}</span></button>
        <span class="badge">${run.diffs} diff</span>
        <span class="badge">${run.endpoints} endpoints</span>
      </div>
    </div>
  `;
}

function reviewItems() {
  const nodeItems = data.nodes
    .flatMap((node) => (node.details.diffs || []).map((diff) => ({node, diff, key: issueKey(node, diff)})))
    .filter((item) => !ignoredIssues.has(item.key));
  const actionItems = (data.actions || [])
    .flatMap((action) => (action.diffs || []).map((diff) => ({action, diff, key: actionIssueKey(action, diff)})))
    .filter((item) => !ignoredIssues.has(item.key));
  return [...nodeItems, ...actionItems];
}

function reviewItem({node, action, diff, key}) {
  if (!node) return reviewActionItem({action, diff, key});
  const encodedKey = encodeURIComponent(key);
  return `
    <div class="review-item ${selectedIssueKey === key ? "selected-issue" : ""}">
      <div>
        <span class="pill ${diff.severity}">${severityLabel(diff.severity)}</span>
        <h3>${diff.title}</h3>
        <p>${diff.text}</p>
        <p class="muted">${node.label}</p>
      </div>
      <div class="inline-actions">
        <button class="secondary" data-open-issue="${encodedKey}" data-entity="${node.id}" type="button">Открыть</button>
        <button class="ghost" data-ignore-issue="${encodedKey}" type="button">Игнорировать</button>
      </div>
    </div>
  `;
}

function reviewActionItem({action, diff, key}) {
  const encodedKey = encodeURIComponent(key);
  return `
    <div class="review-item ${selectedIssueKey === key ? "selected-issue" : ""}">
      <div>
        <span class="pill ${diff.severity}">${severityLabel(diff.severity)}</span>
        <h3>${diff.title}</h3>
        <p>${diff.text}</p>
        <p class="muted">${action.label}</p>
      </div>
      <div class="inline-actions">
        <button class="secondary" data-open-issue="${encodedKey}" data-action="${encodeURIComponent(action.id)}" type="button">Открыть</button>
        <button class="ghost" data-ignore-issue="${encodedKey}" type="button">Игнорировать</button>
      </div>
    </div>
  `;
}

function issueKey(node, diff) {
  return [node.id, diff.severity, diff.title, diff.text, stringify(diff.old), stringify(diff.new)].join("|");
}

function actionIssueKey(action, diff) {
  return [action.id, diff.severity, diff.title, diff.text, stringify(diff.old), stringify(diff.new)].join("|");
}

function renderGraphInto(container, nodes, edges) {
  const layout = layoutGraph(nodes);
  const width = layout.width;
  const height = layout.height;
  const edgeRows = graphEdgesToRender(edges, layout.nodes);
  const lines = edgeRows.map(([from, to, faded]) => {
    const a = layout.byId.get(from);
    const b = layout.byId.get(to);
    const color = b.status === "fail" || b.status === "removed" ? "#ef4444" : "#94a3b8";
    return `<line class="${faded ? "faded" : ""}" x1="${a.x + 190}" y1="${a.y + 42}" x2="${b.x}" y2="${b.y + 42}" stroke="${color}" stroke-width="2" stroke-dasharray="${b.status === "removed" ? "5 5" : "0"}" />`;
  }).join("");

  container.innerHTML = `
    <div class="graph-toolbar">
      <button class="secondary graph-zoom" data-zoom="in" type="button">+</button>
      <button class="secondary graph-zoom" data-zoom="out" type="button">-</button>
      <button class="secondary graph-reset" type="button">Reset</button>
      <button class="secondary graph-edge-mode ${graphState.showAllEdges ? "active" : ""}" type="button">${graphState.showAllEdges ? "Все связи" : "Фокус"}</button>
      <span class="muted">${nodes.length} nodes · ${edges.length} edges</span>
    </div>
    <div class="graph-viewport">
      <div class="graph-world" style="width:${width}px; height:${height}px;">
        <svg class="edge-layer" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${lines}</svg>
        ${layout.nodes.map((node) => `
          <button class="node ${node.type} ${node.status} ${node.id === selectedId ? "selected" : ""}" style="left:${node.x}px; top:${node.y}px" data-entity="${node.id}" type="button">
            <small>${node.type === "endpoint" ? "endpoint" : "page"} · ${statusLabel(node.status)}</small>
            <strong>${node.label}</strong>
            <small>${node.summary}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  applyGraphTransform(container);
  bindGraphControls(container);
  bindEntityButtons(container);
}

function layoutGraph(nodes) {
  const pages = nodes.filter((node) => node.type === "page");
  const endpoints = nodes.filter((node) => node.type === "endpoint");
  const rowGap = 126;
  const colGap = 330;
  const pageCols = 2;
  const endpointCols = 3;
  const layoutNodes = [];

  pages.forEach((node, index) => {
    const col = index % pageCols;
    const row = Math.floor(index / pageCols);
    layoutNodes.push({...node, x: 40 + col * colGap, y: 54 + row * rowGap});
  });

  endpoints.forEach((node, index) => {
    const col = index % endpointCols;
    const row = Math.floor(index / endpointCols);
    layoutNodes.push({...node, x: 760 + col * colGap, y: 54 + row * rowGap});
  });

  const maxX = Math.max(1100, ...layoutNodes.map((node) => node.x + 240));
  const maxY = Math.max(620, ...layoutNodes.map((node) => node.y + 140));
  return {
    nodes: layoutNodes,
    byId: new Map(layoutNodes.map((node) => [node.id, node])),
    width: maxX + 80,
    height: maxY + 80
  };
}

function graphEdgesToRender(edges, nodes) {
  const ids = new Set(nodes.map((node) => node.id));
  const valid = edges.filter(([from, to]) => ids.has(from) && ids.has(to));
  if (graphState.showAllEdges) return valid.map(([from, to]) => [from, to, valid.length > 120]);
  if (selectedId) {
    const focused = valid.filter(([from, to]) => from === selectedId || to === selectedId);
    return focused.map(([from, to]) => [from, to, false]);
  }
  return valid.slice(0, 60).map(([from, to]) => [from, to, true]);
}

function applyGraphTransform(container) {
  const world = container.querySelector(".graph-world");
  if (!world) return;
  world.style.transform = `translate(${graphState.x}px, ${graphState.y}px) scale(${graphState.scale})`;
}

function bindGraphControls(container) {
  const viewport = container.querySelector(".graph-viewport");
  container.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const delta = button.dataset.zoom === "in" ? 0.15 : -0.15;
      graphState.scale = clamp(graphState.scale + delta, 0.35, 2.2);
      applyGraphTransform(container);
    });
  });
  container.querySelector(".graph-reset").addEventListener("click", () => {
    graphState.scale = 1;
    graphState.x = 0;
    graphState.y = 0;
    applyGraphTransform(container);
  });
  container.querySelector(".graph-edge-mode").addEventListener("click", () => {
    graphState.showAllEdges = !graphState.showAllEdges;
    renderView();
  });

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    graphState.scale = clamp(graphState.scale + delta, 0.35, 2.2);
    applyGraphTransform(container);
  }, {passive: false});

  let dragging = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node")) return;
    dragging = {x: event.clientX, y: event.clientY, tx: graphState.x, ty: graphState.y};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    graphState.x = dragging.tx + event.clientX - dragging.x;
    graphState.y = dragging.ty + event.clientY - dragging.y;
    applyGraphTransform(container);
  });
  viewport.addEventListener("pointerup", () => {
    dragging = null;
  });
  viewport.addEventListener("pointercancel", () => {
    dragging = null;
  });
}

function renderRunDetails(run) {
  const error = run.error;
  detailsEl.innerHTML = `
    <div class="details-header">
      <div>
        <h2>${run.label}</h2>
        <p>${run.environment || "Target не указан"}</p>
      </div>
      <span class="pill ${run.status}">${statusLabel(run.status)}</span>
    </div>
    <div class="info-grid">
      <div class="info"><span>Pages</span><strong>${run.pages}</strong></div>
      <div class="info"><span>Endpoints</span><strong>${run.endpoints}</strong></div>
      <div class="info"><span>Diff</span><strong>${run.diffs}</strong></div>
      <div class="info"><span>Запуск</span><strong>${formatDate(run.startedAt || error?.createdAt)}</strong></div>
    </div>
    ${error ? `
      <div class="diff-list">
        <div class="diff-item">
          <span class="pill fail">${error.kind || "Ошибка"}</span>
          <strong>Почему прогон завершился ошибкой</strong>
          <p>${escapeHtml(error.message || "Причина не сохранена.")}</p>
        </div>
      </div>
      <div class="tabs">
        <button class="tab active" type="button">Ошибка</button>
      </div>
      <pre>${escapeHtml(stringify(error))}</pre>
    ` : `
      <div class="diff-list">
        <div class="diff-item">
          <span class="pill ${run.status}">${statusLabel(run.status)}</span>
          <strong>Прогон завершён</strong>
          <p>Для подробностей выбери endpoint/page в graph или каталоге.</p>
        </div>
      </div>
    `}
  `;
}

function renderActionDetails(action) {
  detailsEl.innerHTML = `
    <div class="details-header">
      <div><h2>${escapeHtml(action.label)}</h2><p>${escapeHtml(action.id)}</p></div>
      <span class="pill ${action.status}">${statusLabel(action.status)}</span>
    </div>
    <div class="info-grid">
      <div class="info"><span>Page</span><strong>${escapeHtml(action.page || "-")}</strong></div>
      <div class="info"><span>Action status</span><strong>${escapeHtml(action.actionStatus || "-")}</strong></div>
      <div class="info"><span>Before URL</span><strong>${escapeHtml(action.beforeUrl || "-")}</strong></div>
      <div class="info"><span>After URL</span><strong>${escapeHtml(action.afterUrl || "-")}</strong></div>
      <div class="info"><span>Network</span><strong>${action.networkBefore} -> ${action.networkAfter}</strong></div>
      <div class="info"><span>Element</span><strong>${escapeHtml(action.tag || "-")}</strong></div>
    </div>
    <div class="diff-list">
      ${(action.diffs || []).map((item) => `<div class="diff-item"><span class="pill ${item.severity}">${severityLabel(item.severity)}</span><strong>${item.title}</strong><p>${item.text}</p></div>`).join("") || emptyLine("Отличий по этому action нет.")}
    </div>
    <h3>Endpoints after action</h3>
    <div class="endpoint-chips details-chips">
      ${(action.newEndpoints || []).map((path, index) => `<button class="endpoint-chip" data-entity="${action.endpointNodeIds[index] || ""}" type="button">${escapeHtml(path)}</button>`).join("") || emptyLine("Action не вызвал новых endpoint.")}
    </div>
    <h3>Artifacts</h3>
    ${renderArtifacts(action.artifacts || {})}
    <h3>Raw action</h3>
    <pre>${escapeHtml(stringify(action))}</pre>
  `;
  bindEntityButtons(detailsEl);
}

function renderDetails() {
  const run = selectedRun();
  if (run) {
    renderRunDetails(run);
    return;
  }
  const action = selectedAction();
  if (action) {
    renderActionDetails(action);
    return;
  }
  const node = selectedNode();
  if (!node) {
    detailsEl.innerHTML = `<div class="details-header"><h2>Нет данных</h2></div>`;
    return;
  }
  const details = node.details;
  detailsEl.innerHTML = `
    <div class="details-header">
      <div><h2>${node.label}</h2><p>${node.summary}</p></div>
      <span class="pill ${node.status}">${statusLabel(node.status)}</span>
    </div>
    <div class="info-grid">
      <div class="info"><span>Метод</span><strong>${details.method}</strong></div>
      <div class="info"><span>Статус</span><strong>${details.baselineStatus} -> ${details.currentStatus}</strong></div>
      <div class="info"><span>URL</span><strong>${details.url}</strong></div>
      <div class="info"><span>Тип</span><strong>${node.type}</strong></div>
    </div>
    ${renderDiscoveryContext(details)}
    <div class="diff-list">
      ${(details.diffs || []).map((item) => {
        const key = issueKey(node, item);
        return `<div class="diff-item ${selectedIssueKey === key ? "selected-issue" : ""}"><span class="pill ${item.severity}">${severityLabel(item.severity)}</span><strong>${item.title}</strong><p>${item.text}</p></div>`;
      }).join("") || emptyLine("Отличий по выбранному элементу нет.")}
    </div>
    ${renderTabs(node)}
  `;
  bindTabs();
}

function renderDiscoveryContext(details) {
  const sources = details.sources || [];
  if (!details.resourceType && !sources.length) return "";
  return `
    <div class="discovery-context">
      ${details.resourceType ? `<span>resource: <strong>${escapeHtml(details.resourceType)}</strong></span>` : ""}
      ${sources.length ? `<span>found from: <strong>${escapeHtml(sources.join(", "))}</strong></span>` : ""}
    </div>
  `;
}

function renderTabs(node) {
  const tabs = node.type === "endpoint" ? ["Изменения", "Response", "Schema", "Headers", "Payload", "Artifacts"] : ["Изменения", "Видимый diff", "Response", "Schema", "Artifacts"];
  return `<div class="tabs">${tabs.map((tab, index) => `<button class="tab ${index === 0 ? "active" : ""}" data-tab="${tab}" type="button">${tab}</button>`).join("")}</div><div id="tab-body">${tabContent(node, tabs[0])}</div>`;
}

function tabContent(node, tab) {
  const d = node.details;
  if (tab === "Изменения") return renderChangeFocus(node);
  if (tab === "Response") return `<h3>Baseline</h3><pre>${escapeHtml(stringify(d.response?.baseline))}</pre><h3>Current</h3><pre>${escapeHtml(stringify(d.response?.current))}</pre>`;
  if (tab === "Schema") return `<pre>${escapeHtml(stringify(d.schema))}</pre>`;
  if (tab === "Headers") return `<h3>Request headers</h3><pre>${escapeHtml(stringify(d.requestHeaders || {}))}</pre><h3>Response headers</h3><pre>${escapeHtml(stringify(d.responseHeaders || d.headers || {}))}</pre>`;
  if (tab === "Payload") return `<pre>${escapeHtml(stringify(d.payload))}</pre>`;
  if (tab === "Artifacts") return renderArtifacts(d.artifacts || {});
  if (tab === "Видимый diff") return highlightedDiff(d.visibleTextDiff || []);
  return `<pre>${escapeHtml(stringify(d))}</pre>`;
}

function renderArtifacts(artifacts) {
  const links = Object.entries(artifacts || {}).filter(([, url]) => Boolean(url));
  if (!links.length) return emptyLine("Для этого элемента artifacts пока не сохранены.");
  return `
    <div class="artifact-panel">
      ${artifacts.currentScreenshot ? `<a href="${artifacts.currentScreenshot}" target="_blank"><img class="artifact-shot" src="${artifacts.currentScreenshot}" alt="Current screenshot"></a>` : ""}
      ${artifacts.baselineScreenshot ? `<a href="${artifacts.baselineScreenshot}" target="_blank"><img class="artifact-shot" src="${artifacts.baselineScreenshot}" alt="Baseline screenshot"></a>` : ""}
      <div class="artifact-links">
        ${links.map(([name, url]) => `<a class="button-link" href="${url}" target="_blank">${escapeHtml(name)}</a>`).join("")}
      </div>
    </div>
  `;
}

function renderChangeFocus(node) {
  const diffs = node.details.diffs || [];
  const selected = diffs.find((diff) => issueKey(node, diff) === selectedIssueKey);
  const visibleLines = node.details.visibleTextDiff || [];
  const patchLines = diffs.flatMap((diff) => normalizePatchLines(diff.patch));
  const lines = selected ? normalizePatchLines(selected.patch) : visibleLines.length ? visibleLines : patchLines;
  const items = selected ? [selected] : diffs;

  if (lines.length) {
    return `
      <div class="change-focus">
        <p class="muted">Красные строки были в baseline, зелёные строки появились в current.</p>
        ${highlightedDiff(lines)}
      </div>
    `;
  }

  if (!items.length) {
    return emptyLine("Для выбранного элемента отличий нет.");
  }

  return `
    <div class="change-focus">
      ${items.map((item) => `
        <div class="change-pair">
          <span class="pill ${item.severity}">${severityLabel(item.severity)}</span>
          <strong>${item.title}</strong>
          <div class="compare-grid">
            <div><h3>Baseline</h3><pre>${escapeHtml(stringify(item.old))}</pre></div>
            <div><h3>Current</h3><pre>${escapeHtml(stringify(item.new))}</pre></div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function normalizePatchLines(patch) {
  if (!patch) return [];
  if (Array.isArray(patch)) {
    return patch.flatMap((item) => typeof item === "string" ? [item] : stringify(item).split("\n"));
  }
  return stringify(patch).split("\n");
}

function highlightedDiff(lines) {
  if (!lines.length) return emptyLine("Diff-представление для этого изменения не сохранено.");
  return `
    <div class="diff-view">
      ${lines.map((line) => `<div class="${diffLineClass(line)}">${escapeHtml(line || " ")}</div>`).join("")}
    </div>
  `;
}

function diffLineClass(line) {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-line meta";
  if (line.startsWith("@@")) return "diff-line hunk";
  if (line.startsWith("+")) return "diff-line added";
  if (line.startsWith("-")) return "diff-line removed";
  return "diff-line context";
}

function bindTabs() {
  detailsEl.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      detailsEl.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-body").innerHTML = tabContent(selectedNode(), tab.dataset.tab);
    });
  });
}

function bindEntityButtons(root = document) {
  root.querySelectorAll("[data-entity]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.dataset.entity) return;
      selectedRunId = null;
      selectedActionId = null;
      selectedId = button.dataset.entity;
      selectedIssueKey = null;
      syncUrl();
      renderDetails();
      if (activeView === "graph") renderGraphView();
      if (activeView === "overview") renderOverviewView();
      if (activeView === "actions") renderActionsView();
    });
  });
}

function bindActionButtons(root = document) {
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = null;
      selectedId = null;
      selectedActionId = decodeURIComponent(button.dataset.action);
      selectedIssueKey = button.dataset.openIssue ? decodeURIComponent(button.dataset.openIssue) : null;
      syncUrl();
      renderDetails();
      if (activeView === "actions") renderActionsView();
    });
  });
}

function bindReviewButtons(root = document) {
  root.querySelectorAll("[data-open-issue]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = null;
      selectedId = button.dataset.entity || null;
      selectedActionId = button.dataset.action ? decodeURIComponent(button.dataset.action) : null;
      selectedIssueKey = decodeURIComponent(button.dataset.openIssue);
      graphState.showAllEdges = false;
      setView(selectedActionId ? "actions" : "graph", {preserveSelection: true});
    });
  });
  root.querySelectorAll("[data-ignore-issue]").forEach((button) => {
    button.addEventListener("click", () => {
      ignoredIssues.add(decodeURIComponent(button.dataset.ignoreIssue));
      saveIgnoredIssues();
      if (selectedIssueKey === decodeURIComponent(button.dataset.ignoreIssue)) {
        selectedIssueKey = null;
      }
      renderView();
    });
  });
}

function bindRunButtons(root = document) {
  root.querySelectorAll("[data-run-details]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runDetails;
      selectedActionId = null;
      selectedId = null;
      selectedIssueKey = null;
      syncUrl();
      renderDetails();
    });
  });
}

function bindViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

function bindCatalogModeButtons() {
  document.querySelectorAll("[data-catalog-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      catalogMode = button.dataset.catalogMode;
      syncUrl();
      renderCatalogView();
      renderDetails();
    });
  });
}

function bindSeedEndpointButtons() {
  const form = document.getElementById("seed-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const raw = String(formData.get("seedPath") || "").trim();
      const path = normalizeSeedPath(raw);
      if (!path) return;
      const spec = {
        path,
        method: String(formData.get("method") || "GET"),
        expectedStatus: String(formData.get("expectedStatus") || "").trim(),
        expectedHeaders: String(formData.get("expectedHeaders") || "").trim(),
        expectedRequest: String(formData.get("expectedRequest") || "").trim(),
        expectedResponse: String(formData.get("expectedResponse") || "").trim()
      };
      manualSeedEndpointSpecs = manualSeedEndpointSpecs.filter((item) => item.path !== path);
      manualSeedEndpointSpecs.push(spec);
      manualSeedApiPaths.add(path);
      saveManualSeedApiPaths();
      saveManualSeedEndpointSpecs();
      renderCatalogView();
      renderDetails();
    });
  }
  document.querySelectorAll("[data-remove-seed]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = decodeURIComponent(button.dataset.removeSeed);
      manualSeedApiPaths.delete(path);
      manualSeedEndpointSpecs = manualSeedEndpointSpecs.filter((item) => item.path !== path);
      saveManualSeedApiPaths();
      saveManualSeedEndpointSpecs();
      renderCatalogView();
      renderDetails();
    });
  });
}

function normalizeSeedPath(value) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return `${url.pathname || "/"}${url.search || ""}`;
    } catch {
      return "";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function filterLabel(value) {
  return {all: "Все", changed: "Изменено", fail: "Ошибка", removed: "Удалено"}[value] || value;
}

function schemaSummary(node) {
  const schema = node.details.schema;
  if (!schema) return "-";
  if (node.status === "removed") return "нет в новом graph";
  if (node.status === "fail") return "есть критичные изменения";
  return "без критичных изменений";
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value) {
  if (!value) return "-";
  return value.replace("T", " ").replace("Z", "");
}

function dateStamp() {
  const now = new Date();
  return now.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "-");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyDrawerWidth(width) {
  const max = Math.floor(window.innerWidth * drawerResize.maxViewportRatio);
  const next = clamp(width, drawerResize.min, Math.max(drawerResize.min, max));
  document.documentElement.style.setProperty("--drawer-width", `${next}px`);
  localStorage.setItem("detailsDrawerWidth", String(next));
}

function initDrawerResize() {
  const saved = Number(localStorage.getItem("detailsDrawerWidth") || 400);
  applyDrawerWidth(saved);

  detailsEl.addEventListener("pointerdown", (event) => {
    const rect = detailsEl.getBoundingClientRect();
    if (event.clientX - rect.left > 12 || window.innerWidth <= 1360) return;
    drawerResize.active = true;
    document.body.classList.add("drawer-resizing");
    detailsEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  detailsEl.addEventListener("pointermove", (event) => {
    if (!drawerResize.active) return;
    applyDrawerWidth(window.innerWidth - event.clientX);
  });

  const stopResize = (event) => {
    if (!drawerResize.active) return;
    drawerResize.active = false;
    document.body.classList.remove("drawer-resizing");
    if (event?.pointerId !== undefined) {
      try {
        detailsEl.releasePointerCapture(event.pointerId);
      } catch {}
    }
  };

  detailsEl.addEventListener("pointerup", stopResize);
  detailsEl.addEventListener("pointercancel", stopResize);
  window.addEventListener("resize", () => {
    const current = Number(localStorage.getItem("detailsDrawerWidth") || 400);
    applyDrawerWidth(current);
  });
}

function emptyLine(text) {
  return `<p class="muted">${text}</p>`;
}

function stringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelectorAll(".topbar-actions [data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.getElementById("topbar-run").addEventListener("click", () => setView("target"));

window.addEventListener("popstate", () => {
  applyRouteFromLocation();
  if (!data) return;
  renderShell();
  updateActiveRouteUi();
  renderView();
});

applyRouteFromLocation();
initDrawerResize();
loadState();
