const data = window.SCAN_DATA;
let selectedId = "api-products";
let filter = "all";

const graphEl = document.getElementById("graph");
const detailsEl = document.getElementById("details");
const statsEl = document.getElementById("stats-grid");

function statusLabel(status) {
  return {
    changed: "Changed",
    fail: "Fail",
    removed: "Removed",
    ok: "OK"
  }[status] || status;
}

function statusMatches(node) {
  if (filter === "all") return true;
  return node.status === filter;
}

function renderSummary() {
  document.getElementById("summary-pages").textContent = `${data.baseline.summary.pages} -> ${data.current.summary.pages}`;
  document.getElementById("summary-endpoints").textContent = `${data.baseline.summary.endpoints} -> ${data.current.summary.endpoints}`;
  document.getElementById("summary-edges").textContent = `${data.baseline.summary.edges} -> ${data.current.summary.edges}`;
  document.getElementById("summary-critical").textContent = data.current.summary.critical;

  const stats = [
    ["Pages", `${data.baseline.summary.pages} -> ${data.current.summary.pages}`],
    ["Endpoints", `${data.baseline.summary.endpoints} -> ${data.current.summary.endpoints}`],
    ["Edges", `${data.baseline.summary.edges} -> ${data.current.summary.edges}`],
    ["Diffs", data.current.summary.diffs]
  ];

  statsEl.innerHTML = stats.map(([label, value]) => `
    <article class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderGraph() {
  const visibleNodes = data.nodes.filter(statusMatches);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const width = 940;
  const height = 560;

  const lines = data.edges
    .filter(([from, to]) => visibleIds.has(from) && visibleIds.has(to))
    .map(([from, to]) => {
      const a = data.nodes.find((node) => node.id === from);
      const b = data.nodes.find((node) => node.id === to);
      const x1 = a.x + 174;
      const y1 = a.y + 38;
      const x2 = b.x;
      const y2 = b.y + 38;
      const color = b.status === "fail" || b.status === "removed" ? "#ef4444" : "#94a3b8";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-dasharray="${b.status === "removed" ? "5 5" : "0"}" />`;
    }).join("");

  graphEl.innerHTML = `
    <svg class="edge-layer" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${lines}</svg>
    ${visibleNodes.map((node) => `
      <button class="node ${node.type} ${node.status} ${node.id === selectedId ? "selected" : ""}" style="left:${node.x}px; top:${node.y}px" data-node-id="${node.id}" type="button">
        <small>${node.type === "endpoint" ? "Endpoint" : "Page"} · ${statusLabel(node.status)}</small>
        <strong>${node.label}</strong>
        <small>${node.summary}</small>
      </button>
    `).join("")}
  `;

  graphEl.querySelectorAll(".node").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.nodeId;
      renderGraph();
      renderDetails();
    });
  });
}

function stringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderDetails() {
  const node = data.nodes.find((item) => item.id === selectedId) || data.nodes[0];
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
      <div class="info"><span>Method</span><strong>${details.method}</strong></div>
      <div class="info"><span>Status</span><strong>${details.baselineStatus} -> ${details.currentStatus}</strong></div>
      <div class="info"><span>URL</span><strong>${details.url}</strong></div>
      <div class="info"><span>Entity</span><strong>${node.type}</strong></div>
    </div>

    <div class="diff-list">
      ${details.diffs.map((item) => `
        <div class="diff-item">
          <span class="pill ${item.severity}">${item.severity}</span>
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
  const d = node.details;
  const isEndpoint = node.type === "endpoint";
  const tabs = isEndpoint
    ? ["Response", "Schema", "Headers", "Payload"]
    : ["Visible diff", "Headers", "Snapshot"];

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
    return `<h3>Baseline response</h3><pre>${escapeHtml(stringify(d.response.baseline))}</pre><h3>Current response</h3><pre>${escapeHtml(stringify(d.response.current))}</pre>`;
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
  if (tab === "Visible diff") {
    return `<pre>${escapeHtml((d.visibleTextDiff || []).join("\n"))}</pre>`;
  }
  return `<pre>${escapeHtml(stringify(d))}</pre>`;
}

function bindTabs() {
  detailsEl.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      detailsEl.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      const node = data.nodes.find((item) => item.id === selectedId) || data.nodes[0];
      document.getElementById("tab-body").innerHTML = tabContent(node, tab.dataset.tab);
    });
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function bindFilters() {
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      filter = button.dataset.filter;
      const firstVisible = data.nodes.find(statusMatches);
      if (firstVisible && !statusMatches(data.nodes.find((node) => node.id === selectedId))) {
        selectedId = firstVisible.id;
      }
      renderGraph();
      renderDetails();
    });
  });
}

renderSummary();
renderGraph();
renderDetails();
bindFilters();
