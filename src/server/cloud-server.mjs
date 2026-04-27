import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createSign, randomBytes, randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.CODEXHUB_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.CODEXHUB_HOST ?? "0.0.0.0";
const PUBLIC_URL = process.env.CODEXHUB_PUBLIC_URL ? stripSlash(process.env.CODEXHUB_PUBLIC_URL) : "";
const ADMIN_TOKEN = process.env.CODEXHUB_ADMIN_TOKEN ?? process.env.CODEXHUB_TOKEN ?? "dev-token";
const READONLY_TOKEN = process.env.CODEXHUB_READONLY_TOKEN ?? "";
const DEFAULT_INSTALL_KEY = process.env.CODEXHUB_INSTALL_KEY ?? process.env.CODEXHUB_TOKEN ?? ADMIN_TOKEN;
const DATA_FILE = process.env.CODEXHUB_DATA_FILE
  ? path.resolve(process.env.CODEXHUB_DATA_FILE)
  : null;
const OFFLINE_AFTER_MS = Number(process.env.CODEXHUB_OFFLINE_AFTER_MS ?? 45_000);
const COMMAND_TTL_MS = Number(process.env.CODEXHUB_COMMAND_TTL_MS ?? 10 * 60_000);
const COMMAND_LEASE_MS = Number(process.env.CODEXHUB_COMMAND_LEASE_MS ?? 60_000);
const RELEASE_VERSION = process.env.CODEXHUB_VERSION ?? "0.4.6";
const STORAGE_DRIVER = (process.env.CODEXHUB_STORAGE ?? "json").toLowerCase();
const SQLITE_FILE = process.env.CODEXHUB_SQLITE_FILE
  ? path.resolve(process.env.CODEXHUB_SQLITE_FILE)
  : path.join(ROOT, "data", "codexhub.db");
const PUSH_WEBHOOK_URL = process.env.CODEXHUB_PUSH_WEBHOOK_URL ?? "";
const FCM_SERVICE_ACCOUNT_FILE = process.env.CODEXHUB_FCM_SERVICE_ACCOUNT_FILE ? path.resolve(process.env.CODEXHUB_FCM_SERVICE_ACCOUNT_FILE) : "";
const FCM_SERVICE_ACCOUNT_JSON = process.env.CODEXHUB_FCM_SERVICE_ACCOUNT_JSON ?? "";
const FCM_PROJECT_ID = process.env.CODEXHUB_FCM_PROJECT_ID ?? "";
const FIREBASE_WEB_CONFIG = process.env.CODEXHUB_FIREBASE_WEB_CONFIG ?? "";
const FIREBASE_VAPID_KEY = process.env.CODEXHUB_FIREBASE_VAPID_KEY ?? "";
const AGENT_UPDATE_POLICY = process.env.CODEXHUB_AGENT_UPDATE_POLICY ?? "prompt";
const REPORT_TZ_OFFSET_MINUTES = Number(process.env.CODEXHUB_REPORT_TZ_OFFSET_MINUTES ?? 480);
const SQLITE_MIN_PERSIST_MS = Number(process.env.CODEXHUB_SQLITE_MIN_PERSIST_MS ?? 15_000);
let sqliteAvailable = null;
let lastSqlitePersistAt = 0;
let fcmAccessToken = null;
let fcmAccessTokenExpiresAt = 0;

const state = {
  startedAt: new Date().toISOString(),
  nodes: new Map(),
  auditLogs: [],
  pushSubscriptions: [],
  installKey: DEFAULT_INSTALL_KEY,
  sseClients: new Set(),
};

function nowIso() {
  return new Date().toISOString();
}

function reportDay() {
  const now = Date.now();
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60_000;
  const shifted = new Date(now + offsetMs);
  const date = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const startMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - offsetMs;
  return { date, startMs, offsetMinutes: REPORT_TZ_OFFSET_MINUTES };
}

function stripSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sqlString(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqliteCanRun() {
  if (sqliteAvailable != null) return sqliteAvailable;
  const result = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  sqliteAvailable = result.status === 0;
  return sqliteAvailable;
}

function sqliteExec(sql) {
  if (STORAGE_DRIVER !== "sqlite") return { ok: false, skipped: true };
  if (!sqliteCanRun()) return { ok: false, error: "sqlite3 command not found" };
  fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
  const result = spawnSync("sqlite3", ["-batch", SQLITE_FILE], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { ok: false, error: result.stderr || result.stdout || `sqlite3 exited ${result.status}` };
  }
  return { ok: true, stdout: result.stdout };
}

function sqliteQuery(sql) {
  if (STORAGE_DRIVER !== "sqlite" || !sqliteCanRun() || !fs.existsSync(SQLITE_FILE)) return "";
  const result = spawnSync("sqlite3", ["-batch", "-noheader", SQLITE_FILE], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : "";
}

function sqliteSchemaSql() {
  return `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS state_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, saved_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, name TEXT, status TEXT, last_seen_at TEXT, version TEXT, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, thread_id TEXT, type TEXT, read_at TEXT, created_at TEXT, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, actor TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_notifications_node_read ON notifications(node_id, read_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs(at);
`;
}

function applyLoadedState(parsed) {
  if (!parsed || !Array.isArray(parsed.nodes)) return false;
  state.nodes.clear();
  for (const node of parsed.nodes) {
    if (node && typeof node.id === "string") {
      state.nodes.set(node.id, {
        ...node,
        commands: Array.isArray(node.commands) ? node.commands : [],
      });
    }
  }
  if (Array.isArray(parsed.auditLogs)) {
    state.auditLogs = parsed.auditLogs.slice(-500);
  }
  if (Array.isArray(parsed.pushSubscriptions)) {
    state.pushSubscriptions = parsed.pushSubscriptions.slice(-200);
  }
  if (typeof parsed.installKey === "string" && parsed.installKey.trim()) {
    state.installKey = parsed.installKey.trim();
  }
  return true;
}

function loadSqliteState() {
  if (STORAGE_DRIVER !== "sqlite") return false;
  sqliteExec(sqliteSchemaSql());
  const output = sqliteQuery("SELECT payload FROM state_snapshots ORDER BY id DESC LIMIT 1;\n");
  const parsed = safeJsonParse(output.trim());
  return applyLoadedState(parsed);
}

function loadState() {
  if (loadSqliteState()) return;
  if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
  const parsed = safeJsonParse(fs.readFileSync(DATA_FILE, "utf8"));
  applyLoadedState(parsed);
}

function persistState() {
  const payload = {
    savedAt: nowIso(),
    schemaVersion: 2,
    storageDriver: STORAGE_DRIVER,
    installKey: state.installKey,
    auditLogs: state.auditLogs.slice(-500),
    pushSubscriptions: state.pushSubscriptions.slice(-200),
    nodes: [...state.nodes.values()].map((node) => ({
      ...node,
      commands: node.commands.filter((command) => command.status !== "done"),
    })),
  };
  if (DATA_FILE) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
  }
  persistSqliteState(payload);
}

function persistSqliteState(payload) {
  if (STORAGE_DRIVER !== "sqlite") return;
  const now = Date.now();
  if (SQLITE_MIN_PERSIST_MS > 0 && lastSqlitePersistAt && now - lastSqlitePersistAt < SQLITE_MIN_PERSIST_MS) return;
  lastSqlitePersistAt = now;
  const savedAt = payload.savedAt;
  const statements = [sqliteSchemaSql(), "BEGIN;"];
  statements.push(`INSERT OR REPLACE INTO state_snapshots(id,saved_at,payload) VALUES(1,${sqlString(savedAt)},${sqlString(JSON.stringify(payload))});`);
  statements.push("DELETE FROM state_snapshots WHERE id != 1;");
  statements.push(`INSERT OR REPLACE INTO meta(key,value,updated_at) VALUES('installKey',${sqlString(payload.installKey)},${sqlString(savedAt)});`);
  statements.push(`INSERT OR REPLACE INTO meta(key,value,updated_at) VALUES('schemaVersion','2',${sqlString(savedAt)});`);
  statements.push("DELETE FROM nodes;");
  statements.push("DELETE FROM notifications;");
  statements.push("DELETE FROM audit_logs;");
  for (const node of payload.nodes) {
    const publicStatus = getNodeStatus(node);
    statements.push(`INSERT OR REPLACE INTO nodes(id,name,status,last_seen_at,version,payload,updated_at) VALUES(${sqlString(node.id)},${sqlString(node.name ?? node.id)},${sqlString(publicStatus)},${sqlString(node.lastSeenAt ?? "")},${sqlString(node.version ?? "")},${sqlString(JSON.stringify(node))},${sqlString(savedAt)});`);
    for (const notice of node.notifications ?? []) {
      statements.push(`INSERT OR REPLACE INTO notifications(id,node_id,thread_id,type,read_at,created_at,payload) VALUES(${sqlString(notice.id)},${sqlString(node.id)},${sqlString(notice.threadId ?? "")},${sqlString(notice.type ?? "")},${sqlString(notice.readAt ?? "")},${sqlString(notice.createdAt ?? "")},${sqlString(JSON.stringify(notice))});`);
    }
  }
  for (const entry of payload.auditLogs) {
    statements.push(`INSERT OR REPLACE INTO audit_logs(id,at,type,actor,payload) VALUES(${sqlString(entry.id)},${sqlString(entry.at)},${sqlString(entry.type)},${sqlString(entry.actor ?? "")},${sqlString(JSON.stringify(entry))});`);
  }
  statements.push("COMMIT;");
  const result = sqliteExec(statements.join("\n"));
  if (!result.ok && !result.skipped) {
    console.error(`SQLite persist failed: ${result.error}`);
  }
}

function getPresentedToken(req, url) {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return req.headers["x-codexhub-token"] ?? url.searchParams.get("token") ?? "";
}

function isAdminAuthed(req, url) {
  return getPresentedToken(req, url) === ADMIN_TOKEN;
}

function isReadAuthed(req, url) {
  const token = getPresentedToken(req, url);
  return token === ADMIN_TOKEN || (READONLY_TOKEN && token === READONLY_TOKEN);
}

function isInstallAuthed(req, url, body = null) {
  return (
    getPresentedToken(req, url) === state.installKey ||
    body?.installKey === state.installKey ||
    body?.install_key === state.installKey
  );
}

function isNodeAuthed(node, req, url) {
  if (node?.revokedAt) return false;
  const token = getPresentedToken(req, url);
  if (node?.deviceKey && token === node.deviceKey) return true;
  return !node?.deviceKey && token === ADMIN_TOKEN;
}

function createSecret(prefix) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function rotateInstallKey() {
  state.installKey = createSecret("ck_install");
  recordAudit("install_key.rotated", "admin", {});
  persistState();
  sendEvent({ type: "state", state: dashboardState() });
  return state.installKey;
}

function recordAudit(type, actor, details = {}) {
  const entry = {
    id: randomUUID(),
    at: nowIso(),
    type,
    actor,
    details,
  };
  state.auditLogs.push(entry);
  if (state.auditLogs.length > 500) {
    state.auditLogs.splice(0, state.auditLogs.length - 500);
  }
  sendEvent({ type: "audit", entry });
  return entry;
}

function storageStatus() {
  return {
    driver: STORAGE_DRIVER,
    file: STORAGE_DRIVER === "sqlite" ? SQLITE_FILE : DATA_FILE,
    jsonFile: DATA_FILE,
    sqliteFile: SQLITE_FILE,
    sqliteEnabled: STORAGE_DRIVER === "sqlite" && sqliteCanRun(),
    sqliteNote: STORAGE_DRIVER === "sqlite"
      ? sqliteCanRun()
        ? "SQLite mode is active. JSON snapshots are still kept as a compatible fallback."
        : "SQLite mode is configured but sqlite3 was not found; install sqlite3 or switch back to JSON."
      : "JSON file mode is active. Set CODEXHUB_STORAGE=sqlite in a future migration window to enable SQLite-backed history.",
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeJson(res, status, body, extraHeaders = {}) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-codexhub-token",
    ...extraHeaders,
  });
  res.end(encoded);
}

function getPublicBaseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket.encrypted ? "https" : "http");
  const host = forwardedHost || req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function buildInstallProfile(req) {
  const publicBaseUrl = getPublicBaseUrl(req);
  const downloads = {
    androidApk: `${publicBaseUrl}/downloads/codexhub-android-v${RELEASE_VERSION}.apk`,
    windowsAgent: `${publicBaseUrl}/downloads/codexhub-windows-agent-v${RELEASE_VERSION}.zip`,
    linuxAgent: `${publicBaseUrl}/downloads/codexhub-linux-agent-v${RELEASE_VERSION}.zip`,
    macosAgent: `${publicBaseUrl}/downloads/codexhub-macos-agent-v${RELEASE_VERSION}.zip`,
    server: `${publicBaseUrl}/downloads/codexhub-server-v${RELEASE_VERSION}.zip`,
    companionInstaller: `${publicBaseUrl}/downloads/codexhub-companion-installer-windows-x64-v${RELEASE_VERSION}.exe`,
  };
  const windowsCommand = [
    `$u="${downloads.windowsAgent}"; $z="$env:TEMP\\codexhub-windows-agent-v${RELEASE_VERSION}.zip"; $d="$env:TEMP\\codexhub-agent-v${RELEASE_VERSION}"; Invoke-WebRequest $u -OutFile $z; Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive $z -DestinationPath $d -Force; Set-Location $d; powershell -ExecutionPolicy Bypass -File .\\scripts\\install-desktop-agent.ps1`,
    `  -Server "${publicBaseUrl}"`,
    `  -InstallKey "${state.installKey}"`,
    '  -NodeId "TMT1"',
    '  -NodeName "TMT1"',
  ].join(" `\n");
  const linuxCommand = [
    `tmp=$(mktemp -d) && curl -fsSL "${downloads.linuxAgent}" -o "$tmp/codexhub-linux-agent.zip" && unzip -q "$tmp/codexhub-linux-agent.zip" -d "$tmp/codexhub-linux-agent" && cd "$tmp/codexhub-linux-agent" && bash ./scripts/install-linux-agent.sh`,
    `  --server "${publicBaseUrl}"`,
    `  --install-key "${state.installKey}"`,
    '  --node-id "$(hostname)"',
    '  --node-name "$(hostname)"',
  ].join(" \\\n");
  const macosCommand = [
    `tmp=$(mktemp -d) && curl -fsSL "${downloads.macosAgent}" -o "$tmp/codexhub-macos-agent.zip" && unzip -q "$tmp/codexhub-macos-agent.zip" -d "$tmp/codexhub-macos-agent" && cd "$tmp/codexhub-macos-agent" && bash ./scripts/install-macos-agent.sh`,
    `  --server "${publicBaseUrl}"`,
    `  --install-key "${state.installKey}"`,
    '  --node-id "$(scutil --get ComputerName)"',
    '  --node-name "$(scutil --get ComputerName)"',
  ].join(" \\\n");

  return {
    ok: true,
    version: RELEASE_VERSION,
    updatePolicy: AGENT_UPDATE_POLICY,
    serverUrl: publicBaseUrl,
    adminToken: ADMIN_TOKEN,
    readonlyToken: READONLY_TOKEN || null,
    installKey: state.installKey,
    downloads,
    desktop: {
      powershell: windowsCommand,
      windows: windowsCommand,
      linux: linuxCommand,
      macos: macosCommand,
    },
    mobile: {
      serverUrl: publicBaseUrl,
      token: ADMIN_TOKEN,
    },
  };
}

function sendEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of state.sseClients) {
    try {
      client.write(payload);
    } catch {
      state.sseClients.delete(client);
    }
  }
}

async function postJsonExternal(url, payload, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, text: await response.text().catch(() => "") };
  } finally {
    clearTimeout(timeout);
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function loadFcmServiceAccount() {
  const raw = FCM_SERVICE_ACCOUNT_JSON || (FCM_SERVICE_ACCOUNT_FILE && fs.existsSync(FCM_SERVICE_ACCOUNT_FILE)
    ? fs.readFileSync(FCM_SERVICE_ACCOUNT_FILE, "utf8")
    : "");
  const parsed = raw ? safeJsonParse(raw) : null;
  if (!parsed?.client_email || !parsed?.private_key) return null;
  return parsed;
}

function fcmProjectId(account = loadFcmServiceAccount()) {
  return FCM_PROJECT_ID || account?.project_id || "";
}

async function getFcmAccessToken() {
  if (fcmAccessToken && Date.now() < fcmAccessTokenExpiresAt - 60_000) return fcmAccessToken;
  const account = loadFcmServiceAccount();
  if (!account) throw new Error("FCM service account is not configured");
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `FCM OAuth failed: ${response.status}`);
  }
  fcmAccessToken = payload.access_token;
  fcmAccessTokenExpiresAt = Date.now() + Number(payload.expires_in ?? 3600) * 1000;
  return fcmAccessToken;
}

function fcmConfigured() {
  const account = loadFcmServiceAccount();
  return Boolean(account && fcmProjectId(account));
}

async function sendFcmMessage(token, notification) {
  const account = loadFcmServiceAccount();
  const projectId = fcmProjectId(account);
  if (!projectId) throw new Error("FCM project id is missing");
  const accessToken = await getFcmAccessToken();
  const publicUrl = PUBLIC_URL || "";
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: notification.title || "CodexHub",
          body: notification.preview || "有新的待处理事项",
        },
        data: {
          nodeId: String(notification.nodeId || ""),
          threadId: String(notification.threadId || ""),
          type: String(notification.type || "notification"),
          url: "/",
        },
        webpush: publicUrl ? {
          fcm_options: { link: publicUrl },
        } : undefined,
      },
    }),
  });
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, text };
}

async function deliverNotification(notification) {
  const payload = {
    version: RELEASE_VERSION,
    sentAt: nowIso(),
    notification,
  };
  const deliveries = [];
  if (PUSH_WEBHOOK_URL) {
    deliveries.push(postJsonExternal(PUSH_WEBHOOK_URL, payload).then((result) => ({ provider: "webhook", ...result })));
  }
  const fcmTokens = state.pushSubscriptions
    .filter((item) => item.type === "fcm" && item.token && !item.revokedAt)
    .map((item) => item.token);
  if (fcmConfigured() && fcmTokens.length > 0) {
    for (const token of fcmTokens.slice(0, 500)) {
      deliveries.push(sendFcmMessage(token, notification).then((result) => ({ provider: "fcm", ...result })));
    }
  }
  if (deliveries.length === 0) return;
  const results = await Promise.allSettled(deliveries);
  recordAudit("push.delivered", "system", {
    type: notification.type,
    nodeId: notification.nodeId,
    threadId: notification.threadId,
    results: results.map((result) => result.status === "fulfilled" ? result.value : { ok: false, error: String(result.reason) }),
  });
}

function notifyExternal(node, notice) {
  deliverNotification({
    ...notice,
    nodeId: node.id,
    nodeName: node.name ?? node.id,
  }).catch((error) => {
    recordAudit("push.failed", "system", { nodeId: node.id, error: error instanceof Error ? error.message : String(error) });
  });
}

function getNodeStatus(node) {
  if (node?.revokedAt) return "revoked";
  if (!node?.lastSeenAt) return "offline";
  return Date.now() - Date.parse(node.lastSeenAt) > OFFLINE_AFTER_MS ? "offline" : "online";
}

function valueTime(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortThreads(threads) {
  const activityTime = (thread) =>
    valueTime(thread.latestFinalMessageAt ?? thread.latestProgressMessageAt ?? thread.latestMessageAt ?? thread.updatedAt ?? thread.createdAt);
  return [...threads].sort((a, b) => activityTime(b) - activityTime(a));
}

function buildSyncHealth(node, status, threads, unread) {
  const commands = Array.isArray(node.commands) ? node.commands : [];
  const farfield = node.farfield && typeof node.farfield === "object" ? node.farfield : {};
  const latestThread = threads[0] ?? null;
  const latestThreadAt = latestThread
    ? latestThread.latestFinalMessageAt ?? latestThread.latestProgressMessageAt ?? latestThread.latestMessageAt ?? latestThread.updatedAt ?? latestThread.createdAt ?? null
    : null;
  const commandCounts = {
    queued: commands.filter((command) => command.status === "queued").length,
    leased: commands.filter((command) => command.status === "leased").length,
    done: commands.filter((command) => command.status === "done").length,
    failed: commands.filter((command) => command.status === "failed").length,
  };
  const recentCommand = [...commands]
    .sort((a, b) => valueTime(b.completedAt ?? b.leasedAt ?? b.createdAt) - valueTime(a.completedAt ?? a.leasedAt ?? a.createdAt))[0] ?? null;
  const checks = [
    {
      key: "cloud",
      label: "云端上报",
      state: status === "online" ? "ok" : "danger",
      detail: status === "online" ? "电脑端正在上报" : "超过同步窗口未上报",
      at: node.lastSeenAt ?? null,
    },
    {
      key: "farfield",
      label: "Farfield 本地服务",
      state: farfield.ok ? "ok" : "danger",
      detail: farfield.ok ? "可访问本地 Codex 网关" : String(farfield.lastError ?? node.lastError ?? "本地服务不可用"),
      at: node.lastSeenAt ?? null,
    },
    {
      key: "codex",
      label: "Codex 会话读取",
      state: latestThread ? "ok" : "warning",
      detail: latestThread ? `最近任务 ${latestThread.isGenerating ? "运行中" : "已同步"}` : "还没有读到 Codex 会话",
      at: latestThreadAt,
    },
    {
      key: "commands",
      label: "命令回执",
      state: commandCounts.failed > 0 ? "danger" : (commandCounts.queued + commandCounts.leased > 0 ? "warning" : "ok"),
      detail: commandCounts.failed > 0
        ? `${commandCounts.failed} 条命令失败`
        : commandCounts.queued + commandCounts.leased > 0
          ? `${commandCounts.queued + commandCounts.leased} 条命令等待桌面端回执`
          : "命令队列正常",
      at: recentCommand?.completedAt ?? recentCommand?.leasedAt ?? recentCommand?.createdAt ?? null,
    },
    {
      key: "notifications",
      label: "未读通知",
      state: unread.length > 0 ? "warning" : "ok",
      detail: unread.length > 0 ? `${unread.length} 条未读等待处理` : "没有未读事项",
      at: unread[0]?.createdAt ?? null,
    },
  ];
  const overall = checks.some((check) => check.state === "danger") ? "danger" : checks.some((check) => check.state === "warning") ? "warning" : "ok";
  return {
    overall,
    checks,
    lastSeenAgeMs: valueTime(node.lastSeenAt) ? Math.max(0, Date.now() - valueTime(node.lastSeenAt)) : null,
    heartbeatSeq: node.heartbeatSeq ?? null,
    collectedAt: node.collectedAt ?? null,
    agentStartedAt: node.agentStartedAt ?? null,
    agentLastErrorAt: node.agentLastErrorAt ?? null,
    latestThread: latestThread ? {
      id: latestThread.id,
      title: latestThread.title ?? null,
      preview: latestThread.preview ?? latestThread.latestMessage ?? "",
      at: latestThreadAt,
      isGenerating: Boolean(latestThread.isGenerating),
      waitingOnApproval: Boolean(latestThread.waitingOnApproval),
      waitingOnUserInput: Boolean(latestThread.waitingOnUserInput),
    } : null,
    commandCounts,
    recentCommand: recentCommand ? {
      id: recentCommand.id,
      status: recentCommand.status,
      kind: recentCommand.action?.kind ?? "command",
      createdAt: recentCommand.createdAt,
      leasedAt: recentCommand.leasedAt ?? null,
      completedAt: recentCommand.completedAt ?? null,
      error: recentCommand.result?.error ?? recentCommand.result?.result?.error ?? null,
    } : null,
    unreadNotifications: unread.length,
  };
}

function deriveThreadState(thread) {
  if (thread.attentionKind === "commandFailed") return "failed";
  if (thread.attentionKind === "completed") return thread.readAt ? "archived" : "completed_unread";
  if (thread.attentionKind === "updated") return thread.readAt ? "archived" : "completed_unread";
  if (thread.waitingOnApproval) return "waiting_approval";
  if (thread.waitingOnUserInput) return "waiting_reply";
  if (thread.isGenerating) return "running";
  if (thread.latestFinalMessageAt || thread.latestFinalMessage) return thread.readAt ? "archived" : "completed";
  return "idle";
}

function withThreadState(thread) {
  const taskState = deriveThreadState(thread);
  const labels = {
    running: "运行中",
    waiting_reply: "等待回复",
    waiting_approval: "待审批",
    completed: "已完成",
    completed_unread: "已完成未读",
    failed: "失败",
    archived: "已读归档",
    idle: "空闲",
  };
  return {
    ...thread,
    taskState,
    taskStateLabel: labels[taskState] ?? taskState,
    requiresAction: ["waiting_reply", "waiting_approval", "completed_unread", "failed"].includes(taskState),
  };
}

function normalizeThread(thread) {
  return {
    id: String(thread.id ?? ""),
    provider: thread.provider ?? "codex",
    title: thread.title ?? thread.name ?? null,
    preview: thread.preview ?? "",
    cwd: thread.cwd ?? "",
    source: thread.source ?? "",
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    latestMessage: thread.latestMessage ?? null,
    latestMessageAt: thread.latestMessageAt ?? null,
    latestMessagePhase: thread.latestMessagePhase ?? null,
    latestFinalMessage: thread.latestFinalMessage ?? null,
    latestFinalMessageAt: thread.latestFinalMessageAt ?? null,
    latestProgressMessage: thread.latestProgressMessage ?? null,
    latestProgressMessageAt: thread.latestProgressMessageAt ?? null,
    recentMessages: normalizeRecentMessages(thread.recentMessages),
    isGenerating: Boolean(thread.isGenerating),
    waitingOnApproval: Boolean(thread.waitingOnApproval),
    waitingOnUserInput: Boolean(thread.waitingOnUserInput),
  };
}

function normalizeRecentMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-20).map((message) => ({
    text: String(message?.text ?? "").slice(0, 1800),
    at: message?.at ?? null,
    phase: message?.phase ?? null,
    role: message?.role ?? null,
  })).filter((message) => message.text.trim());
}

function notificationTitle(thread) {
  const title = String(thread.title ?? "").trim();
  if (title) return title;
  const preview = String(thread.preview ?? "").replace(/\s+/g, " ").trim();
  return preview ? preview.slice(0, 48) : "未命名任务";
}

function addNodeNotification(node, notification) {
  node.notifications = Array.isArray(node.notifications) ? node.notifications : [];
  const existingUnread = node.notifications.find((item) => !item.readAt && item.threadId === notification.threadId);
  if (existingUnread) {
    existingUnread.type = notification.type;
    existingUnread.threadUpdatedAt = notification.threadUpdatedAt;
    existingUnread.title = notification.title;
    existingUnread.preview = notification.preview;
    existingUnread.createdAt = nowIso();
    existingUnread.dedupeKey = `${notification.type}:${notification.threadId}:${notification.threadUpdatedAt ?? ""}`;
    notifyExternal(node, existingUnread);
    return;
  }
  const dedupeKey = `${notification.type}:${notification.threadId}:${notification.threadUpdatedAt ?? ""}`;
  if (node.notifications.some((item) => item.dedupeKey === dedupeKey)) return;
  const notice = {
    id: randomUUID(),
    createdAt: nowIso(),
    readAt: null,
    dedupeKey,
    ...notification,
  };
  node.notifications.push(notice);
  node.notifications = node.notifications.slice(-100);
  notifyExternal(node, notice);
}

function updateThreadNotifications(node, previousThreads, nextThreads, previousLastSeenAt = null) {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread]));
  const previousLastSeenMs = valueTime(previousLastSeenAt);
  for (const thread of nextThreads) {
    const previous = previousById.get(thread.id);
    const threadUpdatedAt = thread.latestFinalMessageAt ?? thread.latestMessageAt ?? thread.updatedAt ?? thread.createdAt ?? null;
    if (!previous) {
      const finalAt = valueTime(thread.latestFinalMessageAt);
      if (!thread.isGenerating && previousLastSeenMs > 0 && finalAt > previousLastSeenMs) {
        addNodeNotification(node, {
          type: "completed",
          threadId: thread.id,
          threadUpdatedAt: thread.latestFinalMessageAt ?? threadUpdatedAt,
          title: notificationTitle(thread),
          preview: thread.latestFinalMessage || thread.latestMessage || thread.preview || "任务已结束，等待查看。",
        });
      }
      continue;
    }
    if (previous.isGenerating && !thread.isGenerating) {
      addNodeNotification(node, {
        type: "completed",
        threadId: thread.id,
        threadUpdatedAt,
        title: notificationTitle(thread),
        preview: thread.latestFinalMessage || thread.latestMessage || thread.preview || "任务已结束，等待查看。",
      });
      continue;
    }
    if (!thread.isGenerating && valueTime(thread.latestFinalMessageAt) > valueTime(previous.latestFinalMessageAt)) {
      addNodeNotification(node, {
        type: "updated",
        threadId: thread.id,
        threadUpdatedAt: thread.latestFinalMessageAt,
        title: notificationTitle(thread),
        preview: thread.latestFinalMessage || "任务有新内容。",
      });
    }
  }
}

function unreadNotifications(node) {
  return (node.notifications ?? []).filter((item) => !item.readAt);
}

function deriveMetrics(threads) {
  const rows = Array.isArray(threads) ? threads : [];
  return {
    totalThreads: rows.length,
    running: rows.filter((thread) => thread.isGenerating).length,
    waitingReply: rows.filter((thread) => thread.waitingOnUserInput).length,
    waitingApproval: rows.filter((thread) => thread.waitingOnApproval).length,
    attention: rows.filter((thread) => thread.waitingOnUserInput || thread.waitingOnApproval).length,
  };
}

function publicNode(node) {
  const status = getNodeStatus(node);
  const threads = sortThreads(Array.isArray(node.threads) ? node.threads.map(normalizeThread).map(withThreadState) : []);
  const notifications = Array.isArray(node.notifications) ? node.notifications : [];
  const unread = notifications.filter((item) => !item.readAt);
  const metrics = { ...deriveMetrics(threads), ...(node.metrics ?? {}) };
  metrics.attention = (metrics.attention ?? 0) + unread.length;
  const waitingAttention = threads.filter((thread) => thread.waitingOnUserInput || thread.waitingOnApproval);
  const notificationAttention = unread.map((notice) => withThreadState({
    id: notice.threadId,
    provider: "codex",
    title: notice.title,
    preview: notice.preview,
    updatedAt: notice.threadUpdatedAt ?? notice.createdAt,
    latestMessage: notice.preview,
    latestMessageAt: notice.createdAt,
    latestFinalMessage: notice.type === "completed" ? notice.preview : null,
    latestFinalMessageAt: notice.type === "completed" ? notice.createdAt : null,
    latestProgressMessage: notice.type !== "completed" ? notice.preview : null,
    latestProgressMessageAt: notice.type !== "completed" ? notice.createdAt : null,
    recentMessages: notice.preview ? [{ text: notice.preview, at: notice.createdAt, phase: notice.type }] : [],
    isGenerating: false,
    waitingOnApproval: false,
    waitingOnUserInput: false,
    attentionKind: notice.type,
    notificationId: notice.id,
    notificationCreatedAt: notice.createdAt,
  }));
  return {
    id: node.id,
    name: node.name ?? node.id,
    status,
    tags: Array.isArray(node.tags) ? node.tags : [],
    createdAt: node.createdAt,
    lastSeenAt: node.lastSeenAt ?? null,
    version: node.version ?? null,
    heartbeatSeq: node.heartbeatSeq ?? null,
    collectedAt: node.collectedAt ?? null,
    agentStartedAt: node.agentStartedAt ?? null,
    update: node.update ?? null,
    revokedAt: node.revokedAt ?? null,
    host: node.host ?? null,
    farfield: node.farfield ?? null,
    metrics,
    threads,
    attention: [...notificationAttention, ...waitingAttention],
    notifications,
    lastError: node.lastError ?? null,
    pendingCommands: (node.commands ?? []).filter((command) => command.status === "queued").length,
    syncHealth: buildSyncHealth(node, status, threads, unread),
    recentCommandResults: (node.commands ?? [])
      .filter((command) => command.status === "done" || command.status === "failed")
      .slice(-10),
  };
}

function dashboardState() {
  const nodes = [...state.nodes.values()].map(publicNode).sort((a, b) => a.id.localeCompare(b.id));
  const online = nodes.filter((node) => node.status === "online").length;
  const allThreads = nodes.flatMap((node) => (node.threads ?? []).map((thread) => ({ node, thread })));
  const today = reportDay();
  const completedToday = allThreads.filter(({ thread }) => (
    ["completed", "completed_unread", "archived"].includes(thread.taskState) &&
    valueTime(thread.latestFinalMessageAt ?? thread.latestMessageAt ?? thread.updatedAt) >= today.startMs
  )).length;
  const updatedToday = allThreads.filter(({ thread }) => (
    valueTime(thread.latestFinalMessageAt ?? thread.latestProgressMessageAt ?? thread.latestMessageAt ?? thread.updatedAt ?? thread.createdAt) >= today.startMs
  )).length;
  const failedCommands = nodes.reduce((sum, node) => sum + (node.syncHealth?.commandCounts?.failed ?? 0), 0);
  return {
    ok: true,
    version: RELEASE_VERSION,
    generatedAt: nowIso(),
    startedAt: state.startedAt,
    storage: storageStatus(),
    reports: {
      today: {
        date: today.date,
        timezoneOffsetMinutes: today.offsetMinutes,
        updatedThreads: updatedToday,
        completedThreads: completedToday,
        failedCommands,
        onlineNodes: online,
        totalNodes: nodes.length,
      },
    },
    totals: {
      nodes: nodes.length,
      online,
      offline: nodes.length - online,
      running: nodes.reduce((sum, node) => sum + node.metrics.running, 0),
      waitingReply: nodes.reduce((sum, node) => sum + node.metrics.waitingReply, 0),
      waitingApproval: nodes.reduce((sum, node) => sum + node.metrics.waitingApproval, 0),
      attention: nodes.reduce((sum, node) => sum + node.metrics.attention, 0),
      unread: nodes.reduce((sum, node) => sum + (node.syncHealth?.unreadNotifications ?? 0), 0),
      completedToday,
      updatedToday,
      failedCommands,
    },
    nodes,
  };
}

function getOrCreateNode(nodeId) {
  const existing = state.nodes.get(nodeId);
  if (existing) return existing;
  const node = {
    id: nodeId,
    name: nodeId,
    deviceKey: null,
    createdAt: nowIso(),
    lastSeenAt: null,
    threads: [],
    metrics: {},
    commands: [],
    notifications: [],
  };
  state.nodes.set(nodeId, node);
  return node;
}

function queueCommand(node, action) {
  const command = {
    id: randomUUID(),
    status: "queued",
    createdAt: nowIso(),
    leasedAt: null,
    completedAt: null,
    action,
    result: null,
  };
  node.commands.push(command);
  cleanupCommands(node);
  return command;
}

function cleanupCommands(node) {
  const cutoff = Date.now() - COMMAND_TTL_MS;
  const leaseCutoff = Date.now() - COMMAND_LEASE_MS;
  for (const command of node.commands ?? []) {
    if (command.status === "leased" && Date.parse(command.leasedAt ?? command.createdAt) < leaseCutoff) {
      command.status = "queued";
      command.leasedAt = null;
    }
  }
  node.commands = (node.commands ?? []).filter((command) => {
    if (command.status === "queued" || command.status === "leased") return true;
    return Date.parse(command.completedAt ?? command.createdAt) > cutoff;
  });
}

function serveStatic(req, res, url) {
  const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    writeJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    ext === ".js" ? "text/javascript; charset=utf-8" :
    ext === ".json" ? "application/json; charset=utf-8" :
    ext === ".svg" ? "image/svg+xml" :
    ext === ".png" ? "image/png" :
    ext === ".webmanifest" ? "application/manifest+json" :
    "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
}

loadState();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "OPTIONS") {
      writeJson(res, 204, {});
      return;
    }

    if (url.pathname === "/api/health") {
      writeJson(res, 200, {
        ok: true,
        version: RELEASE_VERSION,
        storage: storageStatus(),
        push: {
          webhookConfigured: Boolean(PUSH_WEBHOOK_URL),
          fcmConfigured: fcmConfigured(),
          firebaseWebConfigured: Boolean(FIREBASE_WEB_CONFIG && FIREBASE_VAPID_KEY),
          subscriptions: state.pushSubscriptions.filter((item) => !item.revokedAt).length,
        },
        startedAt: state.startedAt,
        nodes: state.nodes.size,
        authRequired: true,
      });
      return;
    }

    if (url.pathname === "/api/events") {
      if (!isReadAuthed(req, url)) {
        writeJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "access-control-allow-origin": "*",
      });
      state.sseClients.add(res);
      res.write("retry: 2000\n\n");
      res.write(`data: ${JSON.stringify({ type: "state", state: dashboardState() })}\n\n`);
      req.on("close", () => state.sseClients.delete(res));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" && url.pathname === "/api/enroll") {
        const body = await readBody(req);
        if (!isInstallAuthed(req, url, body)) {
          writeJson(res, 401, { ok: false, error: "Invalid install key" });
          return;
        }
        const requestedId = String(body.nodeId ?? body.node_id ?? body.name ?? "").trim();
        const nodeId = requestedId || `node-${randomUUID().slice(0, 8)}`;
        const node = getOrCreateNode(nodeId);
        node.name = body.nodeName ?? body.node_name ?? body.name ?? node.name ?? nodeId;
        node.host = body.host ?? node.host ?? null;
        node.tags = Array.isArray(body.tags) ? body.tags : node.tags ?? [];
        node.deviceKey = createSecret("ck_node");
        node.revokedAt = null;
        node.enrolledAt = nowIso();
        recordAudit("node.enrolled", "installer", { nodeId, nodeName: node.name });
        persistState();
        sendEvent({ type: "nodeEnrolled", node: publicNode(node) });
        writeJson(res, 200, {
          ok: true,
          node: publicNode(node),
          credentials: {
            nodeId,
            nodeKey: node.deviceKey,
          },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        if (!isReadAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        writeJson(res, 200, dashboardState());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/install-profile") {
        if (!isAdminAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        writeJson(res, 200, buildInstallProfile(req));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/install-key/rotate") {
        if (!isAdminAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        const installKey = rotateInstallKey();
        writeJson(res, 200, { ok: true, installKey, installProfile: buildInstallProfile(req) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/audit") {
        if (!isReadAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 500));
        writeJson(res, 200, {
          ok: true,
          auditLogs: state.auditLogs.slice(-limit).reverse(),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/push/config") {
        if (!isReadAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        writeJson(res, 200, {
          ok: true,
          fcmConfigured: fcmConfigured(),
          firebaseWebConfig: FIREBASE_WEB_CONFIG ? safeJsonParse(FIREBASE_WEB_CONFIG) : null,
          vapidKey: FIREBASE_VAPID_KEY || null,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/reports/daily") {
        if (!isReadAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        const dashboard = dashboardState();
        writeJson(res, 200, { ok: true, report: dashboard.reports.today, totals: dashboard.totals });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/push/register") {
        if (!isAdminAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        const body = await readBody(req);
        const token = String(body.token ?? "").trim();
        const type = String(body.type ?? "fcm").trim() || "fcm";
        if (!token) {
          writeJson(res, 400, { ok: false, error: "Missing push token" });
          return;
        }
        const existing = state.pushSubscriptions.find((item) => item.token === token && item.type === type);
        if (existing) {
          existing.revokedAt = null;
          existing.updatedAt = nowIso();
          existing.label = body.label ?? existing.label ?? null;
        } else {
          state.pushSubscriptions.push({
            id: randomUUID(),
            type,
            token,
            label: body.label ?? null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            revokedAt: null,
          });
        }
        state.pushSubscriptions = state.pushSubscriptions.slice(-200);
        recordAudit("push.registered", "admin", { type, label: body.label ?? null });
        persistState();
        writeJson(res, 200, { ok: true, subscriptions: state.pushSubscriptions.filter((item) => !item.revokedAt).length });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/push/test") {
        if (!isAdminAuthed(req, url)) {
          writeJson(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        deliverNotification({
          type: "test",
          title: "CodexHub 测试通知",
          preview: "云端通知通道已触发。",
          createdAt: nowIso(),
        }).catch(() => {});
        writeJson(res, 202, { ok: true, queued: true });
        return;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "api" && parts[1] === "nodes" && parts[2]) {
        const nodeId = decodeURIComponent(parts[2]);
        const node = getOrCreateNode(nodeId);

        if (req.method === "GET" && parts.length === 3) {
          if (!isReadAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          writeJson(res, 200, { ok: true, node: publicNode(node) });
          return;
        }

        if (req.method === "GET" && parts[3] === "self") {
          if (!isNodeAuthed(node, req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized node" });
            return;
          }
          writeJson(res, 200, { ok: true, node: publicNode(node) });
          return;
        }

        if (req.method === "POST" && parts[3] === "update") {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const body = await readBody(req);
          if (typeof body.name === "string" && body.name.trim()) {
            node.name = body.name.trim();
          }
          if (Array.isArray(body.tags)) {
            node.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean);
          }
          recordAudit("node.updated", "admin", { nodeId, name: node.name, tags: node.tags ?? [] });
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          writeJson(res, 200, { ok: true, node: publicNode(node) });
          return;
        }

        if (req.method === "POST" && parts[3] === "revoke") {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          node.revokedAt = nowIso();
          node.deviceKey = null;
          node.commands = [];
          recordAudit("node.revoked", "admin", { nodeId });
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          writeJson(res, 200, { ok: true, node: publicNode(node) });
          return;
        }

        if (req.method === "POST" && parts[3] === "rotate-key") {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          node.deviceKey = createSecret("ck_node");
          node.revokedAt = null;
          recordAudit("node.key_rotated", "admin", { nodeId });
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          writeJson(res, 200, {
            ok: true,
            node: publicNode(node),
            credentials: { nodeId, nodeKey: node.deviceKey },
          });
          return;
        }

        if (req.method === "POST" && parts[3] === "heartbeat") {
          if (!isNodeAuthed(node, req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized node" });
            return;
          }
          const body = await readBody(req);
          node.name = body.name ?? node.name ?? nodeId;
          node.tags = Array.isArray(body.tags) ? body.tags : node.tags ?? [];
          node.version = body.version ?? node.version ?? null;
          node.heartbeatSeq = Number.isFinite(Number(body.heartbeatSeq)) ? Number(body.heartbeatSeq) : node.heartbeatSeq ?? null;
          node.collectedAt = body.collectedAt ?? null;
          node.agentStartedAt = body.agentStartedAt ?? node.agentStartedAt ?? null;
          node.agentLastErrorAt = body.agentLastErrorAt ?? node.agentLastErrorAt ?? null;
          node.update = body.update ?? node.update ?? null;
          node.host = body.host ?? node.host ?? null;
          const previousLastSeenAt = node.lastSeenAt ?? null;
          node.lastSeenAt = nowIso();
          node.farfield = body.farfield ?? null;
          node.metrics = body.metrics ?? {};
          const previousThreads = Array.isArray(node.threads) ? node.threads.map(normalizeThread) : [];
          const nextThreads = Array.isArray(body.threads) ? body.threads.map(normalizeThread) : [];
          updateThreadNotifications(node, previousThreads, nextThreads, previousLastSeenAt);
          node.threads = nextThreads;
          node.lastError = body.lastError ?? null;
          cleanupCommands(node);
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          writeJson(res, 200, {
            ok: true,
            node: publicNode(node),
            queuedCommands: node.commands.filter((command) => command.status === "queued").length,
          });
          return;
        }

        if (req.method === "POST" && parts[3] === "notifications" && parts[4] === "read") {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const body = await readBody(req);
          const markAll = Boolean(body.all);
          const threadId = body.threadId ? String(body.threadId) : "";
          const notificationId = body.notificationId ? String(body.notificationId) : "";
          const now = nowIso();
          node.notifications = (node.notifications ?? []).map((notice) => {
            if (notice.readAt) return notice;
            const matchesThread = threadId && notice.threadId === threadId;
            const matchesNotification = notificationId && notice.id === notificationId;
            return markAll || matchesThread || matchesNotification ? { ...notice, readAt: now } : notice;
          });
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          writeJson(res, 200, { ok: true, unread: unreadNotifications(node).length });
          return;
        }

        if (req.method === "POST" && parts[3] === "actions") {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
            return;
          }
          const action = await readBody(req);
          const allowed = ["sendMessage", "interrupt", "submitUserInput", "refresh"];
          if (!allowed.includes(action.kind)) {
            writeJson(res, 400, { ok: false, error: `Unsupported action kind: ${action.kind}` });
            return;
          }
          const command = queueCommand(node, action);
          recordAudit("command.queued", "admin", { nodeId, commandId: command.id, kind: action.kind, threadId: action.threadId ?? null });
          persistState();
          sendEvent({ type: "commandQueued", nodeId, command });
          writeJson(res, 202, { ok: true, command });
          return;
        }

        if (req.method === "GET" && parts[3] === "commands" && parts[4] === "poll") {
          if (!isNodeAuthed(node, req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized node" });
            return;
          }
          cleanupCommands(node);
          const limit = Number(url.searchParams.get("limit") ?? 5);
          const commands = node.commands
            .filter((command) => command.status === "queued")
            .slice(0, Math.max(1, Math.min(limit, 20)));
          for (const command of commands) {
            command.status = "leased";
            command.leasedAt = nowIso();
          }
          persistState();
          writeJson(res, 200, { ok: true, commands });
          return;
        }

        if (req.method === "POST" && parts[3] === "commands" && parts[4] && parts[5] === "result") {
          if (!isNodeAuthed(node, req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized node" });
            return;
          }
          const commandId = decodeURIComponent(parts[4]);
          const command = (node.commands ?? []).find((item) => item.id === commandId);
          if (!command) {
            writeJson(res, 404, { ok: false, error: "Command not found" });
            return;
          }
          const body = await readBody(req);
          command.status = body.ok ? "done" : "failed";
          command.completedAt = nowIso();
          command.result = body;
          if (command.status === "failed" && command.action?.threadId) {
            addNodeNotification(node, {
              type: "commandFailed",
              threadId: String(command.action.threadId),
              threadUpdatedAt: command.completedAt,
              title: "手机指令发送失败",
              preview: body.error || body.result?.error || "桌面端执行手机指令失败，请检查本机状态。",
            });
          }
          recordAudit("command.completed", "node", { nodeId, commandId: command.id, status: command.status });
          persistState();
          sendEvent({ type: "state", state: dashboardState() });
          sendEvent({ type: "commandResult", nodeId, command });
          writeJson(res, 200, { ok: true, command });
          return;
        }
      }

      writeJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

setInterval(() => {
  sendEvent({ type: "state", state: dashboardState() });
}, 15_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`CodexHub cloud server listening on http://${HOST}:${PORT}`);
  if (ADMIN_TOKEN === "dev-token") {
    console.log("Using default admin token dev-token. Change CODEXHUB_ADMIN_TOKEN before public deployment.");
  }
});
