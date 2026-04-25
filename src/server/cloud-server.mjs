import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.CODEXHUB_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.CODEXHUB_HOST ?? "0.0.0.0";
const ADMIN_TOKEN = process.env.CODEXHUB_ADMIN_TOKEN ?? process.env.CODEXHUB_TOKEN ?? "dev-token";
const INSTALL_KEY = process.env.CODEXHUB_INSTALL_KEY ?? process.env.CODEXHUB_TOKEN ?? ADMIN_TOKEN;
const DATA_FILE = process.env.CODEXHUB_DATA_FILE
  ? path.resolve(process.env.CODEXHUB_DATA_FILE)
  : null;
const OFFLINE_AFTER_MS = Number(process.env.CODEXHUB_OFFLINE_AFTER_MS ?? 45_000);
const COMMAND_TTL_MS = Number(process.env.CODEXHUB_COMMAND_TTL_MS ?? 10 * 60_000);
const COMMAND_LEASE_MS = Number(process.env.CODEXHUB_COMMAND_LEASE_MS ?? 60_000);

const state = {
  startedAt: new Date().toISOString(),
  nodes: new Map(),
  auditLogs: [],
  sseClients: new Set(),
};

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadState() {
  if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
  const parsed = safeJsonParse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!parsed || !Array.isArray(parsed.nodes)) return;
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
}

function persistState() {
  if (!DATA_FILE) return;
  const payload = {
    savedAt: nowIso(),
    auditLogs: state.auditLogs.slice(-500),
    nodes: [...state.nodes.values()].map((node) => ({
      ...node,
      commands: node.commands.filter((command) => command.status !== "done"),
    })),
  };
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
}

function getPresentedToken(req, url) {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return req.headers["x-codexhub-token"] ?? url.searchParams.get("token") ?? "";
}

function isAdminAuthed(req, url) {
  return getPresentedToken(req, url) === ADMIN_TOKEN;
}

function isInstallAuthed(req, url, body = null) {
  return (
    getPresentedToken(req, url) === INSTALL_KEY ||
    body?.installKey === INSTALL_KEY ||
    body?.install_key === INSTALL_KEY
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
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket.encrypted ? "https" : "http");
  const host = forwardedHost || req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function buildInstallProfile(req) {
  const publicBaseUrl = getPublicBaseUrl(req);
  const windowsCommand = [
    "powershell -ExecutionPolicy Bypass -File .\\scripts\\install-desktop-agent.ps1",
    `  -Server "${publicBaseUrl}"`,
    `  -InstallKey "${INSTALL_KEY}"`,
    '  -NodeId "TMT1"',
    '  -NodeName "TMT1"',
  ].join(" `\n");
  const linuxCommand = [
    "bash ./scripts/install-linux-agent.sh",
    `  --server "${publicBaseUrl}"`,
    `  --install-key "${INSTALL_KEY}"`,
    '  --node-id "$(hostname)"',
    '  --node-name "$(hostname)"',
  ].join(" \\\n");
  const macosCommand = [
    "bash ./scripts/install-macos-agent.sh",
    `  --server "${publicBaseUrl}"`,
    `  --install-key "${INSTALL_KEY}"`,
    '  --node-id "$(scutil --get ComputerName)"',
    '  --node-name "$(scutil --get ComputerName)"',
  ].join(" \\\n");

  return {
    ok: true,
    serverUrl: publicBaseUrl,
    adminToken: ADMIN_TOKEN,
    installKey: INSTALL_KEY,
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

function getNodeStatus(node) {
  if (node?.revokedAt) return "revoked";
  if (!node?.lastSeenAt) return "offline";
  return Date.now() - Date.parse(node.lastSeenAt) > OFFLINE_AFTER_MS ? "offline" : "online";
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
    isGenerating: Boolean(thread.isGenerating),
    waitingOnApproval: Boolean(thread.waitingOnApproval),
    waitingOnUserInput: Boolean(thread.waitingOnUserInput),
  };
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
  const threads = Array.isArray(node.threads) ? node.threads.map(normalizeThread) : [];
  const metrics = { ...deriveMetrics(threads), ...(node.metrics ?? {}) };
  return {
    id: node.id,
    name: node.name ?? node.id,
    status,
    tags: Array.isArray(node.tags) ? node.tags : [],
    createdAt: node.createdAt,
    lastSeenAt: node.lastSeenAt ?? null,
    version: node.version ?? null,
    revokedAt: node.revokedAt ?? null,
    host: node.host ?? null,
    farfield: node.farfield ?? null,
    metrics,
    threads,
    attention: threads.filter((thread) => thread.waitingOnUserInput || thread.waitingOnApproval),
    lastError: node.lastError ?? null,
    pendingCommands: (node.commands ?? []).filter((command) => command.status === "queued").length,
    recentCommandResults: (node.commands ?? [])
      .filter((command) => command.status === "done" || command.status === "failed")
      .slice(-10),
  };
}

function dashboardState() {
  const nodes = [...state.nodes.values()].map(publicNode).sort((a, b) => a.id.localeCompare(b.id));
  const online = nodes.filter((node) => node.status === "online").length;
  return {
    ok: true,
    generatedAt: nowIso(),
    startedAt: state.startedAt,
    totals: {
      nodes: nodes.length,
      online,
      offline: nodes.length - online,
      running: nodes.reduce((sum, node) => sum + node.metrics.running, 0),
      waitingReply: nodes.reduce((sum, node) => sum + node.metrics.waitingReply, 0),
      waitingApproval: nodes.reduce((sum, node) => sum + node.metrics.waitingApproval, 0),
      attention: nodes.reduce((sum, node) => sum + node.metrics.attention, 0),
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
        startedAt: state.startedAt,
        nodes: state.nodes.size,
        authRequired: true,
      });
      return;
    }

    if (url.pathname === "/api/events") {
      if (!isAdminAuthed(req, url)) {
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
        if (!isAdminAuthed(req, url)) {
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

      if (req.method === "GET" && url.pathname === "/api/audit") {
        if (!isAdminAuthed(req, url)) {
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

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "api" && parts[1] === "nodes" && parts[2]) {
        const nodeId = decodeURIComponent(parts[2]);
        const node = getOrCreateNode(nodeId);

        if (req.method === "GET" && parts.length === 3) {
          if (!isAdminAuthed(req, url)) {
            writeJson(res, 401, { ok: false, error: "Unauthorized" });
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
          node.host = body.host ?? node.host ?? null;
          node.lastSeenAt = nowIso();
          node.farfield = body.farfield ?? null;
          node.metrics = body.metrics ?? {};
          node.threads = Array.isArray(body.threads) ? body.threads.map(normalizeThread) : [];
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
          recordAudit("command.completed", "node", { nodeId, commandId: command.id, status: command.status });
          persistState();
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
