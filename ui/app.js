let data = null;
let activeView = "overview";
let selectedId = null;
let selectedRunId = null;
let endpointFilter = "all";
const graphState = {
  scale: 1,
  x: 0,
  y: 0,
  showAllEdges: false
};

const viewRoot = document.getElementById("view-root");
const detailsEl = document.getElementById("details-drawer");
const viewTitleEl = document.getElementById("view-title");
const topbarProjectEl = document.getElementById("topbar-project");
const statusStripEl = document.getElementById("status-strip");

const viewTitles = {
  overview: "Обзор regression discovery",
  target: "Цель сканирования",
  runs: "История прогонов",
  review: "Очередь ревью",
  catalog: "Каталог endpoint",
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
  `;
}

function selectedNode() {
  if (selectedRunId) return null;
  return data.nodes.find((node) => node.id === selectedId) || data.nodes[0] || null;
}

function selectedRun() {
  return data.runs.find((run) => run.id === selectedRunId) || null;
}

function endpointNodes() {
  return data.nodes.filter((node) => node.type === "endpoint");
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  viewTitleEl.textContent = viewTitles[view];
  renderView();
}

function renderView() {
  if (!data) return;
  if (activeView === "target") renderTargetView();
  if (activeView === "runs") renderRunsView();
  if (activeView === "review") renderReviewView();
  if (activeView === "catalog") renderCatalogView();
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
  renderGraphInto(document.getElementById("overview-graph"), data.nodes, data.edges);
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
            <textarea name="seedApiPaths">${target.seedApiPaths.join("\n")}</textarea>
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
    maxPages: formData.get("maxPages"),
    maxDepth: formData.get("maxDepth"),
    rateLimitMs: formData.get("rateLimitMs"),
    requestTimeoutSec: formData.get("requestTimeoutSec"),
    overallTimeoutSec: formData.get("overallTimeoutSec"),
    approveAsBaseline: formData.get("approveAsBaseline") === "true",
    startPaths: lines(formData.get("startPaths")),
    seedApiPaths: lines(formData.get("seedApiPaths"))
  };
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
  bindEntityButtons();
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
  const rows = endpointNodes().filter((node) => endpointFilter === "all" || node.status === endpointFilter);
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>Каталог endpoint</h2>
          <p>Реальные endpoint из baseline/current discovery graph. Клик открывает response, schema и diff.</p>
        </div>
        <div class="toolbar">
          ${["all", "changed", "fail", "removed"].map((value) => `<button class="secondary filter-control ${endpointFilter === value ? "active" : ""}" data-filter="${value}" type="button">${filterLabel(value)}</button>`).join("")}
        </div>
      </div>
      <table class="table">
        <thead><tr><th>Endpoint</th><th>Status</th><th>Schema</th><th>Diff</th></tr></thead>
        <tbody>
          ${rows.map((node) => `
            <tr>
              <td><button data-entity="${node.id}" type="button">${node.label}</button><br><span class="muted">${node.details.url}</span></td>
              <td><span class="pill ${node.status}">${statusLabel(node.status)}</span></td>
              <td>${schemaSummary(node)}</td>
              <td>${node.summary}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
  bindEntityButtons();
  document.querySelectorAll(".filter-control").forEach((button) => {
    button.addEventListener("click", () => {
      endpointFilter = button.dataset.filter;
      renderCatalogView();
      renderDetails();
    });
  });
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
  return data.nodes.flatMap((node) => (node.details.diffs || []).map((diff) => ({node, diff})));
}

function reviewItem({node, diff}) {
  return `
    <div class="review-item">
      <div>
        <span class="pill ${diff.severity}">${severityLabel(diff.severity)}</span>
        <h3>${diff.title}</h3>
        <p>${diff.text}</p>
        <p class="muted">${node.label}</p>
      </div>
      <div class="inline-actions">
        <button class="secondary" data-entity="${node.id}" type="button">Открыть</button>
        <button class="ghost" type="button">Ignore</button>
      </div>
    </div>
  `;
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

function renderDetails() {
  const run = selectedRun();
  if (run) {
    renderRunDetails(run);
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
    <div class="diff-list">
      ${(details.diffs || []).map((item) => `<div class="diff-item"><span class="pill ${item.severity}">${severityLabel(item.severity)}</span><strong>${item.title}</strong><p>${item.text}</p></div>`).join("") || emptyLine("Отличий по выбранному элементу нет.")}
    </div>
    ${renderTabs(node)}
  `;
  bindTabs();
}

function renderTabs(node) {
  const tabs = node.type === "endpoint" ? ["Response", "Schema", "Headers", "Payload"] : ["Видимый diff", "Response", "Schema"];
  return `<div class="tabs">${tabs.map((tab, index) => `<button class="tab ${index === 0 ? "active" : ""}" data-tab="${tab}" type="button">${tab}</button>`).join("")}</div><div id="tab-body">${tabContent(node, tabs[0])}</div>`;
}

function tabContent(node, tab) {
  const d = node.details;
  if (tab === "Response") return `<h3>Baseline</h3><pre>${escapeHtml(stringify(d.response?.baseline))}</pre><h3>Current</h3><pre>${escapeHtml(stringify(d.response?.current))}</pre>`;
  if (tab === "Schema") return `<pre>${escapeHtml(stringify(d.schema))}</pre>`;
  if (tab === "Headers") return `<h3>Request headers</h3><pre>${escapeHtml(stringify(d.requestHeaders || {}))}</pre><h3>Response headers</h3><pre>${escapeHtml(stringify(d.responseHeaders || d.headers || {}))}</pre>`;
  if (tab === "Payload") return `<pre>${escapeHtml(stringify(d.payload))}</pre>`;
  if (tab === "Видимый diff") return `<pre>${escapeHtml((d.visibleTextDiff || []).join("\n"))}</pre>`;
  return `<pre>${escapeHtml(stringify(d))}</pre>`;
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
      selectedRunId = null;
      selectedId = button.dataset.entity;
      renderDetails();
      if (activeView === "graph") renderGraphView();
      if (activeView === "overview") renderOverviewView();
    });
  });
}

function bindRunButtons(root = document) {
  root.querySelectorAll("[data-run-details]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runDetails;
      renderDetails();
    });
  });
}

function bindViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
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

loadState();
