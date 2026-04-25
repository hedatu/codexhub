const STORAGE_KEY = "codexhub.config.v1";

const dom = {
  login: document.querySelector("#tvLogin"),
  content: document.querySelector("#tvContent"),
  serverInput: document.querySelector("#tvServerInput"),
  tokenInput: document.querySelector("#tvTokenInput"),
  saveBtn: document.querySelector("#tvSaveBtn"),
  clock: document.querySelector("#tvClock"),
  sync: document.querySelector("#tvSync"),
  online: document.querySelector("#tvOnline"),
  running: document.querySelector("#tvRunning"),
  reply: document.querySelector("#tvReply"),
  approval: document.querySelector("#tvApproval"),
  today: document.querySelector("#tvToday"),
  threads: document.querySelector("#tvThreads"),
  nodeHint: document.querySelector("#tvNodeHint"),
  nodes: document.querySelector("#tvNodes"),
  queue: document.querySelector("#tvQueue"),
};

const state = {
  config: readConfig(),
  dashboard: null,
  eventSource: null,
};

function readConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { server: window.location.origin, token: "" };
  try {
    return JSON.parse(raw);
  } catch {
    return { server: window.location.origin, token: "" };
  }
}

function saveConfig(config) {
  state.config = {
    server: config.server.replace(/\/+$/, ""),
    token: config.token,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function isConfigured() {
  return Boolean(state.config.server && state.config.token);
}

function apiUrl(path) {
  return `${state.config.server.replace(/\/+$/, "")}${path}`;
}

async function apiFetch(path) {
  const response = await fetch(apiUrl(path), {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.config.token}`,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function threadStatus(thread) {
  if (thread.waitingOnApproval) return { className: "approval", text: "待审批" };
  if (thread.waitingOnUserInput) return { className: "waiting", text: "待回复" };
  if (thread.isGenerating) return { className: "running", text: "运行中" };
  return { className: "online", text: "已同步" };
}

function nodeStatus(node) {
  if (node.status !== "online") return { className: "offline", text: "离线" };
  if (node.metrics.waitingApproval > 0) return { className: "approval", text: "待审批" };
  if (node.metrics.waitingReply > 0) return { className: "waiting", text: "待回复" };
  if (node.metrics.running > 0) return { className: "running", text: "运行中" };
  return { className: "online", text: "在线" };
}

function isToday(epochSeconds) {
  if (!epochSeconds) return false;
  const date = new Date(epochSeconds * 1000);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function render() {
  if (!isConfigured()) {
    dom.login.classList.remove("hidden");
    dom.content.classList.add("hidden");
    dom.serverInput.value = state.config.server || window.location.origin;
    dom.tokenInput.value = state.config.token || "";
    return;
  }

  dom.login.classList.add("hidden");
  dom.content.classList.remove("hidden");
  if (!state.dashboard) return;

  const nodes = state.dashboard.nodes ?? [];
  const totals = state.dashboard.totals;
  const allThreads = nodes.flatMap((node) => (node.threads ?? []).map((thread) => ({ node, thread })));
  const todayCount = allThreads.filter(({ thread }) => isToday(thread.updatedAt ?? thread.createdAt)).length;
  const queue = allThreads
    .filter(({ thread }) => thread.isGenerating || thread.waitingOnApproval || thread.waitingOnUserInput)
    .sort((a, b) => Number(b.thread.updatedAt ?? 0) - Number(a.thread.updatedAt ?? 0))
    .slice(0, 18);

  dom.online.textContent = `${totals.online}/${totals.nodes}`;
  dom.running.textContent = String(totals.running);
  dom.reply.textContent = String(totals.waitingReply);
  dom.approval.textContent = String(totals.waitingApproval);
  dom.today.textContent = String(todayCount);
  dom.threads.textContent = String(allThreads.length);
  dom.nodeHint.textContent = `${totals.nodes} 台电脑 · ${totals.online} 台在线`;

  dom.nodes.innerHTML = nodes.map((node) => {
    const status = nodeStatus(node);
    return `
      <article class="tv-node ${status.className}">
        <div>
          <strong>${escapeHtml(node.name)}</strong>
          <span>${escapeHtml(node.host?.platform ?? "unknown")} · ${escapeHtml(node.host?.arch ?? "")}</span>
        </div>
        <em>${status.text}</em>
        <dl>
          <div><dt>运行</dt><dd>${node.metrics.running}</dd></div>
          <div><dt>回复</dt><dd>${node.metrics.waitingReply}</dd></div>
          <div><dt>审批</dt><dd>${node.metrics.waitingApproval}</dd></div>
          <div><dt>线程</dt><dd>${node.metrics.totalThreads}</dd></div>
        </dl>
      </article>
    `;
  }).join("");

  dom.queue.innerHTML = queue.length ? queue.map(({ node, thread }) => {
    const status = threadStatus(thread);
    return `
      <article class="tv-queue-row">
        <span class="status-chip ${status.className}">${status.text}</span>
        <div>
          <strong>${escapeHtml(node.name)} · ${escapeHtml(thread.title || thread.preview || "未命名任务")}</strong>
          <p>${escapeHtml(thread.cwd || thread.preview || thread.provider)}</p>
        </div>
      </article>
    `;
  }).join("") : `<div class="tv-empty">暂无运行中或待处理任务</div>`;
}

async function loadState() {
  if (!isConfigured()) {
    render();
    return;
  }
  try {
    state.dashboard = await apiFetch("/api/state");
    dom.sync.textContent = `已同步 ${new Date(state.dashboard.generatedAt).toLocaleTimeString()}`;
    render();
    connectEvents();
  } catch (error) {
    dom.sync.textContent = error.message;
    render();
  }
}

function connectEvents() {
  if (state.eventSource) return;
  state.eventSource = new EventSource(`${apiUrl("/api/events")}?token=${encodeURIComponent(state.config.token)}`);
  state.eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state" && payload.state) {
      state.dashboard = payload.state;
      dom.sync.textContent = `实时 ${new Date(payload.state.generatedAt).toLocaleTimeString()}`;
      render();
    }
  };
  state.eventSource.onerror = () => {
    state.eventSource?.close();
    state.eventSource = null;
    dom.sync.textContent = "实时连接断开，轮询中";
  };
}

dom.saveBtn.addEventListener("click", async () => {
  saveConfig({
    server: dom.serverInput.value || window.location.origin,
    token: dom.tokenInput.value,
  });
  state.eventSource?.close();
  state.eventSource = null;
  await loadState();
});

setInterval(() => {
  dom.clock.textContent = new Date().toLocaleTimeString();
}, 1000);
setInterval(loadState, 30000);

await loadState();
