const data = window.SCAN_DATA;

let activeView = "overview";
let selectedId = "api-products";
let endpointFilter = "all";

const viewRoot = document.getElementById("view-root");
const detailsEl = document.getElementById("details-drawer");
const viewTitleEl = document.getElementById("view-title");

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

function selectedNode() {
  return data.nodes.find((node) => node.id === selectedId) || data.nodes[0];
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
              <p>Сравнение последнего discovery run с утвержденным baseline.</p>
            </div>
            <span class="badge">v2 vs baseline</span>
          </div>
          <div class="run-list">
            ${data.runs.map((run) => runCard(run)).join("")}
          </div>
        </article>

        <article class="card">
          <div class="section-title">
            <div>
              <h2>Что требует внимания</h2>
              <p>Сгруппированные изменения, которые QA или разработчик должен принять или отклонить.</p>
            </div>
          </div>
          <div class="review-list">
            ${reviewItems().slice(0, 4).map(reviewItem).join("")}
          </div>
        </article>
      </section>

      <section class="graph-card">
        <div class="section-title">
          <div>
            <h2>Быстрая схема UI/API</h2>
            <p>Нажми на endpoint или page, чтобы открыть детали справа.</p>
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
            <p>Здесь выбирается сервис, который discovery-runner будет исследовать.</p>
          </div>
          <span class="badge">Staging</span>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Название проекта</span>
            <input value="${target.project}">
          </label>
          <label class="field">
            <span>Окружение</span>
            <select>
              <option selected>Staging</option>
              <option>QA sandbox</option>
              <option>Preprod</option>
            </select>
          </label>
          <label class="field full">
            <span>Base URL</span>
            <input value="${target.baseUrl}">
          </label>
          <label class="field">
            <span>Профиль авторизации</span>
            <select>
              <option selected>${target.authProfile}</option>
              <option>Bearer token</option>
              <option>No auth</option>
            </select>
          </label>
          <label class="field">
            <span>Политика действий</span>
            <select>
              <option selected>${target.policy}</option>
              <option>GET only</option>
              <option>Allow POST</option>
              <option>Allow all methods</option>
            </select>
          </label>
          <label class="field">
            <span>Максимум pages</span>
            <input value="${target.limits.maxPages}">
          </label>
          <label class="field">
            <span>Лимит запросов</span>
            <input value="${target.limits.rateLimitMs} ms">
          </label>
          <label class="field full">
            <span>Стартовые URL</span>
            <textarea>${target.startUrls.join("\n")}</textarea>
          </label>
          <label class="field full">
            <span>Стартовые API endpoints</span>
            <textarea>${target.seedApiPaths.join("\n")}</textarea>
          </label>
        </div>

        <div class="toolbar">
          <button class="primary" type="button">Запустить discovery</button>
          <button class="ghost" type="button">Проверить доступ</button>
          <button class="ghost" type="button">Сохранить настройки</button>
        </div>
      </article>

      <article class="card">
        <div class="section-title">
          <div>
            <h2>Ограничения запуска</h2>
            <p>То, что снижает шум, нагрузку и риск опасных действий.</p>
          </div>
        </div>
        <div class="target-list">
          ${target.guardrails.map((item) => `
            <div class="target-item">
              <h3>${item.title}</h3>
              <p class="muted">${item.text}</p>
            </div>
          `).join("")}
        </div>
      </article>
    </section>
  `;
}

function renderRunsView() {
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>История прогонов</h2>
          <p>Каждый прогон можно назначить baseline или сравнить с последним утвержденным снимком.</p>
        </div>
        <button class="primary" type="button">Новый прогон</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Окружение</th>
            <th>Pages</th>
            <th>Endpoints</th>
            <th>Diff</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          ${data.runs.map((run) => `
            <tr>
              <td><button type="button">${run.label}</button><br><span class="muted">${run.startedAt}</span></td>
              <td>${run.environment}</td>
              <td>${run.pages}</td>
              <td>${run.endpoints}</td>
              <td>${run.diffs}</td>
              <td><span class="pill ${run.status}">${statusLabel(run.status)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderReviewView() {
  viewRoot.innerHTML = `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Очередь ревью</h2>
          <p>Изменения, которые нужно принять как новую норму или отправить в bug/issue.</p>
        </div>
        <div class="toolbar">
          <button class="ghost" type="button">Принять выбранное</button>
          <button class="primary" type="button">Создать issue</button>
        </div>
      </div>
      <div class="review-list">
        ${reviewItems().map(reviewItem).join("")}
      </div>
    </section>
  `;
  bindEntityButtons();
}

function renderCatalogView() {
  const rows = endpointNodes().filter((node) => endpointFilter === "all" || node.status === endpointFilter);
  viewRoot.innerHTML = `
    <section class="table-card">
      <div class="section-title">
        <div>
          <h2>Каталог endpoint</h2>
          <p>Список endpoint, найденных discovery-runner'ом. Клик по endpoint открывает payload, headers и schema.</p>
        </div>
        <div class="toolbar">
          ${["all", "changed", "fail", "removed"].map((value) => `
            <button class="secondary filter-control ${endpointFilter === value ? "active" : ""}" data-filter="${value}" type="button">${filterLabel(value)}</button>
          `).join("")}
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Status</th>
            <th>Schema</th>
            <th>Diff</th>
          </tr>
        </thead>
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
          <p>Связи page -> endpoint показывают, какие API были найдены во время discovery.</p>
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
      <h3>${run.label}</h3>
      <p class="muted">${run.environment} · ${run.startedAt}</p>
      <div class="toolbar">
        <span class="pill ${run.status}">${statusLabel(run.status)}</span>
        <span class="badge">${run.diffs} diff</span>
        <span class="badge">${run.endpoints} endpoints</span>
      </div>
    </div>
  `;
}

function reviewItems() {
  return data.nodes.flatMap((node) => node.details.diffs.map((diff) => ({ node, diff })));
}

function reviewItem({ node, diff }) {
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
  const width = 940;
  const height = 560;
  const visibleIds = new Set(nodes.map((node) => node.id));
  const lines = edges
    .filter(([from, to]) => visibleIds.has(from) && visibleIds.has(to))
    .map(([from, to]) => {
      const a = nodes.find((node) => node.id === from);
      const b = nodes.find((node) => node.id === to);
      const x1 = a.x + 174;
      const y1 = a.y + 38;
      const x2 = b.x;
      const y2 = b.y + 38;
      const color = b.status === "fail" || b.status === "removed" ? "#ef4444" : "#94a3b8";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-dasharray="${b.status === "removed" ? "5 5" : "0"}" />`;
    }).join("");

  container.innerHTML = `
    <svg class="edge-layer" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${lines}</svg>
    ${nodes.map((node) => `
      <button class="node ${node.type} ${node.status} ${node.id === selectedId ? "selected" : ""}" style="left:${node.x}px; top:${node.y}px" data-entity="${node.id}" type="button">
        <small>${node.type === "endpoint" ? "endpoint" : "page"} · ${statusLabel(node.status)}</small>
        <strong>${node.label}</strong>
        <small>${node.summary}</small>
      </button>
    `).join("")}
  `;
  bindEntityButtons(container);
}

function renderDetails() {
  const node = selectedNode();
  const details = node.details;
  detailsEl.innerHTML = `
    <div class="details-header">
      <div>
        <h2>${node.label}</h2>
        <p>${node.summary}</p>
      </div>
      <span class="pill ${node.status}">${statusLabel(node.status)}</span>
    </div>

    <div class="info-grid">
      <div class="info"><span>Метод</span><strong>${details.method}</strong></div>
      <div class="info"><span>Статус</span><strong>${details.baselineStatus} -> ${details.currentStatus}</strong></div>
      <div class="info"><span>URL</span><strong>${details.url}</strong></div>
      <div class="info"><span>Тип</span><strong>${node.type}</strong></div>
    </div>

    <div class="diff-list">
      ${details.diffs.map((item) => `
        <div class="diff-item">
          <span class="pill ${item.severity}">${severityLabel(item.severity)}</span>
          <strong>${item.title}</strong>
          <p>${item.text}</p>
        </div>
      `).join("")}
    </div>

    ${renderTabs(node)}
  `;
  bindTabs();
}

function renderTabs(node) {
  const tabs = node.type === "endpoint"
    ? ["Response", "Schema", "Headers", "Payload"]
    : ["Видимый diff", "Headers", "Снимок"];

  return `
    <div class="tabs">
      ${tabs.map((tab, index) => `<button class="tab ${index === 0 ? "active" : ""}" data-tab="${tab}" type="button">${tab}</button>`).join("")}
    </div>
    <div id="tab-body">${tabContent(node, tabs[0])}</div>
  `;
}

function tabContent(node, tab) {
  const d = node.details;
  if (tab === "Response") {
    return `<h3>Response в baseline</h3><pre>${escapeHtml(stringify(d.response.baseline))}</pre><h3>Response в новом прогоне</h3><pre>${escapeHtml(stringify(d.response.current))}</pre>`;
  }
  if (tab === "Schema") {
    return `<pre>${escapeHtml(stringify(d.schema))}</pre>`;
  }
  if (tab === "Headers") {
    return `<h3>Request headers</h3><pre>${escapeHtml(stringify(d.requestHeaders || {}))}</pre><h3>Response headers</h3><pre>${escapeHtml(stringify(d.responseHeaders || d.headers || {}))}</pre>`;
  }
  if (tab === "Payload") {
    return `<pre>${escapeHtml(stringify(d.payload))}</pre>`;
  }
  if (tab === "Видимый diff") {
    return `<pre>${escapeHtml((d.visibleTextDiff || []).join("\n"))}</pre>`;
  }
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
      selectedId = button.dataset.entity;
      renderDetails();
      if (activeView === "graph") renderGraphView();
      if (activeView === "overview") renderOverviewView();
    });
  });
}

function bindViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

function filterLabel(value) {
  return {
    all: "Все",
    changed: "Изменено",
    fail: "Ошибка",
    removed: "Удалено"
  }[value] || value;
}

function schemaSummary(node) {
  const schema = node.details.schema;
  if (!schema) return "-";
  if (schema.current?.items?.[0]?.price?.oneOf) return "price: float|string";
  if (schema.current === null) return "нет в новом graph";
  return "без критичных изменений";
}

function stringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".topbar-actions [data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

renderView();
