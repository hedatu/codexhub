const STORAGE_KEY = "codexhub.config.v1";
const LANGUAGE_KEY = "codexhub.health.language.v1";

const dom = {
  form: document.querySelector("#healthConfigForm"),
  server: document.querySelector("#healthServerInput"),
  token: document.querySelector("#healthTokenInput"),
  language: document.querySelector("#healthLanguage"),
  refresh: document.querySelector("#healthRefreshBtn"),
  summary: document.querySelector("#healthSummary"),
  checks: document.querySelector("#healthChecks"),
  details: document.querySelector("#healthDetails"),
};

const i18n = {
  zh: {
    refresh: "重新自检",
    save: "保存并检查",
    server: "服务器地址",
    token: "访问令牌",
    ok: "正常",
    warning: "注意",
    danger: "异常",
    unknown: "未知",
    unreachable: "无法访问",
    generated: "生成时间",
    overallOk: "系统健康，可以继续使用。",
    overallWarn: "系统可用，但有项目需要关注。",
    overallBad: "发现影响同步或控制的异常。",
    noToken: "未填写访问令牌，只能检查公开健康接口。",
    publicHealth: "公开健康接口",
    auth: "令牌权限",
    storage: "数据存储",
    backups: "服务器备份",
    push: "消息通知",
    update: "版本更新",
    nodes: "节点同步",
    commands: "命令队列",
    details: "详细数据",
    latestBackup: "最近备份",
    never: "从未",
    online: "在线",
    offline: "离线",
    failedCommands: "失败命令",
    queuedCommands: "等待命令",
    openManual: "打开故障排查手册",
  },
  en: {
    refresh: "Run Check",
    save: "Save and Check",
    server: "Server URL",
    token: "Access token",
    ok: "Healthy",
    warning: "Attention",
    danger: "Problem",
    unknown: "Unknown",
    unreachable: "Unreachable",
    generated: "Generated",
    overallOk: "System is healthy.",
    overallWarn: "System is usable, with items to review.",
    overallBad: "Problems may affect sync or remote control.",
    noToken: "No access token. Only the public health endpoint can be checked.",
    publicHealth: "Public health",
    auth: "Token access",
    storage: "Storage",
    backups: "Server backups",
    push: "Notifications",
    update: "Updates",
    nodes: "Node sync",
    commands: "Command queue",
    details: "Details",
    latestBackup: "Latest backup",
    never: "Never",
    online: "online",
    offline: "offline",
    failedCommands: "failed commands",
    queuedCommands: "queued commands",
    openManual: "Open troubleshooting manual",
  },
};

const state = {
  config: readConfig(),
  language: readLanguage(),
  loading: false,
  results: {},
};

function readConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { server: window.location.origin, token: "" };
  } catch {
    return { server: window.location.origin, token: "" };
  }
}

function saveConfig(config) {
  state.config = { server: config.server.replace(/\/+$/, ""), token: config.token };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function readLanguage() {
  return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh";
}

function t(key) {
  return i18n[state.language]?.[key] || i18n.zh[key] || key;
}

function apiUrl(path) {
  return `${state.config.server.replace(/\/+$/, "")}${path}`;
}

async function fetchJson(path, auth = true) {
  try {
    const headers = { "content-type": "application/json" };
    if (auth && state.config.token) headers.authorization = `Bearer ${state.config.token}`;
    const response = await fetch(apiUrl(path), { headers });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) return { ok: false, status: response.status, error: payload.error || response.statusText, payload };
    return { ok: true, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, payload: null };
  }
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
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeAgo(value) {
  const millis = toMillis(value);
  if (!millis) return t("never");
  const seconds = Math.max(0, Math.round((Date.now() - millis) / 1000));
  if (seconds < 10) return state.language === "en" ? "just now" : "刚刚";
  if (seconds < 60) return state.language === "en" ? `${seconds}s ago` : `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return state.language === "en" ? `${minutes}m ago` : `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return state.language === "en" ? `${hours}h ago` : `${hours} 小时前`;
  return new Date(millis).toLocaleString();
}

function check(label, stateName, detail, meta = "") {
  return { label, state: stateName, detail, meta };
}

function classifyChecks() {
  const { health, dashboard, security, backups, update } = state.results;
  const checks = [];
  checks.push(check(
    t("publicHealth"),
    health.ok && health.payload?.ok ? "ok" : "danger",
    health.ok ? `${state.config.server} · v${health.payload?.version || "?"}` : health.error || t("unreachable"),
  ));

  checks.push(check(
    t("auth"),
    state.config.token ? (dashboard.ok ? "ok" : "danger") : "warning",
    state.config.token ? (dashboard.ok ? "READ/API token accepted" : dashboard.error || "Unauthorized") : t("noToken"),
  ));

  const storage = security.payload?.storage || health.payload?.storage || {};
  const storageState = storage.driver === "sqlite" ? (storage.sqliteEnabled ? "ok" : "danger") : "warning";
  checks.push(check(
    t("storage"),
    storageState,
    storage.driver === "sqlite"
      ? (storage.sqliteEnabled ? `SQLite · ${storage.sqliteFile || storage.file || ""}` : storage.sqliteNote || "SQLite unavailable")
      : `${storage.driver || "json"} · ${storage.sqliteNote || "建议迁移到 SQLite"}`,
  ));

  const backupList = Array.isArray(backups.payload?.backups) ? backups.payload.backups : [];
  const latestBackup = backupList[0];
  const backupAge = latestBackup ? Date.now() - toMillis(latestBackup.modifiedAt) : Infinity;
  const backupState = backups.ok ? (!latestBackup ? "warning" : backupAge > 7 * 24 * 60 * 60 * 1000 ? "danger" : backupAge > 36 * 60 * 60 * 1000 ? "warning" : "ok") : "warning";
  checks.push(check(
    t("backups"),
    backupState,
    backups.ok ? `${t("latestBackup")}: ${latestBackup ? timeAgo(latestBackup.modifiedAt) : t("never")} · ${backups.payload?.backupDir || ""}` : backups.error || "Admin token required",
  ));

  const push = security.payload?.push || health.payload?.push || {};
  checks.push(check(
    t("push"),
    push.fcmConfigured ? "ok" : "warning",
    push.fcmConfigured
      ? `FCM ready · ${push.subscriptions || 0} subscriptions`
      : `FCM not configured · webhook ${push.webhookConfigured ? "ready" : "off"} · ${push.subscriptions || 0} subscriptions`,
  ));

  checks.push(check(
    t("update"),
    update.ok ? (update.payload?.updateAvailable ? "warning" : "ok") : "warning",
    update.ok
      ? (update.payload?.updateAvailable ? `v${update.payload.currentVersion} -> v${update.payload.latestVersion}` : `v${update.payload.currentVersion || "?"}`)
      : update.error || t("unknown"),
  ));

  const nodes = Array.isArray(dashboard.payload?.nodes) ? dashboard.payload.nodes : [];
  const online = nodes.filter((node) => node.status === "online").length;
  const offline = nodes.length - online;
  const healthProblems = nodes.flatMap((node) => node.syncHealth?.checks || []).filter((item) => item.state === "danger");
  checks.push(check(
    t("nodes"),
    nodes.length === 0 ? "warning" : healthProblems.length > 0 ? "danger" : offline > 0 ? "warning" : "ok",
    `${online} ${t("online")} · ${offline} ${t("offline")} · ${healthProblems.length} health issues`,
  ));

  const commandCounts = nodes.reduce((acc, node) => {
    const counts = node.syncHealth?.commandCounts || {};
    for (const key of ["queued", "leased", "failed", "stuck", "requeued"]) acc[key] += Number(counts[key] || 0);
    return acc;
  }, { queued: 0, leased: 0, failed: 0, stuck: 0, requeued: 0 });
  checks.push(check(
    t("commands"),
    commandCounts.failed + commandCounts.stuck > 0 ? "danger" : commandCounts.queued + commandCounts.leased > 0 ? "warning" : "ok",
    `${commandCounts.failed} ${t("failedCommands")} · ${commandCounts.queued + commandCounts.leased} ${t("queuedCommands")} · retry ${commandCounts.requeued}`,
  ));

  return checks;
}

function overall(checks) {
  if (checks.some((item) => item.state === "danger")) return "danger";
  if (checks.some((item) => item.state === "warning")) return "warning";
  return "ok";
}

function render() {
  dom.server.value = state.config.server || window.location.origin;
  dom.token.value = state.config.token || "";
  dom.language.value = state.language;
  dom.refresh.textContent = state.loading ? "..." : t("refresh");
  dom.form.querySelector("button").textContent = t("save");
  dom.form.querySelectorAll("span")[0].textContent = t("server");
  dom.form.querySelectorAll("span")[1].textContent = t("token");

  if (state.loading) {
    dom.summary.innerHTML = `<article class="health-overall warning"><strong>${escapeHtml(t("unknown"))}</strong><span>Checking...</span></article>`;
    return;
  }

  const checks = classifyChecks();
  const tone = overall(checks);
  const headline = tone === "danger" ? t("overallBad") : tone === "warning" ? t("overallWarn") : t("overallOk");
  dom.summary.innerHTML = `
    <article class="health-overall ${tone}">
      <strong>${escapeHtml(t(tone))}</strong>
      <span>${escapeHtml(headline)}</span>
      <em>${escapeHtml(t("generated"))}: ${escapeHtml(new Date().toLocaleString())}</em>
    </article>
  `;
  dom.checks.innerHTML = checks.map((item) => `
    <article class="health-check ${item.state}">
      <span>${escapeHtml(t(item.state))}</span>
      <h2>${escapeHtml(item.label)}</h2>
      <p>${escapeHtml(item.detail)}</p>
    </article>
  `).join("");

  const nodes = state.results.dashboard.payload?.nodes || [];
  dom.details.innerHTML = `
    <header>
      <h2>${escapeHtml(t("details"))}</h2>
      <a href="https://github.com/hedatu/codexhub/blob/main/docs/TROUBLESHOOTING.zh-CN.md" target="_blank" rel="noreferrer">${escapeHtml(t("openManual"))}</a>
    </header>
    <div class="health-table-wrap">
      <table>
        <thead><tr><th>Node</th><th>Status</th><th>Last seen</th><th>Farfield</th><th>Codex</th><th>Commands</th></tr></thead>
        <tbody>
          ${nodes.length ? nodes.map((node) => {
            const checksByKey = Object.fromEntries((node.syncHealth?.checks || []).map((item) => [item.key, item]));
            const counts = node.syncHealth?.commandCounts || {};
            return `<tr>
              <td>${escapeHtml(node.name || node.id)}</td>
              <td>${escapeHtml(node.status || "unknown")}</td>
              <td>${escapeHtml(timeAgo(node.lastSeenAt))}</td>
              <td>${escapeHtml(checksByKey.farfield?.detail || "-")}</td>
              <td>${escapeHtml(checksByKey.codex?.detail || "-")}</td>
              <td>${escapeHtml(`${counts.queued || 0} queued · ${counts.leased || 0} leased · ${counts.failed || 0} failed`)}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="6">No nodes</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function runCheck() {
  state.loading = true;
  render();
  const needsAuth = Boolean(state.config.token);
  const [health, dashboard, security, backups, update] = await Promise.all([
    fetchJson("/api/health", false),
    needsAuth ? fetchJson("/api/state") : Promise.resolve({ ok: false, error: t("noToken"), payload: {} }),
    needsAuth ? fetchJson("/api/security/status") : Promise.resolve({ ok: false, error: t("noToken"), payload: {} }),
    needsAuth ? fetchJson("/api/backups") : Promise.resolve({ ok: false, error: t("noToken"), payload: {} }),
    needsAuth ? fetchJson("/api/update/check") : Promise.resolve({ ok: false, error: t("noToken"), payload: {} }),
  ]);
  state.results = { health, dashboard, security, backups, update };
  state.loading = false;
  render();
}

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfig({ server: dom.server.value.trim() || window.location.origin, token: dom.token.value.trim() });
  void runCheck();
});

dom.refresh.addEventListener("click", () => runCheck());
dom.language.addEventListener("change", () => {
  state.language = dom.language.value === "en" ? "en" : "zh";
  localStorage.setItem(LANGUAGE_KEY, state.language);
  document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
  render();
});

state.results = {
  health: { ok: false, error: t("unknown"), payload: {} },
  dashboard: { ok: false, error: t("unknown"), payload: {} },
  security: { ok: false, error: t("unknown"), payload: {} },
  backups: { ok: false, error: t("unknown"), payload: {} },
  update: { ok: false, error: t("unknown"), payload: {} },
};

void runCheck();
