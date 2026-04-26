import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const config = parseArgs(process.argv.slice(2));
const CONFIG_PATH = path.resolve(
  config.config ??
    process.env.CODEXHUB_AGENT_CONFIG ??
    (process.platform === "win32"
      ? path.join(process.env.ProgramData ?? os.homedir(), "CodexHub", "agent.json")
      : path.join(os.homedir(), ".config", "codexhub", "agent.json")),
);
const savedConfig = readAgentConfig(CONFIG_PATH);
let SERVER = stripSlash(config.server ?? process.env.CODEXHUB_SERVER ?? savedConfig.server ?? "http://127.0.0.1:8787");
let NODE_ID = config.node ?? process.env.CODEXHUB_NODE_ID ?? savedConfig.nodeId ?? os.hostname();
let NODE_NAME = config.name ?? process.env.CODEXHUB_NODE_NAME ?? savedConfig.nodeName ?? NODE_ID;
let NODE_KEY = config.nodeKey ?? process.env.CODEXHUB_NODE_KEY ?? process.env.CODEXHUB_TOKEN ?? savedConfig.nodeKey ?? "";
const INSTALL_KEY = config.installKey ?? process.env.CODEXHUB_INSTALL_KEY ?? savedConfig.installKey ?? "";
const FARFIELD_URL = stripSlash(config.farfield ?? process.env.FARFIELD_URL ?? savedConfig.farfieldUrl ?? "http://127.0.0.1:4311");
const INTERVAL_MS = Number(config.interval ?? process.env.CODEXHUB_INTERVAL_MS ?? 5_000);
const PROVIDER = config.provider ?? process.env.CODEXHUB_PROVIDER ?? "codex";
const CODEX_HOME = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
const SESSION_ROOT = path.join(CODEX_HOME, "sessions");
const SESSION_CACHE = new Map();
let sessionFileIndex = null;

function parseArgs(args) {
  const out = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=");
    out[key] = inline ?? args[index + 1];
    if (!inline) index += 1;
  }
  return out;
}

function stripSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function readAgentConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeAgentConfig(filePath, next) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
}

function headers(token = NODE_KEY) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function getJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${payload.error ?? text}`);
  }
  return payload;
}

async function postJson(url, body) {
  return getJson(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

async function enrollIfNeeded() {
  if (NODE_KEY) return;
  if (!INSTALL_KEY) {
    throw new Error(`No node key found and no install key provided. Set CODEXHUB_INSTALL_KEY or run the installer.`);
  }
  const response = await getJson(`${SERVER}/api/enroll`, {
    method: "POST",
    headers: headers(INSTALL_KEY),
    body: JSON.stringify({
      installKey: INSTALL_KEY,
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      tags: [PROVIDER],
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
      },
    }),
  });
  NODE_ID = response.credentials.nodeId;
  NODE_KEY = response.credentials.nodeKey;
  NODE_NAME = response.node?.name ?? NODE_NAME;
  writeAgentConfig(CONFIG_PATH, {
    server: SERVER,
    nodeId: NODE_ID,
    nodeName: NODE_NAME,
    nodeKey: NODE_KEY,
    farfieldUrl: FARFIELD_URL,
    provider: PROVIDER,
    enrolledAt: new Date().toISOString(),
  });
  console.log(`Enrolled ${NODE_ID}; saved device key to ${CONFIG_PATH}`);
}

async function farfieldJson(path, init = {}) {
  const response = await fetch(`${FARFIELD_URL}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Farfield ${response.status}: ${payload.error ?? text}`);
  }
  return payload;
}

function normalizeFarfieldState(health) {
  const state = health?.state ?? {};
  return {
    ok: Boolean(health?.ok),
    appReady: Boolean(state.appReady),
    ipcConnected: Boolean(state.ipcConnected),
    ipcInitialized: Boolean(state.ipcInitialized),
    codexAvailable: state.codexAvailable !== false,
    lastError: state.lastError ?? null,
    socketPath: state.socketPath ?? null,
    appExecutable: state.appExecutable ?? null,
    gitCommit: state.gitCommit ?? null,
    activeTrace: state.activeTrace ?? null,
  };
}

function farfieldHasNoActiveTrace(health) {
  const farfieldState = health?.state ?? {};
  return Object.prototype.hasOwnProperty.call(farfieldState, "activeTrace") && farfieldState.activeTrace == null;
}

function normalizeThreads(sidebar, health) {
  const rows = sidebar?.rows ?? sidebar?.data ?? sidebar?.threads ?? [];
  if (!Array.isArray(rows)) return [];
  const clearGenerating = farfieldHasNoActiveTrace(health);
  return rows.map((thread) => ({
    id: String(thread.id ?? ""),
    provider: thread.provider ?? PROVIDER,
    title: thread.title ?? thread.name ?? null,
    preview: thread.preview ?? "",
    cwd: thread.cwd ?? "",
    source: thread.source ?? "",
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    isGenerating: clearGenerating ? false : Boolean(thread.isGenerating),
    waitingOnApproval: Boolean(thread.waitingOnApproval),
    waitingOnUserInput: Boolean(thread.waitingOnUserInput),
  })).filter((thread) => thread.id).map((thread) => ({
    ...thread,
    ...readLatestSessionMessage(thread.id),
  }));
}

function buildSessionFileIndex() {
  const index = new Map();
  const stack = fs.existsSync(SESSION_ROOT) ? [SESSION_ROOT] : [];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
        if (match) index.set(match[1], fullPath);
      }
    }
  }
  return index;
}

function sessionFileForThread(threadId) {
  if (!sessionFileIndex) sessionFileIndex = buildSessionFileIndex();
  return sessionFileIndex.get(threadId) ?? null;
}

function extractMessageText(payload) {
  if (payload?.type === "agent_message" && typeof payload.message === "string") {
    return payload.message;
  }
  if (payload?.type !== "message" || payload.role !== "assistant") return "";
  const parts = Array.isArray(payload.content) ? payload.content : [];
  return parts
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readLatestSessionMessage(threadId) {
  const filePath = sessionFileForThread(threadId);
  if (!filePath) return {};
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return {};
  }
  const cached = SESSION_CACHE.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;
  let latestFinal = null;
  let latestProgress = null;
  try {
    const lines = fs.readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index]) continue;
      let event;
      try {
        event = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      const text = extractMessageText(event.payload);
      if (!text) continue;
      const phase = event.payload?.phase ?? null;
      const entry = {
        text: text.length > 1800 ? `${text.slice(0, 1800)}...` : text,
        at: event.timestamp ?? null,
        phase,
      };
      if (!latestFinal && phase === "final_answer") {
        latestFinal = entry;
      } else if (!latestProgress && phase !== "final_answer") {
        latestProgress = entry;
      }
      if (latestFinal && latestProgress) break;
    }
  } catch {
    latestFinal = null;
    latestProgress = null;
  }
  const preferred = latestFinal ?? latestProgress;
  const value = preferred ? {
    latestMessage: preferred.text,
    latestMessageAt: preferred.at,
    latestMessagePhase: preferred.phase,
    latestFinalMessage: latestFinal?.text ?? null,
    latestFinalMessageAt: latestFinal?.at ?? null,
    latestProgressMessage: latestProgress?.text ?? null,
    latestProgressMessageAt: latestProgress?.at ?? null,
  } : {};
  SESSION_CACHE.set(filePath, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function deriveMetrics(threads) {
  return {
    running: threads.filter((thread) => thread.isGenerating).length,
    waitingReply: threads.filter((thread) => thread.waitingOnUserInput).length,
    waitingApproval: threads.filter((thread) => thread.waitingOnApproval).length,
    totalThreads: threads.length,
  };
}

async function collectSnapshot() {
  const health = await farfieldJson("/api/health");
  let sidebar;
  try {
    sidebar = await farfieldJson("/api/unified/sidebar?limit=80&archived=false&all=true");
  } catch {
    sidebar = await farfieldJson("/api/unified/threads?limit=80&archived=false&all=true");
  }
  const threads = normalizeThreads(sidebar, health);
  const farfield = normalizeFarfieldState(health);
  return {
    name: NODE_NAME,
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    tags: [PROVIDER],
    farfield,
    metrics: deriveMetrics(threads),
    threads,
    lastError: farfield.lastError,
  };
}

async function executeCommand(command) {
  const action = command.action ?? {};
  if (action.kind === "refresh") {
    return { ok: true, skipped: false, message: "refresh acknowledged" };
  }

  if (action.kind === "sendMessage") {
    if (!action.threadId || !action.text) {
      throw new Error("sendMessage requires threadId and text");
    }
    return farfieldJson("/api/unified/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "sendMessage",
        provider: action.provider ?? PROVIDER,
        threadId: action.threadId,
        text: action.text,
      }),
    });
  }

  if (action.kind === "interrupt") {
    if (!action.threadId) throw new Error("interrupt requires threadId");
    return farfieldJson("/api/unified/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "interrupt",
        provider: action.provider ?? PROVIDER,
        threadId: action.threadId,
      }),
    });
  }

  if (action.kind === "submitUserInput") {
    if (!action.threadId || action.requestId == null || !action.response) {
      throw new Error("submitUserInput requires threadId, requestId and response");
    }
    return farfieldJson("/api/unified/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "submitUserInput",
        provider: action.provider ?? PROVIDER,
        threadId: action.threadId,
        requestId: action.requestId,
        response: action.response,
      }),
    });
  }

  throw new Error(`Unsupported command kind: ${action.kind}`);
}

async function pollCommands() {
  const payload = await getJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/commands/poll?limit=5`, {
    headers: headers(),
  });
  let processed = 0;
  for (const command of payload.commands ?? []) {
    try {
      const result = await executeCommand(command);
      processed += 1;
      await postJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/commands/${encodeURIComponent(command.id)}/result`, {
        ok: true,
        result,
      });
    } catch (error) {
      processed += 1;
      await postJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/commands/${encodeURIComponent(command.id)}/result`, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return processed;
}

async function tick() {
  try {
    await enrollIfNeeded();
    const snapshot = await collectSnapshot();
    const result = await postJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/heartbeat`, snapshot);
    if (result.queuedCommands > 0) {
      const processed = await pollCommands();
      if (processed > 0) {
        const nextSnapshot = await collectSnapshot();
        await postJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/heartbeat`, nextSnapshot);
      }
    }
    console.log(`[${new Date().toLocaleTimeString()}] heartbeat ok: ${snapshot.threads.length} threads`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toLocaleTimeString()}] heartbeat failed: ${message}`);
    try {
      await postJson(`${SERVER}/api/nodes/${encodeURIComponent(NODE_ID)}/heartbeat`, {
        name: NODE_NAME,
        version: "0.1.0",
        host: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch() },
        farfield: { ok: false },
        threads: [],
        metrics: {},
        lastError: message,
      });
    } catch {}
  }
}

console.log(`CodexHub desktop agent ${NODE_ID} -> ${SERVER}`);
console.log(`Farfield source: ${FARFIELD_URL}`);
console.log(`Agent config: ${CONFIG_PATH}`);
await tick();
setInterval(tick, INTERVAL_MS);
