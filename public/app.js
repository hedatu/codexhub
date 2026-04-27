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
  linuxInstallCommand: document.querySelector("#linuxInstallCommand"),
  macosInstallCommand: document.querySelector("#macosInstallCommand"),
  rotateInstallKeyBtn: document.querySelector("#rotateInstallKeyBtn"),
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
  syncDiagnostics: document.querySelector("#syncDiagnostics"),
  markAllReadBtn: document.querySelector("#markAllReadBtn"),
  nodeList: document.querySelector("#nodeList"),
  nodeRange: document.querySelector("#nodeRange"),
  statusFilter: document.querySelector("#statusFilter"),
  nodeSearchInput: document.querySelector("#nodeSearchInput"),
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
  auditLogs: [],
  nodeCredentials: new Map(),
  eventSource: null,
  refreshTimer: null,
  view: "overview",
  inboxFilter: "unread",
  nodeQuery: "",
  replyDrafts: new Map(),
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
  const millis = typeof iso === "number" ? (iso < 10_000_000_000 ? iso * 1000 : iso) : Date.parse(iso);
  if (!Number.isFinite(millis)) return "从未";
  const seconds = Math.max(0, Math.round((Date.now() - millis) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleString();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  if (thread.attentionKind === "completed") return { className: "waiting", text: "任务完成" };
  if (thread.attentionKind === "updated") return { className: "waiting", text: thread.readAt ? "已读" : "未读" };
  if (thread.attentionKind === "commandFailed") return { className: "approval", text: "发送失败" };
  if (thread.waitingOnApproval) return { className: "approval", text: "待审批" };
  if (thread.waitingOnUserInput) return { className: "waiting", text: "等待回复" };
  if (thread.isGenerating) return { className: "running", text: "运行中" };
  return { className: "online", text: "空闲" };
}

function threadTitle(thread) {
  const raw = String(thread.title || "").trim();
  if (raw) return raw;
  const preview = String(thread.preview || "").trim();
  if (!preview) return "未命名任务";
  const firstLine = preview.split(/\r?\n/).find(Boolean) || preview;
  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}...` : firstLine;
}

function compactText(text, limit = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

function threadSummary(thread) {
  return compactText(thread.preview || thread.cwd || thread.source || thread.provider, 120) || "暂无摘要";
}

function threadActivityTime(thread) {
  return toMillis(thread.latestFinalMessageAt || thread.latestProgressMessageAt || thread.latestMessageAt || thread.updatedAt || thread.createdAt);
}

function nodeSearchText(node) {
  return [
    node.id,
    node.name,
    node.host?.hostname,
    node.host?.platform,
    node.host?.arch,
    ...(node.tags ?? []),
    ...(node.threads ?? []).slice(0, 8).flatMap((thread) => [threadTitle(thread), threadSummary(thread), thread.cwd, thread.source]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function syncLabel(stateName) {
  const labels = {
    ok: { className: "online", text: "正常" },
    warning: { className: "waiting", text: "注意" },
    danger: { className: "approval", text: "异常" },
  };
  return labels[stateName] ?? { className: "offline", text: "未知" };
}

function auditLabel(type) {
  const labels = {
    "node.enrolled": "设备登记",
    "node.updated": "信息更新",
    "node.revoked": "设备吊销",
    "node.key_rotated": "设备密钥重置",
    "install_key.rotated": "安装密钥轮换",
    "command.queued": "命令下发",
    "command.completed": "命令完成",
  };
  return labels[type] || type || "操作";
}

function hostLabel(node) {
  const host = node.host || {};
  return [host.hostname || node.id, host.platform, host.arch].filter(Boolean).join(" · ");
}

function isEditingDetail() {
  const active = document.activeElement;
  return Boolean(active && dom.detailContent.contains(active) && (active.matches("textarea") || active.matches("input")));
}

function replyKey(nodeId, threadId) {
  return `${nodeId}::${threadId}`;
}

function commandsForThread(node, threadId) {
  return (node.recentCommandResults ?? [])
    .filter((command) => command?.action?.threadId === threadId)
    .sort((a, b) => toMillis(a.completedAt || a.createdAt) - toMillis(b.completedAt || b.createdAt));
}

function commandLabel(command) {
  if (command.status === "failed") return { className: "failed", text: "发送失败" };
  if (command.status === "done") return { className: "done", text: "已送达桌面端" };
  if (command.status === "leased") return { className: "pending", text: "桌面端处理中" };
  return { className: "pending", text: "等待桌面端接收" };
}

function renderCommandNotice(node, thread) {
  const latest = commandsForThread(node, thread.id).at(-1);
  if (!latest) return "";
  const label = commandLabel(latest);
  const completedAt = toMillis(latest.completedAt);
  const latestMessageAt = toMillis(thread.latestMessageAt || thread.latestProgressMessageAt || thread.latestFinalMessageAt || thread.updatedAt);
  const hasNewReply = latest.status === "done" && latestMessageAt > completedAt;
  const sentText = latest.action?.kind === "sendMessage" ? `：${latest.action?.text ?? ""}` : "";
  const detail = latest.status === "failed"
    ? (latest.result?.error || latest.result?.result?.error || "桌面端执行命令时返回失败")
    : hasNewReply
      ? "Codex 已产生新回复，查看上方最新进度。"
      : "命令已由桌面端执行，等待 Codex 线程产生新内容。";
  const steps = [
    ["云端排队", true],
    ["桌面端接收", Boolean(latest.leasedAt || latest.completedAt)],
    ["转发给 Codex", latest.status === "done"],
    ["Codex 有新回复", hasNewReply],
  ];
  return `
    <div class="command-notice ${label.className}">
      <strong>${label.text}</strong>
      <p>${escapeHtml(detail)}</p>
      <div class="command-steps">
        ${steps.map(([text, done]) => `<span class="${done ? "done" : ""}">${done ? "✓" : "·"} ${escapeHtml(text)}</span>`).join("")}
      </div>
      <span>${escapeHtml(`${latest.action?.kind ?? "command"}${sentText}`)}</span>
    </div>
  `;
}

function renderThreadTimeline(node, thread) {
  const latest = commandsForThread(node, thread.id).at(-1);
  const commandQueuedAt = latest ? toMillis(latest.createdAt) : 0;
  const commandLeasedAt = latest ? toMillis(latest.leasedAt) : 0;
  const commandCompletedAt = latest ? toMillis(latest.completedAt) : 0;
  const latestMessageAt = toMillis(thread.latestMessageAt || thread.latestProgressMessageAt || thread.latestFinalMessageAt || thread.updatedAt);
  const hasReplyAfterCommand = latest ? latest.status === "done" && latestMessageAt > commandCompletedAt : latestMessageAt > 0;
  const steps = [
    { label: "云端已记录", at: thread.updatedAt || thread.createdAt, done: true },
    { label: "手机指令排队", at: latest?.createdAt, done: Boolean(commandQueuedAt), warn: latest?.status === "failed" },
    { label: "桌面端接收", at: latest?.leasedAt, done: Boolean(commandLeasedAt || commandCompletedAt), warn: latest?.status === "failed" },
    { label: "转发给 Codex", at: latest?.completedAt, done: latest?.status === "done", warn: latest?.status === "failed" },
    {
      label: thread.isGenerating ? "Codex 运行中" : hasReplyAfterCommand ? "Codex 已回复" : "等待新内容",
      at: thread.latestMessageAt || thread.latestProgressMessageAt || thread.latestFinalMessageAt,
      done: Boolean(hasReplyAfterCommand || thread.isGenerating || !latest),
      warn: Boolean(latest && latest.status === "done" && !hasReplyAfterCommand),
    },
  ];
  return `
    <div class="sync-timeline">
      ${steps.map((step) => `
        <div class="timeline-step ${step.done ? "done" : ""} ${step.warn ? "warn" : ""}">
          <i></i>
          <div>
            <strong>${escapeHtml(step.label)}</strong>
            <span>${step.at ? timeAgo(step.at) : "待发生"}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRecentMessages(thread) {
  const messages = Array.isArray(thread.recentMessages) ? thread.recentMessages.filter((message) => String(message.text || "").trim()) : [];
  if (messages.length === 0) return "";
  return `
    <div class="message-list">
      <div class="section-head compact">
        <div>
          <h3>最近消息</h3>
          <p>来自本地 Codex 会话文件的最新输出</p>
        </div>
      </div>
      ${messages.map((message) => `
        <article class="message-bubble ${message.phase === "final_answer" ? "final" : "progress"}">
          <span>${escapeHtml(message.phase === "final_answer" ? "最终回复" : "过程消息")} · ${timeAgo(message.at)}</span>
          <p>${escapeHtml(message.text)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function scheduleStateRefresh(delay = 300) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;
    loadState();
  }, delay);
}

function scheduleFollowUpRefreshes(delays = [2500, 6500]) {
  for (const delay of delays) {
    setTimeout(() => loadState(), delay);
  }
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
  dom.content.dataset.view = state.view;
  const totals = dashboard.totals;
  const safeTotals = {
    nodes: Number(totals.nodes ?? 0),
    online: Number(totals.online ?? 0),
    running: Number(totals.running ?? 0),
    waitingReply: Number(totals.waitingReply ?? 0),
    waitingApproval: Number(totals.waitingApproval ?? 0),
    attention: Number(totals.attention ?? 0),
  };
  dom.metricOnline.textContent = `${safeTotals.online}/${safeTotals.nodes}`;
  dom.metricRunning.textContent = String(safeTotals.running);
  dom.metricReply.textContent = String(safeTotals.waitingReply);
  dom.metricApproval.textContent = String(safeTotals.waitingApproval);
  dom.attentionCount.textContent = String(safeTotals.attention);
  dom.nodeRange.textContent = safeTotals.nodes > 0 ? `${safeTotals.nodes} 台电脑` : "等待上报";
  renderAttention(dashboard.nodes);
  renderNodes(dashboard.nodes);
  renderDiagnostics(dashboard.nodes);
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
  dom.desktopInstallCommand.value = profile.desktop?.windows ?? profile.desktop?.powershell ?? "";
  dom.linuxInstallCommand.value = profile.desktop?.linux ?? "";
  dom.macosInstallCommand.value = profile.desktop?.macos ?? "";
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
  document.querySelectorAll("[data-inbox-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.inboxFilter === state.inboxFilter);
  });
  const noticeItems = nodes.flatMap((node) =>
    (node.notifications ?? [])
      .filter((notice) => {
        if (state.inboxFilter === "unread") return !notice.readAt;
        if (state.inboxFilter === "read") return Boolean(notice.readAt);
        return true;
      })
      .map((notice) => ({
        node,
        thread: {
          id: notice.threadId,
          title: notice.title,
          preview: notice.preview,
          latestMessage: notice.preview,
          latestMessageAt: notice.createdAt,
          updatedAt: notice.threadUpdatedAt || notice.createdAt,
          attentionKind: notice.type,
          notificationId: notice.id,
          notificationCreatedAt: notice.createdAt,
          readAt: notice.readAt,
        },
        status: notice.readAt ? { className: "online", text: "已读" } : threadStatus({ attentionKind: notice.type }),
      })),
  );
  const liveItems = state.inboxFilter === "read" ? [] : nodes.flatMap((node) =>
    (node.attention ?? [])
      .filter((thread) => !thread.notificationId)
      .map((thread) => ({
      node,
      thread,
      status: threadStatus(thread),
    })),
  );
  const items = [...noticeItems, ...liveItems]
    .sort((a, b) => toMillis(b.thread.notificationCreatedAt || b.thread.updatedAt) - toMillis(a.thread.notificationCreatedAt || a.thread.updatedAt));

  if (items.length === 0) {
    dom.attentionList.innerHTML = `<div class="attention-card"><p class="preview">暂无${state.inboxFilter === "read" ? "已读" : state.inboxFilter === "all" ? "" : "未读"}消息。</p></div>`;
    return;
  }

  dom.attentionList.innerHTML = items.map(({ node, thread, status }) => `
    <article class="attention-card" data-node="${escapeHtml(node.id)}" data-thread="${escapeHtml(thread.id)}">
      <div class="card-top">
        <div class="task-title">
          <strong>${escapeHtml(node.name)} · ${escapeHtml(threadTitle(thread))}</strong>
          <span>${escapeHtml(thread.attentionKind ? (thread.readAt ? "已读通知" : "未读通知") : (thread.cwd || thread.source || thread.provider))} · ${timeAgo(toMillis(thread.notificationCreatedAt || thread.updatedAt || node.lastSeenAt))}</span>
        </div>
        <span class="status-chip ${status.className}">${status.text}</span>
      </div>
      <p class="preview">${escapeHtml(threadSummary(thread))}</p>
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
  const query = state.nodeQuery.trim().toLowerCase();
  const filtered = nodes.filter((node) => {
    const matchesFilter = (() => {
      if (filter === "all") return true;
      if (filter === "attention") return node.metrics.attention > 0;
      if (filter === "running") return node.metrics.running > 0;
      if (filter === "warning") return node.syncHealth?.overall === "warning";
      if (filter === "danger") return node.syncHealth?.overall === "danger";
      return node.status === filter;
    })();
    return matchesFilter && (!query || nodeSearchText(node).includes(query));
  });

  if (filtered.length === 0) {
    dom.nodeList.innerHTML = `<div class="node-card"><p class="preview">没有符合筛选条件的节点。</p></div>`;
    return;
  }

  dom.nodeList.innerHTML = filtered.map((node) => {
    const status = statusLabel(node);
    const sync = syncLabel(node.syncHealth?.overall);
    return `
      <article class="node-card" data-node="${escapeHtml(node.id)}">
        <div class="node-top">
          <div class="node-title">
            <strong>${escapeHtml(node.name)}</strong>
            <span>${escapeHtml(node.host?.hostname ?? node.id)} · ${timeAgo(node.lastSeenAt)}</span>
          </div>
          <span class="status-chip ${status.className}">${status.text}</span>
        </div>
        <div class="node-sync-line">
          <span class="status-chip ${sync.className}">同步${sync.text}</span>
          <span>${escapeHtml(node.syncHealth?.checks?.find((check) => check.state !== "ok")?.detail || "同步链路正常")}</span>
        </div>
        <div class="node-stats">
          <span>运行中 <strong>${node.metrics.running}</strong></span>
          <i></i>
          <span>待回复 <strong>${node.metrics.waitingReply}</strong></span>
          <i></i>
          <span>待审批 <strong>${node.metrics.waitingApproval}</strong></span>
        </div>
        ${(node.tags ?? []).length ? `<div class="node-tags">${node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }).join("");
}

function renderDiagnostics(nodes) {
  if (!dom.syncDiagnostics) return;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    dom.syncDiagnostics.innerHTML = `
      <div class="section-head">
        <div>
          <h2>同步诊断</h2>
          <p>还没有电脑接入，暂时无法检查同步链路。</p>
        </div>
      </div>
    `;
    return;
  }
  const danger = nodes.filter((node) => node.syncHealth?.overall === "danger").length;
  const warning = nodes.filter((node) => node.syncHealth?.overall === "warning").length;
  const ok = nodes.length - danger - warning;
  dom.syncDiagnostics.innerHTML = `
    <div class="section-head">
      <div>
        <h2>同步诊断</h2>
        <p>检查手机端、云端、桌面端、Farfield 和 Codex 会话是否闭环。</p>
      </div>
      <span class="pill">${ok} 正常 · ${warning} 注意 · ${danger} 异常</span>
    </div>
    <div class="diagnostic-list">
      ${nodes.map(renderDiagnosticCard).join("")}
    </div>
  `;
}

function renderDiagnosticCard(node) {
  const health = node.syncHealth ?? {};
  const label = syncLabel(health.overall);
  const latest = health.latestThread;
  const counts = health.commandCounts ?? {};
  const recent = health.recentCommand;
  const checks = Array.isArray(health.checks) ? health.checks : [];
  return `
    <article class="diagnostic-card" data-node="${escapeHtml(node.id)}">
      <div class="card-top">
        <div class="task-title">
          <strong>${escapeHtml(node.name)}</strong>
          <span>${escapeHtml(hostLabel(node))} · ${timeAgo(node.lastSeenAt)}</span>
        </div>
        <span class="status-chip ${label.className}">${label.text}</span>
      </div>
      <div class="diagnostic-checks">
        ${checks.map((check) => {
          const checkLabel = syncLabel(check.state);
          return `
            <div class="diagnostic-check ${escapeHtml(check.state || "unknown")}">
              <strong>${escapeHtml(check.label)}</strong>
              <span>${escapeHtml(check.detail || "")}</span>
              <em>${timeAgo(check.at)}</em>
              <i class="status-chip ${checkLabel.className}">${checkLabel.text}</i>
            </div>
          `;
        }).join("")}
      </div>
      <div class="diagnostic-meta">
        <span>任务 ${node.metrics?.totalThreads ?? node.threads?.length ?? 0}</span>
        <span>运行 ${node.metrics?.running ?? 0}</span>
        <span>未读 ${health.unreadNotifications ?? 0}</span>
        <span>命令 ${Number(counts.queued ?? 0) + Number(counts.leased ?? 0)} 等待 / ${counts.failed ?? 0} 失败</span>
      </div>
      ${latest ? `
        <div class="diagnostic-latest">
          <span>最近任务 · ${timeAgo(latest.at)}</span>
          <strong>${escapeHtml(threadTitle(latest))}</strong>
          <p>${escapeHtml(threadSummary(latest))}</p>
        </div>
      ` : `<p class="preview">没有可诊断的最近任务。</p>`}
      ${recent ? `
        <div class="diagnostic-command">
          <span>最近命令</span>
          <strong>${escapeHtml(recent.kind)} · ${escapeHtml(recent.status)}</strong>
          <p>${escapeHtml(recent.error || timeAgo(recent.completedAt || recent.leasedAt || recent.createdAt))}</p>
        </div>
      ` : ""}
    </article>
  `;
}

function renderDetail() {
  const dashboard = state.dashboard;
  if (!dashboard) return;
  if (isEditingDetail()) return;
  const node = dashboard.nodes.find((item) => item.id === state.selectedNodeId);
  if (!node) {
    dom.detailContent.innerHTML = `<p class="empty-detail">选择一个节点或任务查看详情。</p>`;
    return;
  }
  const selectedThread = node.threads.find((thread) => thread.id === state.selectedThreadId)
    ?? (node.attention ?? []).find((thread) => thread.id === state.selectedThreadId)
    ?? null;
  const status = statusLabel(node);
  dom.detailContent.innerHTML = `
    <div class="detail-hero">
      <div>
        <h2>${escapeHtml(selectedThread ? threadTitle(selectedThread) : node.name)}</h2>
        <p>${selectedThread ? "任务详情" : "最近任务"}</p>
      </div>
      <span class="status-chip ${selectedThread ? threadStatus(selectedThread).className : status.className}">${selectedThread ? threadStatus(selectedThread).text : status.text}</span>
    </div>
    ${node.lastError ? `<p class="preview">${escapeHtml(node.lastError)}</p>` : ""}
    ${selectedThread ? renderThreadDetail(node, selectedThread) : `${renderNodeManagement(node)}${renderThreadList(node)}`}
  `;
}

function renderNodeManagement(node) {
  const tags = (node.tags ?? []).join(", ");
  const credential = state.nodeCredentials.get(node.id);
  const nodeLogs = (state.auditLogs ?? [])
    .filter((entry) => entry.details?.nodeId === node.id)
    .slice(0, 6);
  return `
    <section class="device-admin">
      <div class="detail-meta">
        <div><span>主机</span><strong>${escapeHtml(hostLabel(node))}</strong></div>
        <div><span>最后上报</span><strong>${timeAgo(node.lastSeenAt)}</strong></div>
        <div><span>版本</span><strong>${escapeHtml(node.version || "未知")}</strong></div>
        <div><span>状态</span><strong>${node.revokedAt ? `已吊销 · ${timeAgo(node.revokedAt)}` : "可用"}</strong></div>
      </div>
      <div class="admin-form">
        <label>
          <span>显示名称</span>
          <input id="nodeNameInput" value="${escapeHtml(node.name)}" />
        </label>
        <label>
          <span>分组标签</span>
          <input id="nodeTagsInput" value="${escapeHtml(tags)}" placeholder="例如：香港, Windows, 生产" />
        </label>
        <div class="quick-actions">
          <button class="primary-button" data-update-node="${escapeHtml(node.id)}">保存设备信息</button>
          <button class="secondary-button" data-rotate-node-key="${escapeHtml(node.id)}">重置设备密钥</button>
          <button class="danger-button" data-revoke-node="${escapeHtml(node.id)}">吊销此设备</button>
        </div>
      </div>
      ${credential ? `
        <div class="credential-box">
          <strong>新设备密钥</strong>
          <p>只显示一次。对应电脑需要用这个密钥重新配置后才能继续上报。</p>
          <textarea id="nodeKeyOutput" readonly>${escapeHtml(credential.nodeKey)}</textarea>
          <button class="secondary-button" data-copy-target="nodeKeyOutput">复制设备密钥</button>
        </div>
      ` : ""}
      <div class="audit-panel">
        <div class="section-head compact">
          <div>
            <h3>操作日志</h3>
            <p>最近设备相关操作</p>
          </div>
        </div>
        ${nodeLogs.length ? nodeLogs.map((entry) => `
          <div class="audit-row">
            <strong>${escapeHtml(auditLabel(entry.type))}</strong>
            <span>${timeAgo(entry.at)} · ${escapeHtml(entry.actor || "system")}</span>
          </div>
        `).join("") : `<p class="preview">暂无设备操作记录。</p>`}
      </div>
    </section>
  `;
}

function renderThreadList(node) {
  if (node.threads.length === 0) {
    return `<h3>最近任务</h3><p class="preview">该节点还没有上报线程。</p>`;
  }
  const threads = [...node.threads].sort((a, b) => threadActivityTime(b) - threadActivityTime(a));
  return `
    <div class="thread-list compact">
      ${threads.slice(0, 8).map((thread) => {
        const status = threadStatus(thread);
        return `
          <button class="thread-row" data-detail-thread="${escapeHtml(thread.id)}">
            <div>
              <strong>${escapeHtml(threadTitle(thread))}</strong>
              <p>${escapeHtml(threadSummary(thread))}</p>
            </div>
            <span class="status-chip ${status.className}">${status.text}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderThreadDetail(node, thread) {
  const key = replyKey(node.id, thread.id);
  const draft = state.replyDrafts.get(key) ?? "";
  const finalMessage = String(thread.latestFinalMessage || "").trim();
  const progressMessage = String(thread.latestProgressMessage || "").trim();
  const latest = finalMessage || progressMessage || String(thread.latestMessage || "").trim();
  const latestLabel = finalMessage ? "最终回复" : progressMessage ? "处理中进度" : "最新进度";
  const latestAt = finalMessage ? thread.latestFinalMessageAt : progressMessage ? thread.latestProgressMessageAt : (thread.latestMessageAt || thread.updatedAt);
  const summary = threadSummary(thread);
  return `
    ${renderThreadTimeline(node, thread)}
    ${latest ? `
      <div class="latest-progress">
        <span>${latestLabel} · ${timeAgo(latestAt)}</span>
        <p>${escapeHtml(latest)}</p>
      </div>
    ` : ""}
    ${renderRecentMessages(thread)}
    <div class="thread-detail-body">
      <span>任务摘要</span>
      <p>${escapeHtml(summary)}</p>
    </div>
    ${renderCommandNotice(node, thread)}
    <div class="composer">
      <textarea id="replyText" data-reply-key="${escapeHtml(key)}" placeholder="输入要发送给该 Codex 线程的消息...">${escapeHtml(draft)}</textarea>
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
    await loadAuditLogs();
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

async function loadAuditLogs() {
  try {
    const payload = await apiFetch("/api/audit?limit=80");
    state.auditLogs = payload.auditLogs ?? [];
  } catch {
    state.auditLogs = [];
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
    } else if (payload.type === "commandResult" || payload.type === "commandQueued") {
      scheduleStateRefresh(payload.type === "commandResult" ? 200 : 1200);
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
  if (threadId) {
    markThreadNotificationsRead(nodeId, threadId);
  }
}

async function markThreadNotificationsRead(nodeId, threadId) {
  try {
    await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/notifications/read`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
  } catch {
    // Reading status is best effort; the task detail should still open.
  }
}

async function markAllNotificationsRead() {
  const nodes = state.dashboard?.nodes ?? [];
  await Promise.all(nodes.map((node) =>
    apiFetch(`/api/nodes/${encodeURIComponent(node.id)}/notifications/read`, {
      method: "POST",
      body: JSON.stringify({ all: true }),
    }).catch(() => null),
  ));
  showToast("已全部标记为已读");
  await loadState();
}

async function queueAction(nodeId, action) {
  await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
  showToast("已下发到桌面端队列，稍后显示执行结果");
  await loadState();
}

async function requestDesktopRefresh() {
  if (!isConfigured()) {
    await loadState();
    return;
  }
  const nodes = (state.dashboard?.nodes ?? []).filter((node) => node.status === "online");
  if (nodes.length === 0) {
    showToast("没有在线电脑，已刷新云端缓存");
    await loadState();
    return;
  }
  const results = await Promise.allSettled(nodes.map((node) =>
    apiFetch(`/api/nodes/${encodeURIComponent(node.id)}/actions`, {
      method: "POST",
      body: JSON.stringify({ kind: "refresh", provider: "codex" }),
    }),
  ));
  const queued = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - queued;
  showToast(failed > 0 ? `已请求 ${queued} 台电脑重新采集，${failed} 台失败` : `已请求 ${queued} 台电脑重新采集`);
  await loadState();
  scheduleFollowUpRefreshes();
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

async function rotateNodeKey(nodeId) {
  const payload = await apiFetch(`/api/nodes/${encodeURIComponent(nodeId)}/rotate-key`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (payload.credentials) {
    state.nodeCredentials.set(nodeId, payload.credentials);
  }
  showToast("设备密钥已重置");
  await loadState();
  openDetail(nodeId, null);
}

async function rotateInstallKey() {
  const payload = await apiFetch("/api/install-key/rotate", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.installProfile = payload.installProfile ?? state.installProfile;
  showToast("安装密钥已轮换，旧安装命令将失效");
  renderInstallProfile();
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

dom.refreshBtn.addEventListener("click", requestDesktopRefresh);
dom.statusFilter.addEventListener("change", render);
dom.nodeSearchInput?.addEventListener("input", () => {
  state.nodeQuery = dom.nodeSearchInput.value || "";
  renderNodes(state.dashboard?.nodes ?? []);
});
dom.closeDetailBtn.addEventListener("click", () => dom.detailPane.classList.remove("open"));
dom.markAllReadBtn?.addEventListener("click", markAllNotificationsRead);
dom.rotateInstallKeyBtn?.addEventListener("click", async () => {
  if (confirm("确定轮换安装密钥？旧安装命令会立刻失效，已经登记的电脑不受影响。")) {
    await rotateInstallKey();
  }
});

document.querySelectorAll("[data-inbox-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.inboxFilter = button.dataset.inboxFilter;
    renderAttention(state.dashboard?.nodes ?? []);
  });
});

document.addEventListener("click", async (event) => {
  const attentionCard = event.target.closest(".attention-card");
  if (attentionCard) {
    const nodeId = attentionCard.dataset.node;
    const threadId = attentionCard.dataset.thread;
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton || actionButton.dataset.action === "open") {
      openDetail(nodeId, threadId);
      setTimeout(() => document.querySelector("#replyText")?.focus(), 0);
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
    setTimeout(() => document.querySelector("#replyText")?.focus(), 0);
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
    state.replyDrafts.delete(replyKey(nodeId, threadId));
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
    const tags = document.querySelector("#nodeTagsInput")?.value?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
    await updateNode(nodeId, { name, tags });
    return;
  }

  const rotateNodeKeyButton = event.target.closest("[data-rotate-node-key]");
  if (rotateNodeKeyButton) {
    const nodeId = rotateNodeKeyButton.dataset.rotateNodeKey;
    if (confirm(`确定重置 ${nodeId} 的设备密钥？这台电脑需要重新配置新密钥后才能继续上线。`)) {
      await rotateNodeKey(nodeId);
    }
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

document.addEventListener("input", (event) => {
  const replyInput = event.target.closest("#replyText");
  if (replyInput?.dataset.replyKey) {
    state.replyDrafts.set(replyInput.dataset.replyKey, replyInput.value);
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
    dom.content.dataset.view = view;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    if (view === "nodes") document.querySelector(".nodes-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (view === "attention") document.querySelector(".attention-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (view === "diagnostics") document.querySelector(".diagnostics-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

await loadState();
