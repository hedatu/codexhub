const STORAGE_KEY = "codexhub.config.v1";
const TV_LANGUAGE_KEY = "codexhub.tv.language.v1";
const params = new URLSearchParams(window.location.search);

const dom = {
  app: document.querySelector("#fleetApp"),
  login: document.querySelector("#tvLogin"),
  loginForm: document.querySelector("#fleetLoginForm"),
  content: document.querySelector("#tvContent"),
  commandDeck: document.querySelector("#fleetCommandDeck"),
  timeline: document.querySelector("#fleetTimeline"),
  serverInput: document.querySelector("#tvServerInput"),
  tokenInput: document.querySelector("#tvTokenInput"),
  saveBtn: document.querySelector("#tvSaveBtn"),
  mockBtn: document.querySelector("#fleetMockBtn"),
  language: document.querySelector("#fleetLanguage"),
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
  allowMock: params.get("mock") === "1" || params.get("dev") === "1",
  language: readLanguage(),
  liveEvents: [],
  selected: null,
  agentDrafts: new Map(),
  fullContexts: new Map(),
  proposalAudits: new Map(),
  replyDrafts: new Map(),
  updateStatus: null,
  opsLastCheckedAt: 0,
  operationMode: true,
  lastError: "",
  refreshInFlight: false,
  viewportTier: viewportTier(),
  mobileEditing: false,
};

const DEVICE_FILTERS = [
  ["all", "filters.all"],
  ["online", "filters.online"],
  ["busy", "filters.busy"],
  ["offline", "filters.offline"],
];

const STATUS = {
  running: { text: "运行中", textKey: "status.running", tone: "blue", rank: 5 },
  waiting_reply: { text: "等待回复", textKey: "status.waiting_reply", tone: "yellow", rank: 2 },
  waiting_approval: { text: "待审批", textKey: "status.waiting_approval", tone: "orange", rank: 1 },
  agent_draft: { text: "Agent 草稿", textKey: "status.agent_draft", tone: "purple", rank: 3 },
  failed: { text: "失败命令", textKey: "status.failed", tone: "red", rank: 4 },
  completed_unread: { text: "已完成未读", textKey: "status.completed_unread", tone: "green", rank: 6 },
  completed: { text: "已完成", textKey: "status.completed", tone: "green", rank: 7 },
  idle: { text: "已同步", textKey: "status.idle", tone: "slate", rank: 8 },
  archived: { text: "已读归档", textKey: "status.archived", tone: "slate", rank: 9 },
};

const RISK = {
  low: { text: "低风险", textKey: "risk.low", tone: "green" },
  medium: { text: "中风险", textKey: "risk.medium", tone: "yellow" },
  high: { text: "高风险", textKey: "risk.high", tone: "red" },
};

const TRANSLATIONS = {
  zh: {
    "brand.kicker": "多机 Codex 线程总控中心",
    "brand.title": "CodexHub 总控大屏",
    "login.kicker": "CodexHub 连接",
    "login.title": "连接控制台",
    "login.desc": "大屏页复用 CodexHub 访问令牌，与主控制台共用同一份节点、线程和命令队列数据。",
    "login.server": "服务器地址",
    "login.token": "访问令牌",
    "login.connect": "连接",
    "login.mock": "预览大屏",
    "sections.nodesKicker": "节点",
    "sections.nodes": "设备状态",
    "sections.threadsKicker": "线程墙",
    "sections.threads": "运行线程墙",
    "sections.queueKicker": "待处理队列",
    "sections.queue": "待处理与审批",
    "sections.eventsKicker": "实时事件",
    "sections.events": "实时事件流",
    "controls.density": "密度",
    "controls.columns": "列数",
    "controls.autoScroll": "自动滚动",
    "controls.refresh": "请求电脑重新采集",
    "command.title": "指挥操作台",
    "command.kicker": "控制",
    "command.priority": "优先处理",
    "command.priorityEmpty": "没有急件",
    "command.priorityDetail": "{type} · {node}",
    "command.sync": "本机链路",
    "command.syncOk": "全部正常",
    "command.syncWarn": "{count} 项注意",
    "command.syncBad": "{count} 项异常",
    "command.syncDetail": "在线 {online} · 待处理 {blocked} · 最久 {oldest}",
    "command.update": "版本更新",
    "command.updateAvailable": "发现 v{version}",
    "command.updateCurrent": "已是最新",
    "command.updateUnknown": "等待检查",
    "command.updateError": "检查失败",
    "command.lastCheck": "检查 {time}",
    "command.refreshAll": "重新采集",
    "command.openPending": "处理急件",
    "command.checkUpdate": "检查更新",
    "command.openHealth": "自检报告",
    "command.openConsole": "主控制台",
    "density.comfortable": "舒展",
    "density.compact": "紧凑",
    "density.dense": "高密",
    "columns.auto": "自动",
    "filters.all": "全部",
    "filters.online": "在线",
    "filters.busy": "忙碌",
    "filters.offline": "离线",
    "status.running": "运行中",
    "status.waiting_reply": "等待回复",
    "status.waiting_approval": "待审批",
    "status.agent_draft": "Agent 草稿",
    "status.failed": "失败命令",
    "status.completed_unread": "已完成未读",
    "status.completed": "已完成",
    "status.idle": "已同步",
    "status.archived": "已读归档",
    "risk.low": "低风险",
    "risk.medium": "中风险",
    "risk.high": "高风险",
    "metric.online": "在线电脑",
    "metric.running": "运行线程",
    "metric.reply": "待回复",
    "metric.approval": "待审批",
    "metric.draft": "Agent 草稿",
    "metric.failed": "失败命令",
    "metric.completed": "今日完成",
    "metric.sync": "最新同步",
    "health.waiting": "等待 CodexHub 同步",
    "health.red": "需要立即处理",
    "health.orange": "审批积压",
    "health.yellow": "轻微阻塞",
    "health.green": "运行稳定",
    "health.summary": "{label} · 在线 {online} · 待处理 {blocked} · 最久 {oldest}",
    "sync.mock": "预览数据",
    "sync.waiting": "等待同步",
    "sync.live": "实时 {time}",
    "sync.eventFormatError": "实时事件格式异常，轮询中",
    "sync.disconnected": "实时连接断开，轮询中",
    "device.online": "在线",
    "device.busy": "忙碌",
    "device.offline": "离线",
    "device.running": "运行",
    "device.pending": "待",
    "device.heartbeat": "心跳",
    "meter.cpu": "CPU",
    "meter.memory": "内存",
    "empty.devices": "当前筛选下没有设备。",
    "empty.threadsTitle": "暂无运行中的 Codex 线程",
    "empty.threadsDesc": "等待设备同步或启动新的 Codex 会话。",
    "empty.queueTitle": "当前没有需要人工处理的事项",
    "empty.queueDesc": "Agent 和 Codex 正在正常运行。",
    "empty.events": "暂无事件。",
    "loading.connecting": "正在连接 CodexHub。",
    "loading.queue": "等待状态同步。",
    "loading.events": "实时事件流准备中。",
    "queue.total": "共 {count} 项",
    "queue.from": "来自 线程 #{thread} · {repo} · {node}",
    "queue.waiting_approval": "待审批",
    "queue.waiting_reply": "等待回复",
    "queue.agent_draft": "Agent 草稿",
    "queue.failed": "失败命令",
    "queue.completed_unread": "完成未读",
    "queue.default": "待处理",
    "age.escalated": "超时升级",
    "age.aging": "等待偏久",
    "age.minutes": "{label} · {minutes}m",
    "actions.details": "详情",
    "actions.approve": "审批",
    "actions.approveSend": "批准并发送",
    "actions.agent": "交给 Agent",
    "actions.reject": "拒绝",
    "actions.reply": "回复",
    "actions.edit": "编辑",
    "actions.draft": "查看草稿",
    "actions.retry": "重试",
    "actions.logs": "日志",
    "actions.viewLogs": "查看日志",
    "actions.takeover": "接管",
    "actions.skip": "跳过",
    "actions.markRead": "标记已读",
    "actions.quickView": "快速查看",
    "modal.meta": "{repo} · {node} · {status}",
    "modal.latestKicker": "Codex 最新消息",
    "modal.latestTitle": "Codex 最新消息",
    "modal.sourceKicker": "同步来源",
    "modal.sourceTitle": "状态来源",
    "modal.project": "项目 / 仓库",
    "modal.threadTitle": "线程标题",
    "modal.node": "所在节点",
    "modal.status": "当前状态",
    "modal.risk": "风险等级",
    "modal.duration": "已运行时间",
    "modal.replyLabel": "用户回复 / 可编辑草稿",
    "modal.editing": "正在编辑",
    "modal.placeholder": "输入要发送给对应 Codex 线程的内容",
    "modal.boundaryTitle": "当前 Agent 边界",
    "modal.allowed": "允许：reply、refresh、agent_draft、interrupt",
    "modal.denied": "禁止：deploy、git push、delete、secret access、database mutation",
    "modal.highRisk": "高风险动作必须二次确认，且由人类最终批准。",
    "modal.normalRisk": "低/中风险仍由人类点击后才下发到 CodexHub 队列。",
    "modal.approveContinue": "批准并继续",
    "modal.sendEdited": "编辑后发送",
    "modal.manualTakeover": "人工接管",
    "modal.agentKicker": "Agent 草稿",
    "modal.agentTitle": "Agent 草稿",
    "modal.expired": "已过期",
    "modal.stale": "上下文已更新",
    "modal.noExpiry": "无过期时间",
    "modal.expires": "{minutes}m 后过期",
    "modal.warningExpired": "这个草稿已经过期，批准前需要重新生成。",
    "modal.warningStale": "线程在草稿生成后发生过更新，当前草稿可能基于旧上下文。",
    "intent.approve": "审批请求",
    "intent.reject": "拒绝请求",
    "intent.reply": "回复 Codex",
    "intent.agent": "Agent 草稿",
    "intent.draft": "查看 Agent 草稿",
    "intent.retry": "重试失败命令",
    "intent.takeover": "人工接管",
    "intent.details": "任务详情",
    "source.cloud": "最后心跳",
    "source.farfield": "Farfield",
    "source.codex": "Codex 会话",
    "source.commands": "命令回执",
    "source.notifications": "未读通知",
    "source.ok": "正常",
    "source.warning": "注意",
    "source.danger": "异常",
    "source.unknown": "未知",
    "event.threadCompleted": "线程完成",
    "event.commandFailed": "命令失败",
    "event.codexReplied": "Codex 回复",
    "event.threadUpdated": "线程更新",
    "event.syncCompleted": "全局状态同步完成",
    "event.syncDetail": "节点 {online}/{total}",
    "command.failedTitle": "桌面端命令发送失败",
    "command.failedSummary": "桌面端执行命令失败，请检查节点状态。",
    "toast.noThread": "没有找到对应线程",
    "toast.mockRefresh": "预览数据已刷新",
    "toast.noOnline": "没有在线电脑，已刷新云端缓存",
    "toast.refreshQueued": "已请求 {queued} 台电脑重新采集，等待桌面端回执",
    "toast.refreshFailedSome": "已请求 {queued} 台电脑重新采集，{failed} 台失败，等待其余设备回执",
    "toast.refreshFailed": "重新采集请求失败：{error}",
    "toast.updateAvailable": "发现可用更新：v{version}",
    "toast.updateCurrent": "已经是最新版本",
    "toast.updateFailed": "检查更新失败：{error}",
    "toast.markedRead": "已标记为已读",
    "toast.mockMarked": "预览模式：已标记",
    "toast.queued": "已下发到 CodexHub 桌面端队列",
    "toast.mockQueued": "预览模式：动作已加入本地事件流",
    "time.never": "从未",
    "time.now": "刚刚",
    "time.seconds": "{value} 秒前",
    "time.minutes": "{value} 分钟前",
    "time.hours": "{value} 小时前",
  },
  en: {
    "brand.kicker": "Multi-node Codex thread command center",
    "brand.title": "CodexHub Fleet Wall",
    "login.kicker": "CodexHub connection",
    "login.title": "Connect console",
    "login.desc": "The wall uses the same CodexHub token and shares node, thread, and command queue data with the main console.",
    "login.server": "Server URL",
    "login.token": "Access token",
    "login.connect": "Connect",
    "login.mock": "Preview wall",
    "sections.nodesKicker": "Nodes",
    "sections.nodes": "Device status",
    "sections.threadsKicker": "Thread wall",
    "sections.threads": "Running threads",
    "sections.queueKicker": "Decision queue",
    "sections.queue": "Pending and approvals",
    "sections.eventsKicker": "Live events",
    "sections.events": "Live event stream",
    "controls.density": "Density",
    "controls.columns": "Columns",
    "controls.autoScroll": "Auto scroll",
    "controls.refresh": "Request device rescan",
    "command.title": "Command Deck",
    "command.kicker": "Control",
    "command.priority": "Priority",
    "command.priorityEmpty": "No urgent items",
    "command.priorityDetail": "{type} · {node}",
    "command.sync": "Local link",
    "command.syncOk": "All healthy",
    "command.syncWarn": "{count} warnings",
    "command.syncBad": "{count} errors",
    "command.syncDetail": "online {online} · pending {blocked} · oldest {oldest}",
    "command.update": "Version",
    "command.updateAvailable": "v{version} available",
    "command.updateCurrent": "Up to date",
    "command.updateUnknown": "Waiting",
    "command.updateError": "Check failed",
    "command.lastCheck": "checked {time}",
    "command.refreshAll": "Rescan",
    "command.openPending": "Handle priority",
    "command.checkUpdate": "Check updates",
    "command.openHealth": "Health report",
    "command.openConsole": "Console",
    "density.comfortable": "Comfortable",
    "density.compact": "Compact",
    "density.dense": "Dense",
    "columns.auto": "Auto",
    "filters.all": "All",
    "filters.online": "Online",
    "filters.busy": "Busy",
    "filters.offline": "Offline",
    "status.running": "Running",
    "status.waiting_reply": "Waiting reply",
    "status.waiting_approval": "Needs approval",
    "status.agent_draft": "Agent draft",
    "status.failed": "Failed command",
    "status.completed_unread": "Completed unread",
    "status.completed": "Completed",
    "status.idle": "Synced",
    "status.archived": "Read archive",
    "risk.low": "Low risk",
    "risk.medium": "Medium risk",
    "risk.high": "High risk",
    "metric.online": "Online devices",
    "metric.running": "Running threads",
    "metric.reply": "Waiting replies",
    "metric.approval": "Approvals",
    "metric.draft": "Agent drafts",
    "metric.failed": "Failed commands",
    "metric.completed": "Completed today",
    "metric.sync": "Latest sync",
    "health.waiting": "Waiting for CodexHub sync",
    "health.red": "Needs attention",
    "health.orange": "Approval backlog",
    "health.yellow": "Minor blockers",
    "health.green": "Stable",
    "health.summary": "{label} · online {online} · pending {blocked} · oldest {oldest}",
    "sync.mock": "mock preview",
    "sync.waiting": "Waiting for sync",
    "sync.live": "live {time}",
    "sync.eventFormatError": "Malformed live event, polling",
    "sync.disconnected": "Live connection closed, polling",
    "device.online": "Online",
    "device.busy": "Busy",
    "device.offline": "Offline",
    "device.running": "Running",
    "device.pending": "Pending",
    "device.heartbeat": "Heartbeat",
    "meter.cpu": "CPU",
    "meter.memory": "Memory",
    "empty.devices": "No devices match this filter.",
    "empty.threadsTitle": "No running Codex threads",
    "empty.threadsDesc": "Waiting for device sync or a new Codex session.",
    "empty.queueTitle": "No items need human action",
    "empty.queueDesc": "Agent and Codex are running normally.",
    "empty.events": "No events yet.",
    "loading.connecting": "Connecting to CodexHub.",
    "loading.queue": "Waiting for state sync.",
    "loading.events": "Live event stream is ready.",
    "queue.total": "{count} items",
    "queue.from": "From thread #{thread} · {repo} · {node}",
    "queue.waiting_approval": "Needs approval",
    "queue.waiting_reply": "Waiting reply",
    "queue.agent_draft": "Agent draft",
    "queue.failed": "Failed command",
    "queue.completed_unread": "Completed unread",
    "queue.default": "Pending",
    "age.escalated": "Escalated",
    "age.aging": "Aging",
    "age.minutes": "{label} · {minutes}m",
    "actions.details": "Details",
    "actions.approve": "Approve",
    "actions.approveSend": "Approve and send",
    "actions.agent": "Ask Agent",
    "actions.reject": "Reject",
    "actions.reply": "Reply",
    "actions.edit": "Edit",
    "actions.draft": "View draft",
    "actions.retry": "Retry",
    "actions.logs": "Logs",
    "actions.viewLogs": "View logs",
    "actions.takeover": "Take over",
    "actions.skip": "Skip",
    "actions.markRead": "Mark read",
    "actions.quickView": "Quick view",
    "modal.meta": "{repo} · {node} · {status}",
    "modal.latestKicker": "Latest Codex message",
    "modal.latestTitle": "Latest Codex message",
    "modal.sourceKicker": "Sync source",
    "modal.sourceTitle": "State source",
    "modal.project": "Project / repo",
    "modal.threadTitle": "Thread title",
    "modal.node": "Node",
    "modal.status": "Current status",
    "modal.risk": "Risk level",
    "modal.duration": "Runtime",
    "modal.replyLabel": "User reply / editable draft",
    "modal.editing": "Editing",
    "modal.placeholder": "Type the message to send to this Codex thread",
    "modal.boundaryTitle": "Current Agent boundary",
    "modal.allowed": "Allowed: reply, refresh, agent_draft, interrupt",
    "modal.denied": "Blocked: deploy, git push, delete, secret access, database mutation",
    "modal.highRisk": "High-risk actions require a second confirmation and final human approval.",
    "modal.normalRisk": "Low/medium-risk actions are still queued only after a human click.",
    "modal.approveContinue": "Approve and continue",
    "modal.sendEdited": "Send edited",
    "modal.manualTakeover": "Manual takeover",
    "modal.agentKicker": "Agent proposal",
    "modal.agentTitle": "Agent draft",
    "modal.expired": "Expired",
    "modal.stale": "Context changed",
    "modal.noExpiry": "No expiry",
    "modal.expires": "expires in {minutes}m",
    "modal.warningExpired": "This draft has expired. Regenerate it before approving.",
    "modal.warningStale": "The thread changed after this draft was generated. It may be based on stale context.",
    "intent.approve": "Approve request",
    "intent.reject": "Reject request",
    "intent.reply": "Reply to Codex",
    "intent.agent": "Agent draft",
    "intent.draft": "View Agent draft",
    "intent.retry": "Retry failed command",
    "intent.takeover": "Manual takeover",
    "intent.details": "Task details",
    "source.cloud": "Heartbeat",
    "source.farfield": "Farfield",
    "source.codex": "Codex session",
    "source.commands": "Command receipt",
    "source.notifications": "Unread notices",
    "source.ok": "OK",
    "source.warning": "Warning",
    "source.danger": "Error",
    "source.unknown": "Unknown",
    "event.threadCompleted": "Thread completed",
    "event.commandFailed": "Command failed",
    "event.codexReplied": "Codex replied",
    "event.threadUpdated": "Thread updated",
    "event.syncCompleted": "Global state synced",
    "event.syncDetail": "Nodes {online}/{total}",
    "command.failedTitle": "Desktop command failed",
    "command.failedSummary": "The desktop agent failed to run the command. Check node status.",
    "toast.noThread": "Thread not found",
    "toast.mockRefresh": "Preview data refreshed",
    "toast.noOnline": "No online devices; cloud cache refreshed",
    "toast.refreshQueued": "Requested {queued} devices to rescan; waiting for desktop receipts",
    "toast.refreshFailedSome": "Requested {queued} devices to rescan, {failed} failed; waiting for remaining receipts",
    "toast.refreshFailed": "Rescan request failed: {error}",
    "toast.updateAvailable": "Update available: v{version}",
    "toast.updateCurrent": "Already up to date",
    "toast.updateFailed": "Update check failed: {error}",
    "toast.markedRead": "Marked as read",
    "toast.mockMarked": "Preview mode: marked",
    "toast.queued": "Queued for the CodexHub desktop agent",
    "toast.mockQueued": "Preview mode: action added to local events",
    "time.never": "Never",
    "time.now": "Just now",
    "time.seconds": "{value}s ago",
    "time.minutes": "{value}m ago",
    "time.hours": "{value}h ago",
  },
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
  if (!millis) return t("time.never");
  const seconds = Math.max(0, Math.round((Date.now() - millis) / 1000));
  if (seconds < 10) return t("time.now");
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(millis).toLocaleDateString();
}

function readLanguage() {
  const fromUrl = params.get("lang");
  const stored = localStorage.getItem(TV_LANGUAGE_KEY);
  return fromUrl === "en" || stored === "en" ? "en" : "zh";
}

function setLanguage(language) {
  state.language = language === "en" ? "en" : "zh";
  localStorage.setItem(TV_LANGUAGE_KEY, state.language);
  if (dom.language) dom.language.value = state.language;
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  document.title = t("brand.title");
  translateStaticDom();
}

function t(key, vars = {}, fallback = "") {
  const template = TRANSLATIONS[state.language]?.[key] ?? TRANSLATIONS.zh[key] ?? fallback ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function translateStaticDom() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n, {}, element.textContent);
  });
  if (dom.refreshBtn) {
    const label = t("controls.refresh");
    dom.refreshBtn.title = label;
    dom.refreshBtn.setAttribute("aria-label", label);
  }
  if (dom.modalClose) {
    const label = state.language === "en" ? "Close" : "关闭";
    dom.modalClose.title = label;
    dom.modalClose.setAttribute("aria-label", label);
  }
}

function statusText(statusKey) {
  const item = STATUS[statusKey];
  return item ? t(item.textKey, {}, item.text) : String(statusKey || "");
}

function riskText(riskKey) {
  const item = RISK[riskKey] || RISK.low;
  return t(item.textKey, {}, item.text);
}

function timeUntil(value) {
  const millis = toMillis(value);
  if (!millis) return "-";
  const seconds = Math.round((millis - Date.now()) / 1000);
  if (seconds <= 0) return t("modal.expired");
  if (seconds < 60) return state.language === "en" ? `in ${seconds}s` : `${seconds}s 后`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return state.language === "en" ? `in ${minutes}m` : `${minutes}m 后`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return state.language === "en" ? `in ${hours}h` : `${hours}h 后`;
  return new Date(millis).toLocaleDateString(state.language === "en" ? "en-US" : "zh-CN");
}

function clock(value) {
  const millis = toMillis(value) || Date.now();
  return new Date(millis).toLocaleTimeString(state.language === "en" ? "en-US" : "zh-CN", { hour12: false });
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
      nodeLastSeenAt: node.lastSeenAt,
      syncHealth: node.syncHealth || {},
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
      statusLabel: statusText(status),
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
      title: t("command.failedTitle"),
      summary: command.result?.error || command.result?.result?.error || t("command.failedSummary"),
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
    waiting_approval: t("queue.waiting_approval"),
    waiting_reply: t("queue.waiting_reply"),
    agent_draft: t("queue.agent_draft"),
    failed: t("queue.failed"),
    completed_unread: t("queue.completed_unread"),
  }[status] || t("queue.default");
}

function buildEvents(dashboard, nodes, threads, failedCommands) {
  const fromNotifications = nodes.flatMap((node) => (node.notifications || []).slice(-4).map((notice) => ({
    id: `notice:${notice.id}`,
    ts: notice.createdAt,
    type: notice.type === "completed" ? t("event.threadCompleted") : notice.type === "commandFailed" ? t("event.commandFailed") : t("event.codexReplied"),
    title: notice.title || t("event.threadUpdated"),
    detail: notice.preview || t("event.threadUpdated"),
    nodeName: node.name || node.id,
    threadId: notice.threadId,
    tone: notice.type === "commandFailed" ? "red" : notice.type === "completed" ? "green" : "blue",
  })));
  const fromThreads = threads.slice(0, 8).map((thread) => ({
    id: `thread-event:${thread.nodeIdThreadId}:${thread.updatedSort}`,
    ts: threadUpdatedAt(thread),
    type: thread.status === "running" ? t("event.codexReplied") : statusText(thread.status) || t("event.threadUpdated"),
    title: thread.titleText,
    detail: `${thread.repo} · ${thread.nodeName}`,
    nodeName: thread.nodeName,
    threadId: thread.id,
    tone: thread.tone,
  }));
  const fromCommands = failedCommands.map((item) => ({
    id: `failed-event:${item.id}`,
    ts: item.at,
    type: t("event.commandFailed"),
    title: item.title,
    detail: `${item.nodeName} · ${item.summary}`,
    nodeName: item.nodeName,
    threadId: item.threadId,
    tone: "red",
  }));
  const syncEvent = dashboard?.generatedAt ? [{
    id: `sync:${dashboard.generatedAt}`,
    ts: dashboard.generatedAt,
    type: t("event.syncCompleted"),
    title: t("event.syncCompleted"),
    detail: t("event.syncDetail", { online: dashboard?.totals?.online || 0, total: dashboard?.totals?.nodes || 0 }),
    tone: "cyan",
  }] : [];
  return [...state.liveEvents, ...fromCommands, ...fromNotifications, ...fromThreads, ...syncEvent]
    .filter((event) => event.ts)
    .sort((a, b) => toMillis(b.ts) - toMillis(a.ts))
    .slice(0, 16);
}

function metricItems(metrics) {
  return [
    [t("metric.online"), `${metrics.onlineDevices}/${metrics.totalDevices}`, "▣", "green"],
    [t("metric.running"), metrics.runningThreads, "◉", "blue"],
    [t("metric.reply"), metrics.waitingReplies, "□", "yellow"],
    [t("metric.approval"), metrics.waitingApprovals, "⚠", "orange"],
    [t("metric.draft"), metrics.agentDrafts, "◇", "purple"],
    [t("metric.failed"), metrics.failedCommands, "△", "red"],
    [t("metric.completed"), metrics.completedToday, "✓", "green"],
    [t("metric.sync"), `${metrics.latestSyncSeconds}s`, "↻", "cyan"],
  ];
}

function render() {
  applyLayoutControls();
  renderChrome();

  if (!isConfigured()) {
    dom.login.classList.remove("hidden");
    dom.content.classList.add("hidden");
    dom.commandDeck?.classList.add("hidden");
    dom.timeline.classList.add("hidden");
    dom.serverInput.value = state.config.server || window.location.origin;
    dom.tokenInput.value = state.config.token || "";
    return;
  }

  dom.login.classList.add("hidden");
  dom.commandDeck?.classList.remove("hidden");
  dom.content.classList.remove("hidden");
  dom.timeline.classList.remove("hidden");

  if (!state.dashboard) {
    renderLoading();
    return;
  }

  state.view = normalizeDashboard(state.dashboard);
  renderMetrics(state.view.metrics);
  renderHealthStrip(state.view.metrics, state.view.queue);
  renderCommandDeck();
  renderFilters();
  renderDevices(state.view.devices);
  renderThreads(state.view.threads);
  renderQueue(state.view.queue);
  renderEvents(state.view.events);
  refreshOpenModal();
}

function renderChrome() {
  dom.viewport.textContent = `${window.innerWidth}x${window.innerHeight}`;
  dom.sync.textContent = state.mockMode
    ? t("sync.mock")
    : state.lastError
      ? state.lastError
      : state.dashboard?.generatedAt
        ? t("sync.live", { time: clock(state.dashboard.generatedAt) })
        : t("sync.waiting");
}

function renderLoading() {
  if (dom.healthStrip) {
    dom.healthStrip.innerHTML = `<span>${escapeHtml(t("health.waiting"))}</span><i style="--health-width: 0%"></i>`;
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
  if (dom.commandDeck) dom.commandDeck.innerHTML = commandDeckSkeleton();
  dom.devices.innerHTML = `<div class="fleet-empty">${escapeHtml(t("loading.connecting"))}</div>`;
  dom.threads.innerHTML = skeletonCards(6);
  dom.queue.innerHTML = `<div class="fleet-empty">${escapeHtml(t("loading.queue"))}</div>`;
  dom.events.innerHTML = `<div class="fleet-empty">${escapeHtml(t("loading.events"))}</div>`;
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
  const label = t(`health.${tone}`);
  dom.healthStrip.className = `fleet-health-strip ${tone}`;
  dom.healthStrip.innerHTML = `
    <span>${escapeHtml(t("health.summary", {
      label,
      online: `${metrics.onlineDevices}/${metrics.totalDevices}`,
      blocked,
      oldest: oldestAttention ? `${oldestAttention}m` : "0m",
    }))}</span>
    <i style="--health-width: ${score}%"></i>
  `;
}

function commandDeckSkeleton() {
  return `
    <article class="fleet-command-card loading"><span></span><strong></strong></article>
    <article class="fleet-command-card loading"><span></span><strong></strong></article>
    <article class="fleet-command-card loading"><span></span><strong></strong></article>
    <article class="fleet-command-actions loading"><span></span><strong></strong></article>
  `;
}

function commandDeckHealth() {
  const checks = (state.view?.devices || []).flatMap((device) => Array.isArray(device.syncHealth?.checks) ? device.syncHealth.checks : []);
  const danger = checks.filter((check) => check.state === "danger").length;
  const warning = checks.filter((check) => check.state === "warning").length;
  const tone = danger > 0 ? "red" : warning > 0 ? "yellow" : "green";
  const label = danger > 0
    ? t("command.syncBad", { count: danger })
    : warning > 0
      ? t("command.syncWarn", { count: warning })
      : t("command.syncOk");
  return { tone, label };
}

function commandDeckUpdate() {
  const update = state.updateStatus;
  if (!update) return { tone: "slate", label: t("command.updateUnknown"), detail: "" };
  const detail = state.opsLastCheckedAt ? t("command.lastCheck", { time: timeAgo(state.opsLastCheckedAt) }) : "";
  if (update.error) return { tone: "yellow", label: t("command.updateError"), detail };
  if (update.updateAvailable) return { tone: "orange", label: t("command.updateAvailable", { version: update.latestVersion || "?" }), detail };
  return { tone: "green", label: t("command.updateCurrent"), detail };
}

function renderCommandDeck() {
  if (!dom.commandDeck || !state.view) return;
  const priority = state.view.queue?.[0] || null;
  const health = commandDeckHealth();
  const update = commandDeckUpdate();
  dom.commandDeck.innerHTML = `
    <article class="fleet-command-card ${priority ? RISK[priority.risk]?.tone || "yellow" : "green"}">
      <span>${escapeHtml(t("command.priority"))}</span>
      <strong>${escapeHtml(priority ? priority.title : t("command.priorityEmpty"))}</strong>
      <em>${escapeHtml(priority ? t("command.priorityDetail", { type: priority.type, node: priority.nodeName }) : t("empty.queueDesc"))}</em>
    </article>
    <article class="fleet-command-card ${health.tone}">
      <span>${escapeHtml(t("command.sync"))}</span>
      <strong>${escapeHtml(health.label)}</strong>
      <em>${escapeHtml(t("command.syncDetail", {
        online: `${state.view.metrics.onlineDevices}/${state.view.metrics.totalDevices}`,
        blocked: state.view.queue.length,
        oldest: state.view.queue[0] ? timeAgo(state.view.queue[0].at) : "0m",
      }))}</em>
    </article>
    <article class="fleet-command-card ${update.tone}">
      <span>${escapeHtml(t("command.update"))}</span>
      <strong>${escapeHtml(update.label)}</strong>
      <em>${escapeHtml(update.detail || `${state.updateStatus?.currentVersion || "v?"}`)}</em>
    </article>
    <article class="fleet-command-actions">
      <p class="fleet-kicker">${escapeHtml(t("command.kicker"))}</p>
      <div>
        <button class="fleet-button primary" type="button" data-fleet-command="open_pending">${escapeHtml(t("command.openPending"))}</button>
        <button class="fleet-button ghost" type="button" data-fleet-command="refresh_all">${escapeHtml(t("command.refreshAll"))}</button>
        <button class="fleet-button ghost" type="button" data-fleet-command="check_update">${escapeHtml(t("command.checkUpdate"))}</button>
        <button class="fleet-button ghost" type="button" data-fleet-command="open_health">${escapeHtml(t("command.openHealth"))}</button>
        <button class="fleet-button ghost" type="button" data-fleet-command="open_console">${escapeHtml(t("command.openConsole"))}</button>
      </div>
    </article>
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
      ${escapeHtml(t(label))} <strong>${counts[key] || 0}</strong>
    </button>
  `).join("");
}

function renderDevices(devices) {
  const filtered = devices.filter((device) => state.deviceFilter === "all" || device.status === state.deviceFilter);
  dom.nodeCount.textContent = `${devices.filter((device) => device.sourceStatus === "online").length}/${devices.length}`;
  dom.devices.innerHTML = filtered.length ? filtered.map((device) => {
    const label = device.status === "busy" ? t("device.busy") : device.status === "offline" ? t("device.offline") : t("device.online");
    return `
      <article class="fleet-device ${device.status}" data-node-id="${escapeHtml(device.id)}">
        <div class="fleet-device-icon">${escapeHtml(device.icon)}</div>
        <div class="fleet-device-main">
          <div class="fleet-device-head">
            <strong>${escapeHtml(device.name)}</strong>
            <span><i></i>${label}</span>
          </div>
          <div class="fleet-device-stats">
            <span>${escapeHtml(t("device.running"))} <strong>${device.running}</strong></span>
            <span>${escapeHtml(t("device.pending"))} <strong>${device.pending}</strong></span>
            <span>${escapeHtml(t("device.heartbeat"))} <strong>${timeAgo(device.heartbeat)}</strong></span>
          </div>
          ${sourceChipsHtml(device.syncHealth, { compact: true })}
          ${meterHtml(t("meter.cpu"), device.cpu, device.status)}
          ${meterHtml(t("meter.memory"), device.memory, device.status)}
        </div>
      </article>
    `;
  }).join("") : `<div class="fleet-empty">${escapeHtml(t("empty.devices"))}</div>`;
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

function sourceChipsHtml(syncHealth = {}, options = {}) {
  const checks = Array.isArray(syncHealth?.checks) ? syncHealth.checks : [];
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const keys = options.keys || ["cloud", "farfield", "codex", "commands"];
  const rows = keys.map((key) => byKey.get(key) || {
    key,
    state: "unknown",
    detail: t("source.unknown"),
    at: null,
  });
  const classes = ["fleet-source-chips", options.compact ? "compact" : ""].filter(Boolean).join(" ");
  return `
    <div class="${classes}" aria-label="${escapeHtml(t("modal.sourceTitle"))}">
      ${rows.map((check) => {
        const stateName = ["ok", "warning", "danger"].includes(check.state) ? check.state : "unknown";
        const label = t(`source.${check.key}`, {}, check.label || check.key);
        const stateLabel = t(`source.${stateName}`);
        const age = check.at ? timeAgo(check.at) : t("time.never");
        const detail = `${label}: ${stateLabel} · ${age}${check.detail ? ` · ${check.detail}` : ""}`;
        return `<span class="fleet-source-chip ${stateName}" title="${escapeHtml(detail)}"><i></i>${escapeHtml(`${label} · ${stateLabel}`)}</span>`;
      }).join("")}
    </div>
  `;
}

function renderThreads(threads) {
  const display = threads.filter((thread) => thread.status !== "archived").slice(0, viewportProfile().threadLimit);
  dom.threads.innerHTML = display.length ? display.map((thread) => threadCardHtml(thread)).join("") : `
    <div class="fleet-empty hero-empty">
      <strong>${escapeHtml(t("empty.threadsTitle"))}</strong>
      <span>${escapeHtml(t("empty.threadsDesc"))}</span>
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
        ${badgeHtml(statusText(thread.status), status.tone)}
        <span>${durationLabel(thread)}</span>
      </div>
      <p>${escapeHtml(thread.draft?.text || thread.summaryText)}</p>
      ${sourceChipsHtml(thread.syncHealth, { compact: true, keys: ["cloud", "farfield", "codex", "commands"] })}
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
  return badgeHtml(riskText(risk), item.tone);
}

function threadActions(thread) {
  if (thread.status === "waiting_approval") return [
    { key: "details", label: t("actions.details") },
    { key: "approve", label: t("actions.approve"), primary: true },
    { key: "agent", label: t("actions.agent") },
    { key: "reject", label: t("actions.reject") },
  ];
  if (thread.status === "waiting_reply") return [
    { key: "details", label: t("actions.details") },
    { key: "reply", label: t("actions.reply"), primary: true },
    { key: "agent", label: t("actions.agent") },
  ];
  if (thread.status === "agent_draft") return [
    { key: "details", label: t("actions.details") },
    { key: "draft", label: t("actions.draft"), primary: true },
    { key: "approve", label: t("actions.approve") },
  ];
  if (thread.status === "failed") return [
    { key: "details", label: t("actions.details") },
    { key: "retry", label: t("actions.retry"), primary: true },
    { key: "logs", label: t("actions.logs") },
  ];
  if (thread.status === "completed_unread") return [
    { key: "details", label: t("actions.details") },
    { key: "mark_read", label: t("actions.markRead"), primary: true },
  ];
  return [
    { key: "details", label: t("actions.details") },
    { key: "reply", label: t("actions.reply") },
    { key: "agent", label: t("actions.agent") },
  ];
}

function renderQueue(queue) {
  dom.queueCount.textContent = t("queue.total", { count: queue.length });
  dom.queue.innerHTML = queue.length ? queue.slice(0, viewportProfile().queueLimit).map((item) => `
    <article class="fleet-queue-item ${RISK[item.risk]?.tone || "green"} ${attentionAgeClass(item)}" data-open-thread="${escapeHtml(item.nodeId)}::${escapeHtml(item.threadId)}">
      <div class="fleet-queue-head">
        ${badgeHtml(item.type, STATUS[item.status]?.tone || "slate")}
        ${riskBadge(item.risk)}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(t("queue.from", { thread: shortId(item.threadId), repo: item.repo, node: item.nodeName }))}</p>
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
      <strong>${escapeHtml(t("empty.queueTitle"))}</strong>
      <span>${escapeHtml(t("empty.queueDesc"))}</span>
    </div>
  `;
}

function queueActions(item) {
  if (item.status === "waiting_approval") return [
    { key: "approve", label: t("actions.approveSend"), primary: true },
    { key: "agent", label: t("actions.agent") },
    { key: "reply", label: t("actions.edit") },
    { key: "reject", label: t("actions.reject") },
  ];
  if (item.status === "waiting_reply") return [
    { key: "reply", label: t("actions.reply"), primary: true },
    { key: "agent", label: t("actions.agent") },
    { key: "takeover", label: t("actions.skip") },
  ];
  if (item.status === "agent_draft") return [
    { key: "draft", label: t("actions.draft"), primary: true },
    { key: "reply", label: t("actions.edit") },
    { key: "takeover", label: t("actions.takeover") },
  ];
  if (item.status === "failed") return [
    { key: "retry", label: t("actions.retry"), primary: true },
    { key: "logs", label: t("actions.viewLogs") },
    { key: "takeover", label: t("actions.takeover") },
  ];
  return [
    { key: "details", label: t("actions.quickView"), primary: true },
    { key: "mark_read", label: t("actions.markRead") },
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
  const label = minutes >= 30 ? t("age.escalated") : t("age.aging");
  return `<strong class="fleet-age-chip">${escapeHtml(t("age.minutes", { label, minutes }))}</strong>`;
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
  `).join("") : `<div class="fleet-empty">${escapeHtml(t("empty.events"))}</div>`;
  if (dom.autoScroll.checked) {
    dom.events.scrollLeft = 0;
  }
}

function openThread(nodeId, threadId, intent = "details") {
  const node = (state.dashboard?.nodes || []).find((item) => item.id === nodeId);
  const thread = state.view?.threads.find((item) => item.nodeId === nodeId && item.id === threadId) ||
    (node?.threads || []).find((item) => item.id === threadId);
  if (!node || !thread) {
    showToast(t("toast.noThread"));
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
  const translatedStatus = statusText(thread.status);
  dom.modalMeta.textContent = t("modal.meta", { repo: thread.repo, node: thread.nodeName, status: translatedStatus });
  dom.modalTitle.textContent = intentTitle(intent);
  dom.modalBody.innerHTML = `
    <aside class="fleet-modal-context">
      <dl>
        <div><dt>${escapeHtml(t("modal.project"))}</dt><dd>${escapeHtml(thread.repo)}</dd></div>
        <div><dt>${escapeHtml(t("modal.threadTitle"))}</dt><dd>${escapeHtml(thread.titleText)}</dd></div>
        <div><dt>${escapeHtml(t("modal.node"))}</dt><dd>${escapeHtml(thread.nodeName)}</dd></div>
        <div><dt>${escapeHtml(t("modal.status"))}</dt><dd>${badgeHtml(translatedStatus, status.tone)}</dd></div>
        <div><dt>${escapeHtml(t("modal.risk"))}</dt><dd>${riskBadge(thread.risk)}</dd></div>
        <div><dt>${escapeHtml(t("modal.duration"))}</dt><dd>${escapeHtml(durationLabel(thread))}</dd></div>
        <div><dt>cwd</dt><dd>${escapeHtml(thread.cwd || thread.source || "-")}</dd></div>
      </dl>
      ${thread.status === "completed_unread" ? `
        <button class="fleet-button ghost" data-thread-action="mark_read" data-node-id="${escapeHtml(thread.nodeId)}" data-thread-id="${escapeHtml(thread.id)}" type="button">${escapeHtml(t("actions.markRead"))}</button>
      ` : ""}
    </aside>
    <section class="fleet-modal-main">
      <div class="fleet-modal-card">
        <div class="fleet-section-head compact">
          <div>
            <p class="fleet-kicker">${escapeHtml(t("modal.latestKicker"))}</p>
            <h3>${escapeHtml(t("modal.latestTitle"))}</h3>
          </div>
          ${badgeHtml(queueType(thread.status), status.tone)}
        </div>
        <p>${escapeHtml(thread.summaryText)}</p>
      </div>
      <div class="fleet-modal-card">
        <div class="fleet-section-head compact">
          <div>
            <p class="fleet-kicker">${escapeHtml(t("modal.sourceKicker"))}</p>
            <h3>${escapeHtml(t("modal.sourceTitle"))}</h3>
          </div>
        </div>
        ${sourceChipsHtml(thread.syncHealth, { keys: ["cloud", "farfield", "codex", "commands"] })}
      </div>
      ${renderContextTools(thread)}
      ${draft ? `
        <div class="fleet-modal-card proposal">
          <div class="fleet-section-head compact">
            <div>
              <p class="fleet-kicker">${escapeHtml(t("modal.agentKicker"))}</p>
              <h3>${escapeHtml(t("modal.agentTitle"))}</h3>
            </div>
            <div class="fleet-proposal-chips">
              ${riskBadge(draft.risk)}
              ${draftState.expired ? badgeHtml(t("modal.expired"), "red") : badgeHtml(draftState.timeLeftLabel, draftState.timeLeftTone)}
              ${draftState.stale ? badgeHtml(t("modal.stale"), "orange") : ""}
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
          ${escapeHtml(t("modal.replyLabel"))}
          ${draft && isMobileViewport() ? `<button class="fleet-inline-edit" data-modal-action="edit_reply" type="button">${escapeHtml(replyReadonly ? t("actions.edit") : t("modal.editing"))}</button>` : ""}
        </span>
        <textarea id="fleetReplyText" maxlength="1200" placeholder="${escapeHtml(t("modal.placeholder"))}" ${replyReadonly ? "readonly" : ""}>${escapeHtml(defaultText)}</textarea>
        <em><strong id="fleetReplyCount">${escapeHtml(defaultText.length)}</strong>/1200</em>
      </label>
      <div class="fleet-policy">
        <strong>${escapeHtml(t("modal.boundaryTitle"))}</strong>
        <span>${escapeHtml(t("modal.allowed"))}</span>
        <span>${escapeHtml(t("modal.denied"))}</span>
        <span>${escapeHtml(thread.risk === "high" ? t("modal.highRisk") : t("modal.normalRisk"))}</span>
      </div>
      <div class="fleet-modal-actions">
        <button class="fleet-button primary" data-modal-action="approve" type="button">${escapeHtml(t("modal.approveContinue"))}</button>
        <button class="fleet-button ghost" data-modal-action="send" type="button">${escapeHtml(t("modal.sendEdited"))}</button>
        <button class="fleet-button danger" data-modal-action="reject" type="button">${escapeHtml(t("actions.reject"))}</button>
        <button class="fleet-button ghost" data-modal-action="takeover" type="button">${escapeHtml(t("modal.manualTakeover"))}</button>
      </div>
    </section>
  `;
  document.querySelector("#fleetReplyText")?.addEventListener("input", (event) => {
    state.replyDrafts.set(thread.nodeIdThreadId, event.target.value);
    const counter = document.querySelector("#fleetReplyCount");
    if (counter) counter.textContent = String(event.target.value.length);
  });
}

function isModalReplyActive() {
  if (dom.modal.classList.contains("hidden")) return false;
  const active = document.activeElement;
  return Boolean(active && active.id === "fleetReplyText");
}

function refreshOpenModal() {
  if (!state.selected || dom.modal.classList.contains("hidden")) return;
  if (isModalReplyActive()) return;
  const node = (state.dashboard?.nodes || []).find((item) => item.id === state.selected.nodeId);
  const thread = state.view?.threads.find((item) => item.nodeId === state.selected.nodeId && item.id === state.selected.threadId) ||
    (node?.threads || []).find((item) => item.id === state.selected.threadId);
  if (!node || !thread) return;
  const normalized = thread.nodeId ? thread : normalizeDashboard({ nodes: [node], totals: {} }).threads.find((item) => item.id === state.selected.threadId);
  if (normalized) renderModal(node, normalized, state.selected.intent);
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
    timeLeftLabel: expiresAt ? t("modal.expires", { minutes: Math.max(0, Math.ceil(remainingMs / 60_000)) }) : t("modal.noExpiry"),
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
  if (draftState.expired) warnings.push(t("modal.warningExpired"));
  if (draftState.stale) warnings.push(t("modal.warningStale"));
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
    [t("modal.status"), statusText(bundle.status) || bundle.status || "-"],
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

function renderContextTools(thread) {
  const key = thread.nodeIdThreadId;
  const fullState = state.fullContexts.get(key) || null;
  const auditState = state.proposalAudits.get(key) || null;
  const fullContext = fullState?.fullContext || null;
  const statusText = {
    ready: "已缓存",
    queued: "拉取中",
    not_ready: "未拉取",
    expired: "已过期",
    cleared: "已清除",
  }[fullState?.status] || "未拉取";
  const statusTone = {
    ready: "green",
    queued: "yellow",
    expired: "orange",
    cleared: "slate",
  }[fullState?.status] || "slate";
  return `
    <div class="fleet-modal-card context-tools">
      <div class="fleet-section-head compact">
        <div>
          <p class="fleet-kicker">Context & audit</p>
          <h3>上下文 / 审计</h3>
        </div>
        ${badgeHtml(statusText, statusTone)}
      </div>
      <div class="fleet-context-actions">
        <button class="fleet-button ghost" data-modal-action="load_full_context" type="button">查看完整上下文</button>
        <button class="fleet-button ghost" data-modal-action="request_full_context" type="button">拉取完整上下文</button>
        <button class="fleet-button ghost" data-modal-action="load_proposal_audit" type="button">审计记录</button>
        <button class="fleet-button ghost" data-modal-action="clear_full_context" type="button">清除缓存</button>
      </div>
      ${fullState?.message ? `<p class="fleet-context-note">${escapeHtml(fullState.message)}</p>` : ""}
      ${fullContext ? renderFullContextPreview(fullContext) : ""}
      ${auditState ? renderProposalAuditPreview(auditState) : ""}
    </div>
  `;
}

function renderFullContextPreview(fullContext) {
  const messages = Array.isArray(fullContext.messages) ? fullContext.messages.slice(-5) : [];
  return `
    <div class="fleet-full-context">
      <div class="fleet-context-meta">
        <span>消息 ${escapeHtml(fullContext.messageCount ?? messages.length)}</span>
        <span>${fullContext.redacted ? "已脱敏" : "未脱敏"}</span>
        <span>缓存 ${escapeHtml(timeAgo(fullContext.cachedAt || fullContext.collectedAt))}</span>
        ${fullContext.expiresAt ? `<span>过期 ${escapeHtml(timeUntil(fullContext.expiresAt))}</span>` : ""}
        ${fullContext.contextSignature ? `<span>${escapeHtml(String(fullContext.contextSignature).slice(0, 12))}</span>` : ""}
      </div>
      <div class="fleet-full-context-list">
        ${messages.length ? messages.map((message) => `
          <article>
            <strong>${escapeHtml(message.role || "message")}</strong>
            <span>${escapeHtml(message.phase || "-")} · ${escapeHtml(timeAgo(message.at))}</span>
            <p>${escapeHtml(compactText(message.text, 320))}</p>
          </article>
        `).join("") : `<div class="fleet-empty">完整上下文暂无可展示消息。</div>`}
      </div>
    </div>
  `;
}

function renderProposalAuditPreview(auditState) {
  const audits = Array.isArray(auditState.audits) ? auditState.audits.slice(0, 8) : [];
  return `
    <div class="fleet-proposal-audit">
      <div class="fleet-context-meta">
        <span>审计 ${escapeHtml(auditState.totalAudits ?? audits.length)}</span>
        <span>加载 ${escapeHtml(timeAgo(auditState.loadedAt))}</span>
      </div>
      <div class="fleet-audit-list">
        ${audits.length ? audits.map((entry) => `
          <article>
            <strong>${escapeHtml(entry.event || "-")}</strong>
            <span>${escapeHtml(entry.actor || "-")} · ${escapeHtml(entry.decision || entry.risk || "-")} · ${escapeHtml(timeAgo(entry.at))}</span>
            <code>${escapeHtml(String(entry.entryHash || entry.contextSignature || entry.proposalId || "").slice(0, 18))}</code>
          </article>
        `).join("") : `<div class="fleet-empty">暂无 proposal 审计记录。</div>`}
      </div>
    </div>
  `;
}

function intentTitle(intent) {
  return {
    approve: t("intent.approve"),
    reject: t("intent.reject"),
    reply: t("intent.reply"),
    agent: t("intent.agent"),
    draft: t("intent.draft"),
    retry: t("intent.retry"),
    logs: t("actions.logs"),
    takeover: t("intent.takeover"),
  }[intent] || t("intent.details");
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

function rerenderSelectedModal() {
  const selected = state.selected;
  if (!selected) return;
  const node = (state.dashboard?.nodes || []).find((item) => item.id === selected.nodeId);
  const thread = state.view?.threads.find((item) => item.nodeId === selected.nodeId && item.id === selected.threadId) ||
    (node?.threads || []).find((item) => item.id === selected.threadId);
  if (!node || !thread) return;
  const normalized = thread.nodeId ? thread : normalizeDashboard({ nodes: [node], totals: {} }).threads.find((item) => item.id === selected.threadId);
  renderModal(node, normalized, selected.intent);
}

async function handleContextToolAction(action, thread) {
  const key = thread.nodeIdThreadId;
  if (state.mockMode) {
    if (action === "load_full_context" || action === "request_full_context") {
      state.fullContexts.set(key, {
        status: action === "request_full_context" ? "queued" : "ready",
        message: action === "request_full_context" ? "预览模式：完整上下文拉取已排队。" : "",
        loadedAt: new Date().toISOString(),
        fullContext: action === "load_full_context" ? {
          threadId: thread.id,
          nodeId: thread.nodeId,
          mode: "full",
          messageCount: 2,
          redacted: true,
          truncated: false,
          collectedAt: new Date().toISOString(),
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          contextSignature: String(hashValue(key)),
          messages: [
            { role: "user", phase: "message", at: nowMinus(240), text: thread.titleText },
            { role: "assistant", phase: "progress", at: nowMinus(120), text: thread.summaryText },
          ],
        } : null,
      });
      showToast(action === "request_full_context" ? "完整上下文拉取已排队" : "完整上下文已加载");
    } else if (action === "clear_full_context") {
      state.fullContexts.delete(key);
      showToast("完整上下文缓存已清除");
    } else if (action === "load_proposal_audit") {
      state.proposalAudits.set(key, {
        loadedAt: new Date().toISOString(),
        totalAudits: 1,
        audits: [{ event: "created", actor: "admin", risk: thread.risk, at: new Date().toISOString(), entryHash: String(hashValue(key)) }],
      });
      showToast("审计记录已加载");
    }
    rerenderSelectedModal();
    return;
  }
  try {
    if (action === "load_full_context") {
      const payload = await apiFetch(`/api/nodes/${encodeURIComponent(thread.nodeId)}/threads/${encodeURIComponent(thread.id)}/context-bundle?mode=full`);
      state.fullContexts.set(key, { ...payload, loadedAt: new Date().toISOString() });
      showToast(payload.status === "ready" ? "完整上下文已加载" : "完整上下文未就绪");
    } else if (action === "request_full_context") {
      const payload = await apiFetch(`/api/nodes/${encodeURIComponent(thread.nodeId)}/threads/${encodeURIComponent(thread.id)}/context-request`, {
        method: "POST",
        body: JSON.stringify({ maxMessages: 300, maxChars: 240000 }),
      });
      state.fullContexts.set(key, { ...payload, loadedAt: new Date().toISOString(), message: payload.deduped ? "已有拉取任务正在执行。" : "完整上下文拉取已排队。" });
      showToast(payload.deduped ? "已有完整上下文拉取任务" : "完整上下文拉取已排队");
    } else if (action === "clear_full_context") {
      await apiFetch(`/api/nodes/${encodeURIComponent(thread.nodeId)}/threads/${encodeURIComponent(thread.id)}/context-clear`, { method: "POST" });
      state.fullContexts.delete(key);
      showToast("完整上下文缓存已清除");
    } else if (action === "load_proposal_audit") {
      const payload = await apiFetch(`/api/nodes/${encodeURIComponent(thread.nodeId)}/threads/${encodeURIComponent(thread.id)}/proposals?limit=20`);
      state.proposalAudits.set(key, { ...payload, loadedAt: new Date().toISOString() });
      showToast("审计记录已加载");
    }
    rerenderSelectedModal();
  } catch (error) {
    showToast(`上下文操作失败：${error.message}`);
  }
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
  if (["load_full_context", "request_full_context", "clear_full_context", "load_proposal_audit"].includes(action)) {
    await handleContextToolAction(action, thread);
    return;
  }
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
    showToast(t("toast.mockQueued"));
    render();
    return;
  }
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
  showToast(t("toast.queued"));
  await loadState();
}

async function markThreadRead(nodeId, threadId) {
  if (state.mockMode) {
    showToast(t("toast.mockMarked"));
    return;
  }
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/notifications/read`, {
    method: "POST",
    body: JSON.stringify({ threadId }),
  });
  showToast(t("toast.markedRead"));
  await loadState();
}

async function requestRefresh() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  dom.refreshBtn.disabled = true;
  if (state.mockMode) {
    state.dashboard.generatedAt = new Date().toISOString();
    showToast(t("toast.mockRefresh"));
    render();
    state.refreshInFlight = false;
    dom.refreshBtn.disabled = false;
    return;
  }
  try {
    const nodes = (state.dashboard?.nodes || []).filter((node) => node.status === "online");
    if (!nodes.length) {
      showToast(t("toast.noOnline"));
      await loadState();
      return;
    }
    const results = await Promise.allSettled(nodes.map((node) =>
      apiFetch(`/api/nodes/${encodeURIComponent(node.id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ kind: "refresh", provider: "codex" }),
      }),
    ));
    const queued = results.filter((item) => item.status === "fulfilled").length;
    const failed = results.length - queued;
    showToast(failed > 0 ? t("toast.refreshFailedSome", { queued, failed }) : t("toast.refreshQueued", { queued }));
    await loadState();
  } catch (error) {
    showToast(t("toast.refreshFailed", { error: error.message }));
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
    state.updateStatus = {
      ok: true,
      currentVersion: "0.5.0",
      latestVersion: "0.5.0",
      updateAvailable: true,
    };
    state.opsLastCheckedAt = Date.now();
    state.lastError = "";
    render();
    return;
  }
  try {
    state.dashboard = await apiFetch("/api/state");
    await loadOpsStatus();
    state.lastError = "";
    render();
    connectEvents();
  } catch (error) {
    state.lastError = error.message;
    render();
  }
}

async function loadOpsStatus(force = false) {
  if (!force && state.opsLastCheckedAt && Date.now() - state.opsLastCheckedAt < 10 * 60_000) return state.updateStatus;
  try {
    state.updateStatus = await apiFetch("/api/update/check");
    state.opsLastCheckedAt = Date.now();
    return state.updateStatus;
  } catch (error) {
    state.updateStatus = { ok: false, error: error.message };
    state.opsLastCheckedAt = Date.now();
    return state.updateStatus;
  }
}

async function checkUpdateFromDeck() {
  const update = await loadOpsStatus(true);
  renderCommandDeck();
  if (update?.error) {
    showToast(t("toast.updateFailed", { error: update.error }));
  } else if (update?.updateAvailable) {
    showToast(t("toast.updateAvailable", { version: update.latestVersion || "?" }));
  } else {
    showToast(t("toast.updateCurrent"));
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
    state: t("event.syncCompleted"),
    commandQueued: state.language === "en" ? "Command queued" : "命令已排队",
    commandResult: state.language === "en" ? "Command completed" : "命令已回执",
    nodeEnrolled: state.language === "en" ? "Node online" : "节点上线",
    agentProposalCreated: state.language === "en" ? "Agent proposal" : "Agent 草稿",
    audit: state.language === "en" ? "Audit event" : "审计事件",
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

  dom.mockBtn?.addEventListener("click", () => {
    if (!state.allowMock) return;
    state.mockMode = true;
    state.dashboard = mockDashboard();
    render();
  });

  dom.language?.addEventListener("change", () => {
    setLanguage(dom.language.value);
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
  dom.commandDeck?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fleet-command]");
    if (!button) return;
    const command = button.dataset.fleetCommand;
    if (command === "open_pending") {
      const current = firstQueueSelection();
      if (current) openThread(current.nodeId, current.threadId, "details");
      else showToast(t("empty.queueTitle"));
    }
    if (command === "refresh_all") void requestRefresh();
    if (command === "check_update") void checkUpdateFromDeck();
    if (command === "open_health") window.open("/health.html", "_blank", "noopener");
    if (command === "open_console") window.location.href = "/";
  });

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
if (dom.mockBtn) dom.mockBtn.classList.toggle("hidden", !state.allowMock);
setLanguage(state.language);
installEventHandlers();
await loadState();
setInterval(loadState, 30_000);
setInterval(renderChrome, 1000);
