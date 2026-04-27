const STORAGE_KEY = "codexhub.config.v1";
const params = new URLSearchParams(window.location.search);

const dom = {
  app: document.querySelector("#fleetApp"),
  login: document.querySelector("#tvLogin"),
  loginForm: document.querySelector("#fleetLoginForm"),
  content: document.querySelector("#tvContent"),
  timeline: document.querySelector("#fleetTimeline"),
  serverInput: document.querySelector("#tvServerInput"),
  tokenInput: document.querySelector("#tvTokenInput"),
  saveBtn: document.querySelector("#tvSaveBtn"),
  mockBtn: document.querySelector("#fleetMockBtn"),
  sync: document.querySelector("#fleetSync"),
  viewport: document.querySelector("#fleetViewport"),
  healthStrip: document.querySelector("#fleetHealthStrip"),
  metrics: document.querySelector("#fleetMetrics"),
  nodeCount: document.querySelector("#fleetNodeCount"),
  deviceFilters: document.querySelector("#fleetDeviceFilters"),
  devices: document.querySelector("#fleetDevices"),
  threads: document.querySelector("#fleetThreads"),
  queueCount: document.querySelector("#fleetQueueCount"),
  queue: document.querySelector("#fleetQueue"),
  events: document.querySelector("#fleetEvents"),
  refreshBtn: document.querySelector("#fleetRefreshBtn"),
  density: document.querySelector("#fleetDensity"),
  columns: document.querySelector("#fleetColumns"),
  autoScroll: document.querySelector("#fleetAutoScroll"),
  modal: document.querySelector("#fleetModal"),
  modalClose: document.querySelector("#fleetModalClose"),
  modalMeta: document.querySelector("#fleetModalMeta"),
  modalTitle: document.querySelector("#fleetModalTitle"),
  modalBody: document.querySelector("#fleetModalBody"),
  toast: document.querySelector("#fleetToast"),
};

const state = {
  config: readConfig(),
  dashboard: null,
  view: null,
  eventSource: null,
  deviceFilter: "all",
  density: params.get("density") || "compact",
  columns: params.get("columns") || "auto",
  mockMode: params.get("mock") === "1",
  liveEvents: [],
  selected: null,
  agentDrafts: new Map(),
  replyDrafts: new Map(),
  operationMode: true,
  lastError: "",
  refreshInFlight: false,
  viewportTier: viewportTier(),
  mobileEditing: false,
};

const DEVICE_FILTERS = [
  ["all", "全部"],
  ["online", "在线"],
  ["busy", "忙碌"],
  ["offline", "离线"],
];

const STATUS = {
  running: { text: "运行中", tone: "blue", rank: 5 },
  waiting_reply: { text: "等待回复", tone: "yellow", rank: 2 },
  waiting_approval: { text: "待审批", tone: "orange", rank: 1 },
  agent_draft: { text: "Agent 草稿", tone: "purple", rank: 3 },
  failed: { text: "失败命令", tone: "red", rank: 4 },
  completed_unread: { text: "已完成未读", tone: "green", rank: 6 },
  completed: { text: "已完成", tone: "green", rank: 7 },
  idle: { text: "已同步", tone: "slate", rank: 8 },
  archived: { text: "已读归档", tone: "slate", rank: 9 },
};

const RISK = {
  low: { text: "低风险", tone: "green" },
  medium: { text: "中风险", tone: "yellow" },
  high: { text: "高风险", tone: "red" },
};

const RISK_KEYWORDS = [
  ["production", "生产"],
  ["prod", "生产"],
  ["deploy", "部署"],
  ["delete", "删除"],
  ["rm -rf", "递归删除"],
  ["git push", "推送"],
  ["secret", "密钥"],
  ["token", "令牌"],
  ["database", "数据库"],
  ["payment", "支付"],
  ["k8s", "集群"],
  ["kubectl", "集群"],
  ["生产", "生产"],
  ["部署", "部署"],
  ["删除", "删除"],
  ["密钥", "密钥"],
  ["数据库", "数据库"],
  ["支付", "支付"],
  ["集群", "集群"],
  ["失败", "失败"],
];

function viewportTier() {
  const width = window.innerWidth || 1920;
  if (width <= 700) return "mobile";
  if (width <= 1180) return "tablet";
  if (width <= 2050) return "fullhd";
  if (width <= 3000) return "qhd";
  return "uhd";
}

function isMobileViewport() {
  return state.viewportTier === "mobile";
}

function viewportProfile() {
  return {
    mobile: { threadLimit: 8, queueLimit: 12, eventLimit: 8 },
    tablet: { threadLimit: 10, queueLimit: 10, eventLimit: 8 },
    fullhd: { threadLimit: 12, queueLimit: 8, eventLimit: 10 },
    qhd: { threadLimit: 18, queueLimit: 10, eventLimit: 12 },
    uhd: { threadLimit: 28, queueLimit: 14, eventLimit: 16 },
  }[state.viewportTier] || { threadLimit: 12, queueLimit: 8, eventLimit: 10 };
}

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
    server: String(config.server || window.location.origin).replace(/\/+$/, ""),
    token: String(config.token || ""),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function isConfigured() {
  return state.mockMode || Boolean(state.config.server && state.config.token);
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
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
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

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nowMinus(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function timeAgo(value) {
  const millis = toMillis(value);
  if (!millis) return "从未";
  const seconds = Math.max(0, Math.round((Date.now() - millis) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(millis).toLocaleDateString();
}

function clock(value) {
  const millis = toMillis(value) || Date.now();
  return new Date(millis).toLocaleTimeString("zh-CN", { hour12: false });
}

function compactText(text, limit = 150) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

function hashValue(input) {
  const text = String(input || "codexhub");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableLoad(seed, offset = 0) {
  return clamp(28 + ((hashValue(`${seed}:${offset}`) % 64)), 0, 99);
}

function sparkline(seed, length = 26) {
  const base = hashValue(seed);
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((base % 31 + index) / 3.2) * 16;
    const jitter = hashValue(`${seed}:${index}`) % 24;
    return clamp(42 + wave + jitter - 10, 6, 96);
  });
}

function sparklineSvg(values, tone = "blue") {
  const width = 220;
  const height = 42;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - (value / max) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <svg class="fleet-spark ${tone}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <polyline points="${points}" fill="none" pathLength="1"></polyline>
    </svg>
  `;
}

function iconForDevice(node, index = 0) {
  const text = `${node.name || ""} ${node.host?.platform || ""} ${(node.tags || []).join(" ")}`.toLowerCase();
  if (text.includes("gpu") || text.includes("4090") || text.includes("rtx")) return "▥";
  if (text.includes("server") || text.includes("linux")) return "▤";
  if (text.includes("mac") || text.includes("book") || text.includes("mbp")) return "▱";
  return index % 3 === 0 ? "▣" : "▦";
}

function titleForThread(thread) {
  const title = String(thread.title || "").trim();
  if (title) return title;
  const preview = String(thread.preview || thread.latestMessage || "").trim();
  if (!preview) return "未命名任务";
  return compactText(preview.split(/\r?\n/).find(Boolean) || preview, 46);
}

function summaryForThread(thread) {
  return compactText(
    thread.latestProgressMessage ||
      thread.latestFinalMessage ||
      thread.latestMessage ||
      thread.preview ||
      thread.cwd ||
      thread.source ||
      "等待下一次同步。",
    180,
  );
}

function repoForThread(thread) {
  const raw = String(thread.cwd || thread.source || thread.provider || "codex").replaceAll("\\", "/");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts.at(-2)} / ${parts.at(-1)}`;
  return parts[0] || "codexhub / workspace";
}

function threadUpdatedAt(thread) {
  return thread.latestFinalMessageAt || thread.latestProgressMessageAt || thread.latestMessageAt || thread.updatedAt || thread.createdAt;
}

function statusForThread(thread) {
  if (state.agentDrafts.has(thread.nodeIdThreadId)) return "agent_draft";
  if (thread.taskState && STATUS[thread.taskState]) return thread.taskState;
  if (thread.attentionKind === "commandFailed") return "failed";
  if (thread.attentionKind === "completed" || thread.attentionKind === "updated") return thread.readAt ? "archived" : "completed_unread";
  if (thread.waitingOnApproval) return "waiting_approval";
  if (thread.waitingOnUserInput) return "waiting_reply";
  if (thread.isGenerating) return "running";
  if (thread.latestFinalMessageAt || thread.latestFinalMessage) return thread.readAt ? "archived" : "completed";
  return "idle";
}

function riskForThread(thread, status) {
  const text = `${thread.title || ""} ${thread.cwd || ""} ${thread.latestMessage || ""} ${thread.preview || ""}`.toLowerCase();
  const highWords = ["deploy", "delete", "remove", "rm -rf", "push", "prod", "production", "secret", "token", "database", "payment", "k8s", "权限", "支付", "生产", "删除", "密钥", "数据库", "集群"];
  if (status === "failed" || status === "waiting_approval" || highWords.some((word) => text.includes(word))) return "high";
  if (status === "waiting_reply" || status === "agent_draft") return "medium";
  return "low";
}

function normalizeDashboard(dashboard) {
  const sourceNodes = Array.isArray(dashboard?.nodes) ? dashboard.nodes : [];
  const devices = sourceNodes.map((node, index) => {
    const running = Number(node.metrics?.running || 0);
    const pending = Number(node.metrics?.waitingReply || 0) + Number(node.metrics?.waitingApproval || 0) + Number(node.syncHealth?.unreadNotifications || 0);
    const status = node.status !== "online"
      ? "offline"
      : running >= 8 || pending >= 3 || Number(node.syncHealth?.commandCounts?.failed || 0) > 0
        ? "busy"
        : "online";
    return {
      id: node.id,
      name: node.name || node.id,
      sourceStatus: node.status,
      status,
      running,
      pending,
      cpu: node.status === "online" ? stableLoad(node.id, running) : 0,
      memory: node.status === "online" ? stableLoad(node.id, pending + 10) : 0,
      heartbeat: node.lastSeenAt,
      host: node.host,
      icon: iconForDevice(node, index),
      metrics: node.metrics || {},
      syncHealth: node.syncHealth || {},
      raw: node,
    };
  });

  const threadRows = sourceNodes.flatMap((node) => {
    const byKey = new Map();
    for (const thread of [...(node.threads || []), ...(node.attention || [])]) {
      const id = String(thread?.id || "");
      if (!id) continue;
      const key = `${node.id}::${id}`;
      const existing = byKey.get(key);
      byKey.set(key, existing ? {
        ...existing,
        ...thread,
        title: thread.title || existing.title,
        preview: thread.preview || existing.preview,
        cwd: thread.cwd || existing.cwd,
        source: thread.source || existing.source,
        recentMessages: Array.isArray(thread.recentMessages) && thread.recentMessages.length ? thread.recentMessages : existing.recentMessages,
      } : thread);
    }
    return [...byKey.values()].map((thread) => ({ node, thread }));
  });

  const threads = threadRows.map(({ node, thread }) => {
    const key = `${node.id}::${thread.id}`;
    const enriched = {
      ...thread,
      nodeId: node.id,
      nodeName: node.name || node.id,
      nodeStatus: node.status,
      nodeIdThreadId: key,
      repo: repoForThread(thread),
      titleText: titleForThread(thread),
      summaryText: summaryForThread(thread),
      updatedSort: toMillis(threadUpdatedAt(thread)),
      sparkline: sparkline(key),
    };
    const status = statusForThread(enriched);
    return {
      ...enriched,
      status,
      statusLabel: STATUS[status]?.text || status,
      tone: STATUS[status]?.tone || "slate",
      risk: riskForThread(enriched, status),
      draft: state.agentDrafts.get(key) || null,
    };
  }).sort((a, b) => {
    const rankA = STATUS[a.status]?.rank || 99;
    const rankB = STATUS[b.status]?.rank || 99;
    return rankA - rankB || b.updatedSort - a.updatedSort;
  });

  const failedCommands = sourceNodes.flatMap((node) => (node.recentCommandResults || [])
    .filter((command) => command.status === "failed")
    .map((command) => ({
      id: `cmd:${command.id}`,
      type: "failed_command",
      status: "failed",
      risk: "high",
      title: "桌面端命令发送失败",
      summary: command.result?.error || command.result?.result?.error || "桌面端执行命令失败，请检查节点状态。",
      nodeId: node.id,
      nodeName: node.name || node.id,
      threadId: command.action?.threadId || "",
      repo: command.action?.provider || "codex",
      at: command.completedAt || command.createdAt,
      command,
    })));

  const queueFromThreads = threads
    .filter((thread) => ["waiting_approval", "waiting_reply", "agent_draft", "failed", "completed_unread"].includes(thread.status))
    .map((thread) => ({
      id: `thread:${thread.nodeIdThreadId}`,
      type: queueType(thread.status),
      status: thread.status,
      risk: thread.risk,
      title: thread.titleText,
      summary: thread.draft?.text || thread.summaryText,
      nodeId: thread.nodeId,
      nodeName: thread.nodeName,
      threadId: thread.id,
      repo: thread.repo,
      at: threadUpdatedAt(thread),
      thread,
    }));

  const queue = [...queueFromThreads, ...failedCommands]
    .sort((a, b) => {
      const rankA = STATUS[a.status]?.rank || 10;
      const rankB = STATUS[b.status]?.rank || 10;
      return rankA - rankB || toMillis(b.at) - toMillis(a.at);
    });

  const events = buildEvents(dashboard, sourceNodes, threads, failedCommands);
  const totals = dashboard?.totals || {};
  const metrics = {
    onlineDevices: Number(totals.online || devices.filter((item) => item.sourceStatus === "online").length),
    totalDevices: Number(totals.nodes || devices.length),
    runningThreads: Number(totals.running || threads.filter((thread) => thread.status === "running").length),
    waitingReplies: Number(totals.waitingReply || threads.filter((thread) => thread.status === "waiting_reply").length),
    waitingApprovals: Number(totals.waitingApproval || threads.filter((thread) => thread.status === "waiting_approval").length),
    agentDrafts: state.agentDrafts.size,
    failedCommands: Number(totals.failedCommands || failedCommands.length),
    completedToday: Number(totals.completedToday || 0),
    latestSyncSeconds: Math.max(0, Math.round((Date.now() - toMillis(dashboard?.generatedAt)) / 1000)) || 0,
  };

  return { devices, threads, queue, events, metrics };
}

function queueType(status) {
  return {
    waiting_approval: "待审批",
    waiting_reply: "等待回复",
    agent_draft: "Agent 草稿",
    failed: "失败命令",
    completed_unread: "已完成未读",
  }[status] || "待处理";
}

function buildEvents(dashboard, nodes, threads, failedCommands) {
  const fromNotifications = nodes.flatMap((node) => (node.notifications || []).slice(-4).map((notice) => ({
    id: `notice:${notice.id}`,
    ts: notice.createdAt,
    type: notice.type === "completed" ? "thread completed" : notice.type === "commandFailed" ? "command failed" : "codex replied",
    title: notice.title || "线程更新",
    detail: notice.preview || "Codex 状态已更新",
    nodeName: node.name || node.id,
    threadId: notice.threadId,
    tone: notice.type === "commandFailed" ? "red" : notice.type === "completed" ? "green" : "blue",
  })));
  const fromThreads = threads.slice(0, 8).map((thread) => ({
    id: `thread-event:${thread.nodeIdThreadId}:${thread.updatedSort}`,
    ts: threadUpdatedAt(thread),
    type: thread.status === "running" ? "codex replied" : STATUS[thread.status]?.text || "thread updated",
    title: thread.titleText,
    detail: `${thread.repo} · ${thread.nodeName}`,
    nodeName: thread.nodeName,
    threadId: thread.id,
    tone: thread.tone,
  }));
  const fromCommands = failedCommands.map((item) => ({
    id: `failed-event:${item.id}`,
    ts: item.at,
    type: "command failed",
    title: item.title,
    detail: `${item.nodeName} · ${item.summary}`,
    nodeName: item.nodeName,
    threadId: item.threadId,
    tone: "red",
  }));
  const syncEvent = dashboard?.generatedAt ? [{
    id: `sync:${dashboard.generatedAt}`,
    ts: dashboard.generatedAt,
    type: "sync completed",
    title: "全局状态同步完成",
    detail: `节点 ${dashboard?.totals?.online || 0}/${dashboard?.totals?.nodes || 0}`,
    tone: "cyan",
  }] : [];
  return [...state.liveEvents, ...fromCommands, ...fromNotifications, ...fromThreads, ...syncEvent]
    .filter((event) => event.ts)
    .sort((a, b) => toMillis(b.ts) - toMillis(a.ts))
    .slice(0, 16);
}

function metricItems(metrics) {
  return [
    ["在线电脑", `${metrics.onlineDevices}/${metrics.totalDevices}`, "▣", "green"],
    ["运行线程", metrics.runningThreads, "◉", "blue"],
    ["待回复", metrics.waitingReplies, "□", "yellow"],
    ["待审批", metrics.waitingApprovals, "⚠", "orange"],
    ["Agent 草稿", metrics.agentDrafts, "◇", "purple"],
    ["失败命令", metrics.failedCommands, "△", "red"],
    ["今日完成", metrics.completedToday, "✓", "green"],
    ["最新同步", `${metrics.latestSyncSeconds}s`, "↻", "cyan"],
  ];
}

function render() {
  applyLayoutControls();
  renderChrome();

  if (!isConfigured()) {
    dom.login.classList.remove("hidden");
    dom.content.classList.add("hidden");
    dom.timeline.classList.add("hidden");
    dom.serverInput.value = state.config.server || window.location.origin;
    dom.tokenInput.value = state.config.token || "";
    return;
  }

  dom.login.classList.add("hidden");
  dom.content.classList.remove("hidden");
  dom.timeline.classList.remove("hidden");

  if (!state.dashboard) {
    renderLoading();
    return;
  }

  state.view = normalizeDashboard(state.dashboard);
  renderMetrics(state.view.metrics);
  renderHealthStrip(state.view.metrics, state.view.queue);
  renderFilters();
  renderDevices(state.view.devices);
  renderThreads(state.view.threads);
  renderQueue(state.view.queue);
  renderEvents(state.view.events);
}

function renderChrome() {
  dom.viewport.textContent = `${window.innerWidth}x${window.innerHeight}`;
  dom.sync.textContent = state.mockMode
    ? "mock preview"
    : state.lastError
      ? state.lastError
      : state.dashboard?.generatedAt
        ? `实时 ${clock(state.dashboard.generatedAt)}`
        : "等待同步";
}

function renderLoading() {
  if (dom.healthStrip) {
    dom.healthStrip.innerHTML = `<span>等待 CodexHub 同步</span><i style="--health-width: 0%"></i>`;
  }
  dom.metrics.innerHTML = metricItems({
    onlineDevices: 0,
    totalDevices: 0,
    runningThreads: 0,
    waitingReplies: 0,
    waitingApprovals: 0,
    agentDrafts: 0,
    failedCommands: 0,
    completedToday: 0,
    latestSyncSeconds: 0,
  }).map(([label, value, icon, tone]) => metricHtml(label, value, icon, tone, true)).join("");
  dom.nodeCount.textContent = "0";
  dom.queueCount.textContent = "0";
  dom.devices.innerHTML = `<div class="fleet-empty">正在连接 CodexHub。</div>`;
  dom.threads.innerHTML = skeletonCards(6);
  dom.queue.innerHTML = `<div class="fleet-empty">等待状态同步。</div>`;
  dom.events.innerHTML = `<div class="fleet-empty">实时事件流准备中。</div>`;
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => `
    <article class="fleet-thread-card skeleton">
      <i></i><i></i><i></i><i></i>
    </article>
  `).join("");
}

function renderMetrics(metrics) {
  dom.metrics.innerHTML = metricItems(metrics).map(([label, value, icon, tone]) => metricHtml(label, value, icon, tone)).join("");
}

function renderHealthStrip(metrics, queue = []) {
  if (!dom.healthStrip) return;
  const onlineRatio = metrics.totalDevices ? metrics.onlineDevices / metrics.totalDevices : 0;
  const blocked = metrics.waitingReplies + metrics.waitingApprovals + metrics.agentDrafts + metrics.failedCommands;
  const oldestAttention = queue
    .filter((item) => ["waiting_approval", "waiting_reply", "failed"].includes(item.status))
    .map((item) => Math.max(0, Math.round((Date.now() - toMillis(item.at)) / 60_000)))
    .sort((a, b) => b - a)[0] || 0;
  const penalty = metrics.failedCommands * 24 + metrics.waitingApprovals * 12 + metrics.waitingReplies * 7 + Math.max(0, metrics.totalDevices - metrics.onlineDevices) * 10 + Math.min(oldestAttention, 60) * 0.35;
  const score = clamp(Math.round(onlineRatio * 100 - penalty), 0, 100);
  const tone = metrics.failedCommands > 0 || oldestAttention >= 30
    ? "red"
    : metrics.waitingApprovals > 0 || oldestAttention >= 15
      ? "orange"
      : blocked > 0 || onlineRatio < 1
        ? "yellow"
        : "green";
  const label = tone === "red" ? "需要立即处理" : tone === "orange" ? "审批积压" : tone === "yellow" ? "轻微阻塞" : "运行稳定";
  dom.healthStrip.className = `fleet-health-strip ${tone}`;
  dom.healthStrip.innerHTML = `
    <span>${escapeHtml(label)} · 在线 ${escapeHtml(`${metrics.onlineDevices}/${metrics.totalDevices}`)} · 待处理 ${escapeHtml(blocked)} · 最久 ${escapeHtml(oldestAttention ? `${oldestAttention}m` : "0m")}</span>
    <i style="--health-width: ${score}%"></i>
  `;
}

function metricHtml(label, value, icon, tone, loading = false) {
  return `
    <article class="fleet-metric ${tone} ${loading ? "loading" : ""}">
      <span class="fleet-metric-icon">${escapeHtml(icon)}</span>
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </article>
  `;
}

function renderFilters() {
  const counts = state.view.devices.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc.all += 1;
    return acc;
  }, { all: 0, online: 0, busy: 0, offline: 0 });
  dom.deviceFilters.innerHTML = DEVICE_FILTERS.map(([key, label]) => `
    <button class="${state.deviceFilter === key ? "active" : ""}" data-device-filter="${key}" type="button">
      ${escapeHtml(label)} <strong>${counts[key] || 0}</strong>
    </button>
  `).join("");
}

function renderDevices(devices) {
  const filtered = devices.filter((device) => state.deviceFilter === "all" || device.status === state.deviceFilter);
  dom.nodeCount.textContent = `${devices.filter((device) => device.sourceStatus === "online").length}/${devices.length}`;
  dom.devices.innerHTML = filtered.length ? filtered.map((device) => {
    const label = device.status === "busy" ? "忙碌" : device.status === "offline" ? "离线" : "在线";
    return `
      <article class="fleet-device ${device.status}" data-node-id="${escapeHtml(device.id)}">
        <div class="fleet-device-icon">${escapeHtml(device.icon)}</div>
        <div class="fleet-device-main">
          <div class="fleet-device-head">
            <strong>${escapeHtml(device.name)}</strong>
            <span><i></i>${label}</span>
          </div>
          <div class="fleet-device-stats">
            <span>运行 <strong>${device.running}</strong></span>
            <span>待 <strong>${device.pending}</strong></span>
            <span>心跳 <strong>${timeAgo(device.heartbeat)}</strong></span>
          </div>
          ${meterHtml("CPU", device.cpu, device.status)}
          ${meterHtml("内存", device.memory, device.status)}
        </div>
      </article>
    `;
  }).join("") : `<div class="fleet-empty">当前筛选下没有设备。</div>`;
}

function meterHtml(label, value, status) {
  return `
    <div class="fleet-meter ${status}">
      <span>${label}</span>
      <div><i style="width: ${clamp(Number(value) || 0, 0, 100)}%"></i></div>
      <em>${Math.round(Number(value) || 0)}%</em>
    </div>
  `;
}

function renderThreads(threads) {
  const display = threads.filter((thread) => thread.status !== "archived").slice(0, viewportProfile().threadLimit);
  dom.threads.innerHTML = display.length ? display.map((thread) => threadCardHtml(thread)).join("") : `
    <div class="fleet-empty hero-empty">
      <strong>暂无运行中的 Codex 线程</strong>
      <span>等待设备同步或启动新的 Codex 会话。</span>
    </div>
  `;
}

function threadCardHtml(thread) {
  const status = STATUS[thread.status] || STATUS.idle;
  return `
    <article class="fleet-thread-card ${status.tone}" data-open-thread="${escapeHtml(thread.nodeId)}::${escapeHtml(thread.id)}">
      <div class="fleet-thread-top">
        <span>${escapeHtml(thread.repo)}</span>
        <strong>${timeAgo(threadUpdatedAt(thread))}</strong>
      </div>
      <h3>${escapeHtml(thread.titleText)}</h3>
      <div class="fleet-thread-meta">
        <span>▣ ${escapeHtml(thread.nodeName)}</span>
        ${badgeHtml(status.text, status.tone)}
        <span>${durationLabel(thread)}</span>
      </div>
      <p>${escapeHtml(thread.draft?.text || thread.summaryText)}</p>
      <div class="fleet-thread-cwd">${escapeHtml(thread.cwd || thread.source || thread.provider || "codex")}</div>
      ${sparklineSvg(thread.sparkline, status.tone)}
      <div class="fleet-card-actions">
        ${threadActions(thread).map((action) => `
          <button class="fleet-mini-button ${action.primary ? status.tone : ""}" data-thread-action="${action.key}" data-node-id="${escapeHtml(thread.nodeId)}" data-thread-id="${escapeHtml(thread.id)}" type="button">
            ${escapeHtml(action.label)}
          </button>
        `).join("")}
      </div>
    </article>
  `;
}

function durationLabel(thread) {
  const start = toMillis(thread.createdAt);
  const end = toMillis(threadUpdatedAt(thread)) || Date.now();
  if (!start) return "已同步";
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function badgeHtml(text, tone) {
  return `<span class="fleet-badge ${tone}">${escapeHtml(text)}</span>`;
}

function riskBadge(risk) {
  const item = RISK[risk] || RISK.low;
  return badgeHtml(item.text, item.tone);
}

function threadActions(thread) {
  if (thread.status === "waiting_approval") return [
    { key: "details", label: "详情" },
    { key: "approve", label: "审批", primary: true },
    { key: "agent", label: "交给 Agent" },
    { key: "reject", label: "拒绝" },
  ];
  if (thread.status === "waiting_reply") return [
    { key: "details", label: "详情" },
    { key: "reply", label: "回复", primary: true },
    { key: "agent", label: "交给 Agent" },
  ];
  if (thread.status === "agent_draft") return [
    { key: "details", label: "详情" },
    { key: "draft", label: "查看草稿", primary: true },
    { key: "approve", label: "批准" },
  ];
  if (thread.status === "failed") return [
    { key: "details", label: "详情" },
    { key: "retry", label: "重试", primary: true },
    { key: "logs", label: "日志" },
  ];
  if (thread.status === "completed_unread") return [
    { key: "details", label: "详情" },
    { key: "mark_read", label: "标记已读", primary: true },
  ];
  return [
    { key: "details", label: "详情" },
    { key: "reply", label: "回复" },
    { key: "agent", label: "交给 Agent" },
  ];
}

function renderQueue(queue) {
  dom.queueCount.textContent = `共 ${queue.length} 项`;
  dom.queue.innerHTML = queue.length ? queue.slice(0, viewportProfile().queueLimit).map((item) => `
    <article class="fleet-queue-item ${RISK[item.risk]?.tone || "green"} ${attentionAgeClass(item)}" data-open-thread="${escapeHtml(item.nodeId)}::${escapeHtml(item.threadId)}">
      <div class="fleet-queue-head">
        ${badgeHtml(item.type, STATUS[item.status]?.tone || "slate")}
        ${riskBadge(item.risk)}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>来自 线程 #${escapeHtml(shortId(item.threadId))} · ${escapeHtml(item.repo)} · ${escapeHtml(item.nodeName)}</p>
      <span>${escapeHtml(item.summary)}</span>
      ${attentionAgeLabel(item)}
      <div class="fleet-card-actions">
        ${queueActions(item).map((action) => `
          <button class="fleet-mini-button ${action.primary ? RISK[item.risk]?.tone || "" : ""}" data-thread-action="${action.key}" data-node-id="${escapeHtml(item.nodeId)}" data-thread-id="${escapeHtml(item.threadId)}" type="button">
            ${escapeHtml(action.label)}
          </button>
        `).join("")}
      </div>
    </article>
  `).join("") : `
    <div class="fleet-empty">
      <strong>当前没有需要人工处理的事项</strong>
      <span>Agent 和 Codex 正在正常运行。</span>
    </div>
  `;
}

function queueActions(item) {
  if (item.status === "waiting_approval") return [
    { key: "approve", label: "批准并发送", primary: true },
    { key: "agent", label: "交给 Agent" },
    { key: "reply", label: "编辑" },
    { key: "reject", label: "拒绝" },
  ];
  if (item.status === "waiting_reply") return [
    { key: "reply", label: "回复", primary: true },
    { key: "agent", label: "交给 Agent" },
    { key: "takeover", label: "跳过" },
  ];
  if (item.status === "agent_draft") return [
    { key: "draft", label: "查看草稿", primary: true },
    { key: "reply", label: "编辑" },
    { key: "takeover", label: "接管" },
  ];
  if (item.status === "failed") return [
    { key: "retry", label: "重试", primary: true },
    { key: "logs", label: "查看日志" },
    { key: "takeover", label: "接管" },
  ];
  return [
    { key: "details", label: "快速查看", primary: true },
    { key: "mark_read", label: "标记已读" },
  ];
}

function attentionAgeMinutes(item) {
  const at = toMillis(item?.at);
  return at ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : 0;
}

function attentionAgeClass(item) {
  if (!["waiting_approval", "waiting_reply", "failed"].includes(item.status)) return "";
  const minutes = attentionAgeMinutes(item);
  if (minutes >= 30) return "escalated";
  if (minutes >= 15) return "aging";
  return "";
}

function attentionAgeLabel(item) {
  const minutes = attentionAgeMinutes(item);
  if (minutes < 15 || !["waiting_approval", "waiting_reply", "failed"].includes(item.status)) return "";
  const label = minutes >= 30 ? "超时升级" : "等待偏久";
  return `<strong class="fleet-age-chip">${escapeHtml(label)} · ${escapeHtml(minutes)}m</strong>`;
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 6 ? text.slice(0, 6) : text || "-";
}

function renderEvents(events) {
  dom.events.innerHTML = events.length ? events.slice(0, viewportProfile().eventLimit).map((event) => `
    <article class="fleet-event ${event.tone || "blue"}">
      <time>${clock(event.ts)}</time>
      <i></i>
      <div>
        <strong>${escapeHtml(event.type)}</strong>
        <span>${escapeHtml(event.detail || event.title)}</span>
      </div>
    </article>
  `).join("") : `<div class="fleet-empty">暂无事件。</div>`;
  if (dom.autoScroll.checked) {
    dom.events.scrollLeft = 0;
  }
}

function openThread(nodeId, threadId, intent = "details") {
  const node = (state.dashboard?.nodes || []).find((item) => item.id === nodeId);
  const thread = state.view?.threads.find((item) => item.nodeId === nodeId && item.id === threadId) ||
    (node?.threads || []).find((item) => item.id === threadId);
  if (!node || !thread) {
    showToast("没有找到对应线程");
    return;
  }
  const normalized = thread.nodeId ? thread : normalizeDashboard({ nodes: [node], totals: {} }).threads.find((item) => item.id === threadId);
  state.selected = { nodeId, threadId, intent };
  state.mobileEditing = false;
  renderModal(node, normalized, intent);
  dom.modal.classList.remove("hidden");
}

function renderModal(node, thread, intent) {
  const status = STATUS[thread.status] || STATUS.idle;
  const draft = thread.draft || state.agentDrafts.get(thread.nodeIdThreadId);
  const contextBundle = draft?.contextBundle || null;
  const draftState = draft ? proposalState(draft, thread) : null;
  const replyReadonly = Boolean(draft && isMobileViewport() && !state.mobileEditing);
  const defaultText = draft?.text || state.replyDrafts.get(thread.nodeIdThreadId) || defaultReply(thread, intent);
  dom.modalMeta.textContent = `${thread.repo} · ${thread.nodeName} · ${status.text}`;
  dom.modalTitle.textContent = intentTitle(intent);
  dom.modalBody.innerHTML = `
    <aside class="fleet-modal-context">
      <dl>
        <div><dt>项目 / 仓库</dt><dd>${escapeHtml(thread.repo)}</dd></div>
        <div><dt>线程标题</dt><dd>${escapeHtml(thread.titleText)}</dd></div>
        <div><dt>所在节点</dt><dd>${escapeHtml(thread.nodeName)}</dd></div>
        <div><dt>当前状态</dt><dd>${badgeHtml(status.text, status.tone)}</dd></div>
        <div><dt>风险等级</dt><dd>${riskBadge(thread.risk)}</dd></div>
        <div><dt>已运行时间</dt><dd>${escapeHtml(durationLabel(thread))}</dd></div>
        <div><dt>cwd</dt><dd>${escapeHtml(thread.cwd || thread.source || "-")}</dd></div>
      </dl>
      ${thread.status === "completed_unread" ? `
        <button class="fleet-button ghost" data-thread-action="mark_read" data-node-id="${escapeHtml(thread.nodeId)}" data-thread-id="${escapeHtml(thread.id)}" type="button">标记已读</button>
      ` : ""}
    </aside>
    <section class="fleet-modal-main">
      <div class="fleet-modal-card">
        <div class="fleet-section-head compact">
          <div>
            <p class="fleet-kicker">Latest Codex message</p>
            <h3>Codex 最新消息</h3>
          </div>
          ${badgeHtml(queueType(thread.status), status.tone)}
        </div>
        <p>${escapeHtml(thread.summaryText)}</p>
      </div>
      ${draft ? `
        <div class="fleet-modal-card proposal">
          <div class="fleet-section-head compact">
            <div>
              <p class="fleet-kicker">Agent proposal</p>
              <h3>Agent 草稿</h3>
            </div>
            <div class="fleet-proposal-chips">
              ${riskBadge(draft.risk)}
              ${draftState.expired ? badgeHtml("已过期", "red") : badgeHtml(draftState.timeLeftLabel, draftState.timeLeftTone)}
              ${draftState.stale ? badgeHtml("上下文已更新", "orange") : ""}
            </div>
          </div>
          ${proposalWarningsHtml(draftState)}
          <p>${escapeHtml(draft.text)}</p>
          <span>${escapeHtml(draft.rationale)}</span>
          ${riskReasonsHtml(draftState.riskReasons)}
          ${contextBundle ? renderCompressedContext(contextBundle) : ""}
        </div>
      ` : ""}
      <label class="fleet-reply-box ${replyReadonly ? "readonly" : ""}">
        <span>
          用户回复 / 可编辑草稿
          ${draft && isMobileViewport() ? `<button class="fleet-inline-edit" data-modal-action="edit_reply" type="button">${replyReadonly ? "编辑" : "正在编辑"}</button>` : ""}
        </span>
        <textarea id="fleetReplyText" maxlength="1200" placeholder="输入要发送给对应 Codex 线程的内容" ${replyReadonly ? "readonly" : ""}>${escapeHtml(defaultText)}</textarea>
        <em><strong id="fleetReplyCount">${escapeHtml(defaultText.length)}</strong>/1200</em>
      </label>
      <div class="fleet-policy">
        <strong>当前 Agent 边界</strong>
        <span>允许：reply、refresh、agent_draft、interrupt</span>
        <span>禁止：deploy、git push、delete、secret access、database mutation</span>
        <span>${thread.risk === "high" ? "高风险动作必须二次确认，且由人类最终批准。" : "低/中风险仍由人类点击后才下发到 CodexHub 队列。"}</span>
      </div>
      <div class="fleet-modal-actions">
        <button class="fleet-button primary" data-modal-action="approve" type="button">批准并继续</button>
        <button class="fleet-button ghost" data-modal-action="send" type="button">编辑后发送</button>
        <button class="fleet-button danger" data-modal-action="reject" type="button">拒绝</button>
        <button class="fleet-button ghost" data-modal-action="takeover" type="button">人工接管</button>
      </div>
    </section>
  `;
  document.querySelector("#fleetReplyText")?.addEventListener("input", (event) => {
    state.replyDrafts.set(thread.nodeIdThreadId, event.target.value);
    const counter = document.querySelector("#fleetReplyCount");
    if (counter) counter.textContent = String(event.target.value.length);
  });
}

function proposalState(draft, thread) {
  const expiresAt = toMillis(draft?.expiresAt);
  const sourceAt = toMillis(draft?.sourceUpdatedAt);
  const currentAt = toMillis(threadUpdatedAt(thread));
  const remainingMs = expiresAt ? expiresAt - Date.now() : 0;
  const riskReasons = riskReasonsForDraft(draft, thread);
  return {
    expired: Boolean(expiresAt && remainingMs <= 0),
    stale: Boolean(sourceAt && currentAt && currentAt > sourceAt + 1500),
    timeLeftLabel: expiresAt ? `${Math.max(0, Math.ceil(remainingMs / 60_000))}m 后过期` : "无过期时间",
    timeLeftTone: expiresAt && remainingMs <= 5 * 60_000 ? "orange" : "slate",
    riskReasons,
  };
}

function riskReasonsForDraft(draft, thread) {
  const reasons = new Set((draft?.contextBundle?.riskFlags || []).filter(Boolean));
  const haystack = `${draft?.text || ""} ${draft?.rationale || ""} ${thread.titleText || ""} ${thread.summaryText || ""} ${thread.cwd || ""}`.toLowerCase();
  for (const [needle, label] of RISK_KEYWORDS) {
    if (haystack.includes(needle.toLowerCase())) reasons.add(label);
  }
  if (!reasons.size && (draft?.risk === "high" || thread.risk === "high")) reasons.add("高风险");
  return [...reasons].slice(0, 8);
}

function proposalWarningsHtml(draftState) {
  const warnings = [];
  if (draftState.expired) warnings.push("这个草稿已经过期，批准前需要重新生成。");
  if (draftState.stale) warnings.push("线程在草稿生成后发生过更新，当前草稿可能基于旧上下文。");
  if (!warnings.length) return "";
  return `
    <div class="fleet-proposal-warning">
      ${warnings.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function riskReasonsHtml(reasons = []) {
  if (!reasons.length) return `<div class="fleet-risk-reasons"><span>风险原因</span><ul><li>未发现明显高风险信号</li></ul></div>`;
  return `
    <div class="fleet-risk-reasons">
      <span>风险原因</span>
      <ul>
        ${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderCompressedContext(bundle) {
  const contextItems = [
    ["压缩模型", bundle.summaryModel || "-"],
    ["签名", bundle.contextSignature || "-"],
    ["状态", STATUS[bundle.status]?.text || bundle.status || "-"],
    ["目标", bundle.userGoal || bundle.contextSummary || "-"],
  ];
  return `
    <div class="fleet-context-bundle">
      <strong>压缩上下文</strong>
      <dl>
        ${contextItems.map(([label, value]) => `
          <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
        `).join("")}
      </dl>
      ${contextList("待确认", bundle.blockers)}
      ${contextList("已提到文件", bundle.filesMentioned)}
      ${contextList("已运行命令", bundle.commandsRun)}
    </div>
  `;
}

function contextList(label, items = []) {
  const values = Array.isArray(items) ? items.filter(Boolean).slice(0, 4) : [];
  if (!values.length) return "";
  return `
    <div class="fleet-context-list">
      <span>${escapeHtml(label)}</span>
      <ul>
        ${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function intentTitle(intent) {
  return {
    approve: "审批与回复",
    reject: "拒绝请求",
    reply: "回复 Codex",
    agent: "Agent 草稿",
    draft: "查看 Agent 草稿",
    retry: "重试失败命令",
    logs: "线程日志",
    takeover: "人工接管",
  }[intent] || "审批与回复";
}

function defaultReply(thread, intent) {
  if (intent === "approve") return "批准，请继续。执行前再次确认风险边界，避免部署、删除、推送或访问密钥。";
  if (intent === "reject") return "拒绝本次操作，请改用低风险方案继续，并说明需要人工确认的部分。";
  if (intent === "retry") return "请重新刷新状态并重试刚才失败的动作。";
  if (thread.status === "waiting_reply") return "请继续，优先给出最小可验证实现，并说明下一步需要我确认的点。";
  return "";
}

function shouldConfirmApproval(thread, draft, draftState) {
  return Boolean(
    thread.risk === "high" ||
    draft?.risk === "high" ||
    draft?.risk === "medium" ||
    isMobileViewport() ||
    (draftState?.riskReasons || []).length > 0,
  );
}

function approvalConfirmMessage(thread, draftState) {
  const reasons = draftState?.riskReasons?.length ? `\n风险原因：${draftState.riskReasons.join("、")}` : "";
  return `请确认你已经阅读 Codex 请求内容、Agent 草稿和策略边界。确认后系统会把当前文本发送给对应 Codex 线程。${reasons}\n\n禁止直接批准 deploy、git push、delete、secret access、database mutation。`;
}

function proposalActionMetadata(draft, decision) {
  if (!draft?.proposalId) return {};
  return {
    proposalId: draft.proposalId,
    proposalDecision: decision,
    proposalRisk: draft.risk || "",
    proposalContextSignature: draft.contextSignature || draft.contextBundle?.contextSignature || "",
  };
}

async function handleModalAction(action) {
  const selected = state.selected;
  if (!selected) return;
  const thread = state.view?.threads.find((item) => item.nodeId === selected.nodeId && item.id === selected.threadId);
  if (!thread) return;
  if (action === "edit_reply") {
    state.mobileEditing = true;
    renderModal((state.dashboard?.nodes || []).find((item) => item.id === thread.nodeId), thread, selected.intent);
    return;
  }
  const draft = thread.draft || state.agentDrafts.get(thread.nodeIdThreadId);
  const draftState = draft ? proposalState(draft, thread) : null;
  const text = document.querySelector("#fleetReplyText")?.value?.trim() || defaultReply(thread, action);
  if (action === "approve" && draftState?.expired) {
    showToast("Agent 草稿已过期，请重新生成后再批准");
    return;
  }
  if (action === "approve" && draftState?.stale) {
    showToast("线程上下文已更新，请重新生成 Agent 草稿");
    return;
  }
  if (action === "approve" && shouldConfirmApproval(thread, draft, draftState)) {
    const ok = confirm(approvalConfirmMessage(thread, draftState));
    if (!ok) return;
  }
  if (action === "takeover") {
    await queueAction(thread.nodeId, {
      kind: "interrupt",
      provider: thread.provider || "codex",
      threadId: thread.id,
      ...proposalActionMetadata(draft, "interrupted"),
    });
  } else if (action === "reject") {
    await queueAction(thread.nodeId, {
      kind: "sendMessage",
      provider: thread.provider || "codex",
      threadId: thread.id,
      text: text || "拒绝本次操作，请停止当前高风险动作。",
      ...proposalActionMetadata(draft, "rejected"),
    });
  } else {
    if (!text) {
      showToast("请输入要发送的内容");
      return;
    }
    await queueAction(thread.nodeId, {
      kind: "sendMessage",
      provider: thread.provider || "codex",
      threadId: thread.id,
      text,
      ...proposalActionMetadata(draft, action === "approve" ? "approved" : "sent"),
    });
    state.agentDrafts.delete(thread.nodeIdThreadId);
    state.replyDrafts.delete(thread.nodeIdThreadId);
  }
  closeModal();
}

async function generateAgentDraft(nodeId, threadId) {
  const thread = state.view?.threads.find((item) => item.nodeId === nodeId && item.id === threadId);
  if (!thread) return;
  showToast("正在生成 Agent 草稿");
  if (!state.mockMode) {
    try {
      const payload = await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/threads/${encodeURIComponent(threadId)}/agent-draft`, {
        method: "POST",
        body: JSON.stringify({
          intent: thread.status === "waiting_approval" ? "approve" : "reply",
          kind: "reply",
        }),
      });
      if (!payload.proposal) throw new Error("Agent proposal missing");
      state.agentDrafts.set(thread.nodeIdThreadId, {
        ...payload.proposal,
        contextBundle: payload.contextBundle || null,
        sourceUpdatedAt: threadUpdatedAt(thread),
      });
      showToast("Agent 草稿已生成，等待人工批准");
      await loadState();
      openThread(nodeId, threadId, "draft");
      return;
    } catch (error) {
      showToast(`Agent 草稿生成失败：${error.message}`);
      return;
    }
  }
  const risk = thread.risk === "high" ? "medium" : thread.risk;
  const text = thread.status === "waiting_approval"
    ? "建议先要求 Codex 输出变更计划、影响范围和回滚方式；生产、删除、推送、密钥相关动作不直接批准。"
    : `请继续处理「${thread.titleText}」。优先给出最小可验证改动，完成后汇报修改文件、验证命令和剩余风险。`;
  state.agentDrafts.set(thread.nodeIdThreadId, {
    proposalId: `proposal-${hashValue(thread.nodeIdThreadId)}`,
    threadId,
    nodeId,
    kind: "reply",
    text,
    risk,
    confidence: 0.82,
    rationale: "基于当前线程状态生成，仅作为人工批准前的草稿，不会自动下发。",
    boundaries: ["不部署", "不推送", "不删除", "不访问密钥"],
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    sourceUpdatedAt: threadUpdatedAt(thread),
    contextBundle: {
      threadId,
      nodeId,
      status: thread.status,
      userGoal: thread.titleText,
      blockers: thread.status === "waiting_approval" ? ["Codex 正在等待审批。"] : [],
      filesMentioned: [],
      commandsRun: [],
      summaryModel: "codexhub-mock-extractive-v1",
      contextSignature: String(hashValue(thread.nodeIdThreadId)),
    },
    createdAt: new Date().toISOString(),
  });
  showToast("Agent 草稿已生成，等待人工批准");
  render();
  openThread(nodeId, threadId, "draft");
}

async function queueAction(nodeId, action) {
  if (state.mockMode) {
    state.liveEvents.unshift({
      id: `mock-action:${Date.now()}`,
      ts: new Date().toISOString(),
      type: "command queued",
      title: action.kind,
      detail: `${nodeId} · ${action.threadId || "node"} · ${action.kind}`,
      tone: action.kind === "interrupt" ? "red" : "cyan",
    });
    showToast("预览模式：动作已加入本地事件流");
    render();
    return;
  }
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
  showToast("已下发到 CodexHub 桌面端队列");
  await loadState();
}

async function markThreadRead(nodeId, threadId) {
  if (state.mockMode) {
    showToast("预览模式：已标记");
    return;
  }
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/notifications/read`, {
    method: "POST",
    body: JSON.stringify({ threadId }),
  });
  showToast("已标记为已读");
  await loadState();
}

async function requestRefresh() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  dom.refreshBtn.disabled = true;
  if (state.mockMode) {
    state.dashboard.generatedAt = new Date().toISOString();
    showToast("预览数据已刷新");
    render();
    state.refreshInFlight = false;
    dom.refreshBtn.disabled = false;
    return;
  }
  try {
    const nodes = (state.dashboard?.nodes || []).filter((node) => node.status === "online");
    const results = await Promise.allSettled(nodes.map((node) =>
      apiFetch(`/api/nodes/${encodeURIComponent(node.id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ kind: "refresh", provider: "codex" }),
      }),
    ));
    showToast(`已请求 ${results.filter((item) => item.status === "fulfilled").length} 台设备刷新`);
    await loadState();
  } catch (error) {
    showToast(`刷新请求失败：${error.message}`);
  } finally {
    state.refreshInFlight = false;
    dom.refreshBtn.disabled = false;
  }
}

function closeModal() {
  dom.modal.classList.add("hidden");
  state.selected = null;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.add("hidden"), 2600);
}

function scheduleResponsiveRender() {
  clearTimeout(scheduleResponsiveRender.timer);
  scheduleResponsiveRender.timer = setTimeout(() => {
    const nextTier = viewportTier();
    if (nextTier !== state.viewportTier) {
      state.viewportTier = nextTier;
      render();
      return;
    }
    renderChrome();
  }, 120);
}

async function loadState() {
  if (!isConfigured()) {
    render();
    return;
  }
  if (state.mockMode) {
    state.dashboard = mockDashboard();
    state.lastError = "";
    render();
    return;
  }
  try {
    state.dashboard = await apiFetch("/api/state");
    state.lastError = "";
    render();
    connectEvents();
  } catch (error) {
    state.lastError = error.message;
    render();
  }
}

function connectEvents() {
  if (state.eventSource || state.mockMode) return;
  state.eventSource = new EventSource(`${apiUrl("/api/events")}?token=${encodeURIComponent(state.config.token)}`);
  state.eventSource.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      state.lastError = "实时事件格式异常，轮询中";
      renderChrome();
      return;
    }
    if (payload.type === "state" && payload.state) {
      state.dashboard = payload.state;
      state.lastError = "";
      render();
      return;
    }
    if (payload.type === "agentProposalCreated" && payload.nodeId && payload.threadId && payload.proposal) {
      const key = `${payload.nodeId}::${payload.threadId}`;
      const thread = state.view?.threads.find((item) => item.nodeIdThreadId === key);
      state.agentDrafts.set(key, {
        ...payload.proposal,
        contextBundle: payload.contextBundle || payload.proposal.contextBundle || null,
        sourceUpdatedAt: thread ? threadUpdatedAt(thread) : payload.proposal.createdAt,
      });
    }
    state.liveEvents.unshift({
      id: `live:${Date.now()}:${payload.type}`,
      ts: new Date().toISOString(),
      type: eventLabel(payload.type),
      title: payload.type,
      detail: payload.nodeId ? `${payload.nodeId}` : "CodexHub 实时事件",
      tone: payload.type?.includes("failed") ? "red" : "cyan",
    });
    state.liveEvents = state.liveEvents.slice(0, 20);
    render();
  };
  state.eventSource.onerror = () => {
    state.eventSource?.close();
    state.eventSource = null;
    state.lastError = "实时连接断开，轮询中";
    render();
  };
}

function eventLabel(type) {
  return {
    state: "sync completed",
    commandQueued: "command queued",
    commandResult: "command completed",
    nodeEnrolled: "node online",
    agentProposalCreated: "agent proposal",
    audit: "audit event",
  }[type] || type || "event";
}

function applyLayoutControls() {
  state.viewportTier = viewportTier();
  state.density = dom.density?.value || state.density;
  state.columns = dom.columns?.value || state.columns;
  dom.app.dataset.density = state.density;
  dom.app.dataset.viewport = state.viewportTier;
  if (state.columns === "auto") {
    dom.app.style.removeProperty("--fleet-columns");
  } else {
    dom.app.style.setProperty("--fleet-columns", `repeat(${Number(state.columns)}, minmax(0, 1fr))`);
  }
}

function handleThreadAction(action, nodeId, threadId) {
  if (action === "agent") {
    void generateAgentDraft(nodeId, threadId);
    return;
  }
  if (action === "retry") {
    queueAction(nodeId, { kind: "refresh", provider: "codex", threadId });
    return;
  }
  if (action === "mark_read") {
    markThreadRead(nodeId, threadId);
    return;
  }
  openThread(nodeId, threadId, action);
}

function installEventHandlers() {
  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.mockMode = false;
    saveConfig({
      server: dom.serverInput.value || window.location.origin,
      token: dom.tokenInput.value,
    });
    state.eventSource?.close();
    state.eventSource = null;
    await loadState();
  });

  dom.mockBtn.addEventListener("click", () => {
    state.mockMode = true;
    state.dashboard = mockDashboard();
    render();
  });

  dom.deviceFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-device-filter]");
    if (!button) return;
    state.deviceFilter = button.dataset.deviceFilter;
    render();
  });

  dom.density.addEventListener("change", render);
  dom.columns.addEventListener("change", render);
  dom.refreshBtn.addEventListener("click", requestRefresh);
  dom.modalClose.addEventListener("click", closeModal);

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-thread-action]");
    if (actionButton) {
      event.stopPropagation();
      handleThreadAction(actionButton.dataset.threadAction, actionButton.dataset.nodeId, actionButton.dataset.threadId);
      return;
    }
    const openTarget = event.target.closest("[data-open-thread]");
    if (openTarget) {
      const [nodeId, threadId] = openTarget.dataset.openThread.split("::");
      openThread(nodeId, threadId, "details");
    }
  });

  dom.modal.addEventListener("click", (event) => {
    if (event.target === dom.modal) closeModal();
    const button = event.target.closest("[data-modal-action]");
    if (button) handleModalAction(button.dataset.modalAction);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.modal.classList.contains("hidden")) {
      closeModal();
      return;
    }
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    const current = state.selected || firstQueueSelection();
    if (!current) return;
    const key = event.key.toLowerCase();
    if (key === "r") openThread(current.nodeId, current.threadId, "reply");
    if (key === "a") openThread(current.nodeId, current.threadId, "approve");
    if (key === "e") openThread(current.nodeId, current.threadId, "reply");
    if (key === "g") void generateAgentDraft(current.nodeId, current.threadId);
    if (key === "l") openThread(current.nodeId, current.threadId, "logs");
    if (key === "enter") openThread(current.nodeId, current.threadId, "details");
  });

  window.addEventListener("resize", scheduleResponsiveRender);
}

function firstQueueSelection() {
  const first = state.view?.queue?.[0];
  return first ? { nodeId: first.nodeId, threadId: first.threadId } : null;
}

function mockDashboard() {
  const nodes = [
    mockNode("TMT-01", "online", 2, "win32", [
      mockThread("874", "codex-web / portal", "实现用户登录态刷新逻辑", "running", "/apps/portal", 1120),
      mockThread("867", "codex-cli / runner", "优化命令执行超时策略", "agent_draft", "/packages/runner", 680),
    ]),
    mockNode("TMT-02", "online", 1, "win32", [
      mockThread("872", "codex-core / engine", "修复并发任务锁竞争问题", "running", "/services/engine", 1450),
      mockThread("871", "data-pipe / etl", "修复数据丢失边界条件", "running", "/etl/jobs", 1880),
      mockThread("875", "codex-core / engine", "部署脚本与健康检查", "agent_draft", "/tools/devops", 520),
    ]),
    mockNode("MBP-01", "online", 1, "darwin", [
      mockThread("861", "docs / architecture", "补充系统架构图与模块说明", "waiting_reply", "/docs/architecture", 545),
      mockThread("868", "codex-web / portal", "完善权限控制单元测试", "completed_unread", "/apps/portal", 192),
      mockThread("872-docs", "docs / api", "更新 API 变更日志", "waiting_reply", "/docs/api", 740),
    ]),
    mockNode("RTX-4090", "online", 2, "linux", [
      mockThread("873", "infra / k8s", "审查生产集群变更计划", "waiting_approval", "/infra/k8s", 392),
      mockThread("870", "payments / gateway", "修复支付回调重复入账", "failed", "/services/payments", 175),
    ]),
    mockNode("Mini-Server", "offline", 0, "linux", [
      mockThread("866", "scripts / maintenance", "清理过期临时文件脚本", "running", "/scripts/maintenance", 2530),
    ]),
  ];
  state.agentDrafts.set("TMT-01::867", {
    text: "建议将默认超时调整为 180s，并在超时后提供重试建议和清晰错误消息。",
    risk: "low",
    rationale: "只影响命令执行等待策略，不涉及部署或数据修改。",
    expiresAt: new Date(Date.now() + 26 * 60_000).toISOString(),
    sourceUpdatedAt: nowMinus(680),
  });
  state.agentDrafts.set("TMT-02::875", {
    text: "建议先增加健康检查 dry-run，再把部署步骤拆成可单独回滚的小命令。",
    risk: "medium",
    rationale: "部署相关内容需要人类确认后再继续。",
    expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    sourceUpdatedAt: nowMinus(520),
    contextBundle: {
      threadId: "875",
      nodeId: "TMT-02",
      status: "waiting_reply",
      userGoal: "部署脚本与健康检查",
      blockers: ["部署相关内容需要人类确认。"],
      riskFlags: ["部署"],
      filesMentioned: ["/tools/devops/healthcheck.sh"],
      commandsRun: ["npm run smoke"],
      summaryModel: "codexhub-mock-extractive-v1",
      contextSignature: String(hashValue("TMT-02::875")),
    },
  });
  return {
    ok: true,
    version: "mock",
    generatedAt: new Date().toISOString(),
    startedAt: nowMinus(7200),
    reports: {
      today: {
        updatedThreads: 43,
        completedThreads: 31,
        failedCommands: 2,
      },
    },
    totals: {
      nodes: nodes.length,
      online: 4,
      offline: 1,
      running: 5,
      waitingReply: 2,
      waitingApproval: 1,
      attention: 7,
      unread: 1,
      completedToday: 31,
      updatedToday: 43,
      failedCommands: 2,
    },
    nodes,
  };
}

function mockNode(name, status, pending, platform, threads) {
  return {
    id: name,
    name,
    status,
    host: { hostname: name, platform, arch: "x64" },
    tags: [platform, "codex"],
    lastSeenAt: status === "online" ? nowMinus(hashValue(name) % 5 + 1) : nowMinus(192),
    metrics: {
      totalThreads: threads.length,
      running: threads.filter((thread) => thread.isGenerating).length,
      waitingReply: threads.filter((thread) => thread.waitingOnUserInput).length,
      waitingApproval: threads.filter((thread) => thread.waitingOnApproval).length,
      attention: pending,
    },
    threads,
    notifications: threads.filter((thread) => ["completed_unread", "failed"].includes(thread.taskState)).map((thread) => ({
      id: `notice-${thread.id}`,
      type: thread.taskState === "failed" ? "commandFailed" : "completed",
      threadId: thread.id,
      title: thread.title,
      preview: thread.latestMessage,
      createdAt: thread.updatedAt,
      readAt: null,
    })),
    syncHealth: {
      unreadNotifications: pending,
      commandCounts: { queued: 0, leased: 0, failed: threads.filter((thread) => thread.taskState === "failed").length },
    },
    recentCommandResults: threads.filter((thread) => thread.taskState === "failed").map((thread) => ({
      id: `cmd-${thread.id}`,
      status: "failed",
      createdAt: thread.updatedAt,
      completedAt: thread.updatedAt,
      action: { kind: "sendMessage", provider: "codex", threadId: thread.id },
      result: { error: "脚本退出码 1，依赖服务超时。" },
    })),
  };
}

function mockThread(id, repo, title, status, cwd, ageSeconds) {
  const isGenerating = status === "running";
  return {
    id,
    provider: "codex",
    title,
    preview: `${title} 的当前执行摘要。`,
    cwd,
    source: repo,
    createdAt: nowMinus(ageSeconds + 860),
    updatedAt: nowMinus(ageSeconds),
    latestMessage: mockMessage(status, title),
    latestMessageAt: nowMinus(ageSeconds),
    latestProgressMessage: mockMessage(status, title),
    latestProgressMessageAt: nowMinus(ageSeconds),
    latestFinalMessage: ["completed_unread", "completed"].includes(status) ? `${title} 已完成，等待查看。` : null,
    latestFinalMessageAt: ["completed_unread", "completed"].includes(status) ? nowMinus(ageSeconds) : null,
    recentMessages: [
      { text: `已读取上下文：${repo}`, at: nowMinus(ageSeconds + 240), phase: "progress", role: "assistant" },
      { text: mockMessage(status, title), at: nowMinus(ageSeconds), phase: status === "completed_unread" ? "final_answer" : "progress", role: "assistant" },
    ],
    isGenerating,
    waitingOnApproval: status === "waiting_approval",
    waitingOnUserInput: status === "waiting_reply",
    taskState: status,
    taskStateLabel: STATUS[status]?.text || status,
    requiresAction: ["waiting_approval", "waiting_reply", "failed", "completed_unread"].includes(status),
  };
}

function mockMessage(status, title) {
  return {
    running: `已完成主要改动，正在接入验证路径：${title}`,
    waiting_reply: `需要你补充范围或确认下一步处理策略：${title}`,
    waiting_approval: `计划执行高风险变更，请确认影响范围和回滚方式：${title}`,
    agent_draft: `Agent 已生成 proposal 草稿，等待人工批准：${title}`,
    failed: `命令执行失败，脚本退出码 1，需要人工介入：${title}`,
    completed_unread: `任务已完成但尚未查看：${title}`,
  }[status] || `线程已同步：${title}`;
}

dom.density.value = state.density;
dom.columns.value = state.columns;
installEventHandlers();
await loadState();
setInterval(loadState, 30_000);
setInterval(renderChrome, 1000);
