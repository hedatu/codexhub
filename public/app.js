const STORAGE_KEY = "codexhub.config.v1";

const dom = {
  loginPanel: document.querySelector("#loginPanel"),
  content: document.querySelector("#content"),
  serverInput: document.querySelector("#serverInput"),
  tokenInput: document.querySelector("#tokenInput"),
  installPanel: document.querySelector("#installPanel"),
  mobileServerOutput: document.querySelector("#mobileServerOutput"),
  adminTokenOutput: document.querySelector("#adminTokenOutput"),
  installKeyOutput: document.querySelector("#installKeyOutput"),
  desktopInstallCommand: document.querySelector("#desktopInstallCommand"),
  saveConfigBtn: document.querySelector("#saveConfigBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  syncDot: document.querySelector("#syncDot"),
  syncText: document.querySelector("#syncText"),
  metricOnline: document.querySelector("#metricOnline"),
  metricRunning: document.querySelector("#metricRunning"),
  metricReply: document.querySelector("#metricReply"),
  metricApproval: document.querySelector("#metricApproval"),
  attentionCount: document.querySelector("#attentionCount"),
  attentionList: document.querySelector("#attentionList"),
  nodeList: document.querySelector("#nodeList"),
  nodeRange: document.querySelector("#nodeRange"),
  statusFilter: document.querySelector("#statusFilter"),
  detailPane: document.querySelector("#detailPane"),
  closeDetailBtn: document.querySelector("#closeDetailBtn"),
  detailContent: document.querySelector("#detailContent"),
};

const state = {
  config: readConfig(),
  dashboard: null,
  selectedNodeId: null,
  selectedThreadId: null,
  installProfile: null,
  eventSource: null,
  view: "overview",
};

function readConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      server: window.location.origin,
      token: "",
    };
  }
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

async function apiFetch(path, init = {}) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.config.token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  }
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

function timeAgo(iso) {
  if (!iso) return "从未";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleString();
}

function statusLabel(node) {
  if (node.status === "revoked") return { className: "offline", text: "已吊销" };
  if (node.status !== "online") return { className: "offline", text: "离线" };
  if (node.metrics.waitingApproval > 0) return { className: "approval", text: "待审批" };
  if (node.metrics.waitingReply > 0) return { className: "waiting", text: "等待回复" };
  if (node.metrics.running > 0) return { className: "running", text: "运行中" };
  return { className: "online", text: "在线" };
}

function threadStatus(thread) {
  if (thread.waitingOnApproval) return { className: "approval", text: "待审批" };
  if (thread.waitingOnUserInput) return { className: "waiting", text: "等待回复" };
  if (thread.isGenerating) return { className: "running", text: "运行中" };
  return { className: "online", text: "空闲" };
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function setConnection(ok, text) {
  dom.syncDot.className = ok ? "dot" : "dot danger";
  dom.syncText.textContent = text;
}

function render() {
  if (!isConfigured()) {
    dom.loginPanel.classList.remove("hidden");
    dom.installPanel.classList.add("hidden");
    dom.content.classList.add("hidden");
    dom.serverInput.value = state.config.server || window.location.origin;
    dom.tokenInput.value = state.config.token || "";
    return;
  }
  dom.loginPanel.classList.add("hidden");
  dom.content.classList.remove("hidden");

  const dashboard = state.dashboard;
  if (!dashboard) return;
  const totals = dashboard.totals;
  dom.metricOnline.textContent = `${totals.online}/${totals.nodes}`;
  dom.metricRunning.textContent = String(totals.running);
  dom.metricReply.textContent = String(totals.waitingReply);
  dom.metricApproval.textContent = String(totals.waitingApproval);
  dom.attentionCount.textContent = String(totals.attention);
  dom.nodeRange.textContent = totals.nodes > 0 ? `${totals.nodes} 台电脑` : "等待上报";
  renderAttention(dashboard.nodes);
  renderNodes(dashboard.nodes);
  renderDetail();
  renderInstallProfile();
}

function renderInstallProfile() {
  const profile = state.installProfile;
  if (!profile) {
    dom.installPanel.classList.add("hidden");
    return;
  }
  dom.installPanel.classList.remove("hidden");
  dom.mobileServerOutput.value = profile.mobile?.serverUrl ?? profile.serverUrl ?? "";
  dom.adminTokenOutput.value = profile.mobile?.token ?? "";
  dom.installKeyOutput.value = profile.installKey ?? "";
  dom.desktopInstallCommand.value = profile.desktop?.powershell ?? "";
}

function showSettings() {
  dom.loginPanel.classList.remove("hidden");
  renderInstallProfile();
  dom.content.classList.add("hidden");
  dom.serverInput.value = state.config.server || window.location.origin;
  dom.tokenInput.value = state.config.token || "";
}

function showMain() {
  dom.loginPanel.classList.add("hidden");
  dom.content.classList.remove("hidden");
}

function renderAttention(nodes) {
  const items = nodes.flatMap((node) =>
    node.attention.map((thread) => ({
      node,
      thread,
      status: threadStatus(thread),
    })),
  );

  if (items.length === 0) {
    dom.attentionList.innerHTML = `<div class="attention-card"><p class="preview">暂无等待回复或审批的任务。</p></div>`;
    return;
  }

  dom.attentionList.innerHTML = items.map(({ node, thread, status }) => `
    <article class="attention-card" data-node="${escapeHtml(node.id)}" data-thread="${escapeHtml(thread.id)}">
      <div class="card-top">
        <div class="task-title">
          <strong>${escapeHtml(node.name)} · ${escapeHtml(thread.title || thread.preview || "未命名任务")}</strong>
          <span>${escapeHtml(thread.cwd || thread.source || thread.provider)} · ${timeAgo(thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : node.lastSeenAt)}</span>
        </div>
        <span class="status-chip ${status.className}">${status.text}</span>
      </div>
      <p class="preview">${escapeHtml(thread.preview || "等待处理")}</p>
      <div class="quick-actions">
        <button class="secondary-button" data-action="open">查看</button>
        ${thread.waitingOnUserInput ? `<button class="primary-button" data-action="reply">回复</button>` : ""}
        ${thread.waitingOnApproval ? `<button class="danger-button" data-action="interrupt">中断</button>` : ""}
      </div>
    </article>
  `).join("");
}

function renderNodes(nodes) {
  const filter = dom.statusFilter.value;
  const filtered = nodes.filter((node) => {
    if (filter === "all") return true;
    if (filter === "attention") return node.metrics.attention > 0;
    return node.status === filter;
  });

  if (filtered.length === 0) {
    dom.nodeList.innerHTML = `<div class="node-card"><p class="preview">没有符合筛选条件的节点。</p></div>`;
    return;
  }

  dom.nodeList.innerHTML = filtered.map((node) => {
    const status = statusLabel(node);
    return `
      <article class="node-card" data-node="${escapeHtml(node.id)}">
        <div class="node-top">
          <div class="node-title">
            <strong>${escapeHtml(node.name)}</strong>
            <span>${escapeHtml(node.host?.hostname ?? node.id)} · ${timeAgo(node.lastSeenAt)}</span>
          </div>
          <span class="status-chip ${status.className}">${status.text}</span>
        </div>
        <div class="node-stats">
          <div class="node-stat"><span>运行中</span><strong>${node.metrics.running}</strong></div>
          <div class="node-stat"><span>待回复</span><strong>${node.metrics.waitingReply}</strong></div>
          <div class="node-stat"><span>待审批</span><strong>${node.metrics.waitingApproval}</strong></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderDetail() {
  const dashboard = state.dashboard;
  if (!dashboard) return;
  const node = dashboard.nodes.find((item) => item.id === state.selectedNodeId);
  if (!node) {
    dom.detailContent.innerHTML = `<p class="empty-detail">选择一个节点或任务查看详情。</p>`;
    return;
  }
  const selectedThread = node.threads.find((thread) => thread.id === state.selectedThreadId) ?? null;
  const status = statusLabel(node);
  dom.detailContent.innerHTML = `
    <h2>${escapeHtml(node.name)}</h2>
    <span class="status-chip ${status.className}">${status.text}</span>
    <div class="detail-meta">
      <div><span>节点 ID</span><strong>${escapeHtml(node.id)}</strong></div>
      <div><span>最近上报</span><strong>${timeAgo(node.lastSeenAt)}</strong></div>
      <div><span>Farfield</span><strong>${node.farfield?.appReady ? "就绪" : "未就绪"}</strong></div>
      <div><span>IPC</span><strong>${node.farfield?.ipcConnected ? "已连接" : "未连接"}</strong></div>
      ${node.revokedAt ? `<div><span>吊销时间</span><strong>${timeAgo(node.revokedAt)}</strong></div>` : ""}
    </div>
    <div class="composer">
      <input id="nodeNameInput" value="${escapeHtml(node.name)}" aria-label="节点名称" />
      <button class="secondary-button" data-update-node="${escapeHtml(node.id)}">保存名称</button>
      <button class="danger-button" data-revoke-node="${escapeHtml(node.id)}">吊销设备密钥</button>
    </div>
    ${node.lastError ? `<p class="preview">${escapeHtml(node.lastError)}</p>` : ""}
    ${selectedThread ? renderThreadDetail(node, selectedThread) : renderThreadList(node)}
  `;
}

function renderThreadList(node) {
  if (node.threads.length === 0) {
    return `<h3>最近任务</h3><p class="preview">该节点还没有上报线程。</p>`;
  }
  return `
    <h3>最近任务</h3>
    <div class="thread-list">
      ${node.threads.slice(0, 18).map((thread) => {
        const status = threadStatus(thread);
        return `
          <button class="thread-row" data-detail-thread="${escapeHtml(thread.id)}">
            <div>
              <strong>${escapeHtml(thread.title || thread.preview || "未命名任务")}</strong>
              <p>${escapeHtml(thread.preview || thread.cwd || thread.provider)}</p>
            </div>
            <span class="status-chip ${status.className}">${status.text}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderThreadDetail(node, thread) {
  const status = threadStatus(thread);
  return `
    <h3>任务详情</h3>
    <div class="thread-row">
      <div>
        <strong>${escapeHtml(thread.title || "未命名任务")}</strong>
        <p>${escapeHtml(thread.preview || "暂无预览")}</p>
      </div>
      <span class="status-chip ${status.className}">${status.text}</span>
    </div>
    <div class="composer">
      <textarea id="replyText" placeholder="输入要发送给该 Codex 线程的消息..."></textarea>
      <button class="primary-button" data-send-reply="${escapeHtml(node.id)}:${escapeHtml(thread.id)}">发送回复</button>
      <button class="danger-button" data-interrupt-thread="${escapeHtml(node.id)}:${escapeHtml(thread.id)}">中断任务</button>
    </div>
  `;
}

async function loadState() {
  if (!isConfigured()) {
    render();
    return;
  }
  try {
    const dashboard = await apiFetch("/api/state");
    state.dashboard = dashboard;
    await loadInstallProfile();
    setConnection(true, `已同步 · ${new Date(dashboard.generatedAt).toLocaleTimeString()}`);
    render();
    connectEvents();
  } catch (error) {
    setConnection(false, error.message);
    render();
  }
}

async function loadInstallProfile() {
  try {
    state.installProfile = await apiFetch("/api/install-profile");
  } catch {
    state.installProfile = null;
  }
}

function connectEvents() {
  if (state.eventSource) return;
  const url = `${apiUrl("/api/events")}?token=${encodeURIComponent(state.config.token)}`;
  state.eventSource = new EventSource(url);
  state.eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state" && payload.state) {
      state.dashboard = payload.state;
      setConnection(true, `实时 · ${new Date(payload.state.generatedAt).toLocaleTimeString()}`);
      render();
    }
  };
  state.eventSource.onerror = () => {
    state.eventSource?.close();
    state.eventSource = null;
    setConnection(false, "实时连接断开");
  };
}

function openDetail(nodeId, threadId = null) {
  state.selectedNodeId = nodeId;
  state.selectedThreadId = threadId;
  dom.detailPane.classList.add("open");
  renderDetail();
}

async function queueAction(nodeId, action) {
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
  showToast("已下发到桌面端队列");
  await loadState();
}

async function updateNode(nodeId, body) {
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/update`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  showToast("节点信息已保存");
  await loadState();
  openDetail(nodeId, state.selectedThreadId);
}

async function revokeNode(nodeId) {
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  showToast("设备密钥已吊销");
  await loadState();
  openDetail(nodeId, null);
}

dom.saveConfigBtn.addEventListener("click", async () => {
  saveConfig({
    server: dom.serverInput.value || window.location.origin,
    token: dom.tokenInput.value,
  });
  state.eventSource?.close();
  state.eventSource = null;
  await loadState();
});

dom.settingsBtn.addEventListener("click", () => {
  if (dom.loginPanel.classList.contains("hidden")) {
    showSettings();
  } else {
    showMain();
  }
});

dom.refreshBtn.addEventListener("click", loadState);
dom.statusFilter.addEventListener("change", render);
dom.closeDetailBtn.addEventListener("click", () => dom.detailPane.classList.remove("open"));

document.addEventListener("click", async (event) => {
  const attentionCard = event.target.closest(".attention-card");
  if (attentionCard) {
    const nodeId = attentionCard.dataset.node;
    const threadId = attentionCard.dataset.thread;
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton || actionButton.dataset.action === "open") {
      openDetail(nodeId, threadId);
      return;
    }
    if (actionButton.dataset.action === "reply") {
      openDetail(nodeId, threadId);
      setTimeout(() => document.querySelector("#replyText")?.focus(), 0);
      return;
    }
    if (actionButton.dataset.action === "interrupt") {
      await queueAction(nodeId, { kind: "interrupt", provider: "codex", threadId });
      return;
    }
  }

  const nodeCard = event.target.closest(".node-card");
  if (nodeCard) {
    openDetail(nodeCard.dataset.node);
    return;
  }

  const threadButton = event.target.closest("[data-detail-thread]");
  if (threadButton && state.selectedNodeId) {
    openDetail(state.selectedNodeId, threadButton.dataset.detailThread);
    return;
  }

  const sendButton = event.target.closest("[data-send-reply]");
  if (sendButton) {
    const [nodeId, threadId] = sendButton.dataset.sendReply.split(":");
    const text = document.querySelector("#replyText")?.value?.trim();
    if (!text) {
      showToast("请输入回复内容");
      return;
    }
    await queueAction(nodeId, { kind: "sendMessage", provider: "codex", threadId, text });
    return;
  }

  const interruptButton = event.target.closest("[data-interrupt-thread]");
  if (interruptButton) {
    const [nodeId, threadId] = interruptButton.dataset.interruptThread.split(":");
    await queueAction(nodeId, { kind: "interrupt", provider: "codex", threadId });
    return;
  }

  const updateButton = event.target.closest("[data-update-node]");
  if (updateButton) {
    const nodeId = updateButton.dataset.updateNode;
    const name = document.querySelector("#nodeNameInput")?.value?.trim();
    await updateNode(nodeId, { name });
    return;
  }

  const revokeButton = event.target.closest("[data-revoke-node]");
  if (revokeButton) {
    const nodeId = revokeButton.dataset.revokeNode;
    if (confirm(`确定吊销 ${nodeId} 的设备密钥？这台电脑需要重新安装/登记后才能上线。`)) {
      await revokeNode(nodeId);
    }
    return;
  }

  const copyButton = event.target.closest("[data-copy-target]");
  if (copyButton) {
    const target = document.querySelector(`#${copyButton.dataset.copyTarget}`);
    if (target) {
      await navigator.clipboard.writeText(target.value);
      showToast("已复制");
    }
  }
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "settings") {
      showSettings();
      return;
    }
    showMain();
    state.view = view;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    if (view === "nodes") document.querySelector(".nodes-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (view === "attention") document.querySelector(".attention-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

await loadState();
