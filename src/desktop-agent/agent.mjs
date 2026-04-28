import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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
const AGENT_VERSION = "0.4.9";
const AGENT_STARTED_AT = new Date().toISOString();
const CODEX_HOME = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
const SESSION_ROOT = path.join(CODEX_HOME, "sessions");
const SESSION_CACHE = new Map();
let sessionFileIndex = null;
let heartbeatSeq = 0;
const LOCK_PATH = path.join(path.dirname(CONFIG_PATH), `agent-${safeFileName(NODE_ID)}.lock`);
const lockHandle = acquireSingleInstanceLock(LOCK_PATH);

process.on("exit", releaseSingleInstanceLock);
process.on("SIGINT", () => {
  releaseSingleInstanceLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  releaseSingleInstanceLock();
  process.exit(143);
});

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

function safeFileName(value) {
  return String(value || "default").replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 80) || "default";
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingleInstanceLock(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    const handle = fs.openSync(filePath, "wx");
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), configPath: CONFIG_PATH }));
    return handle;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = readAgentConfig(filePath);
    if (pidIsAlive(Number(existing.pid))) {
      console.error(`CodexHub desktop agent is already running as PID ${existing.pid}. Exiting duplicate instance.`);
      process.exit(0);
    }
    try {
      fs.unlinkSync(filePath);
    } catch {}
    const handle = fs.openSync(filePath, "wx");
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), configPath: CONFIG_PATH }));
    return handle;
  }
}

function releaseSingleInstanceLock() {
  try {
    if (lockHandle != null) fs.closeSync(lockHandle);
  } catch {}
  try {
    const existing = readAgentConfig(LOCK_PATH);
    if (Number(existing.pid) === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {}
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

function valueTime(value) {
  if (!value) return 0;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  const numeric = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeThreads(sidebar, health) {
  const rows = sidebar?.rows ?? sidebar?.data ?? sidebar?.threads ?? [];
  if (!Array.isArray(rows)) return [];
  const clearGenerating = farfieldHasNoActiveTrace(health);
  return rows.map((thread) => {
    const id = String(thread.id ?? "");
    const latest = id ? readLatestSessionMessage(id) : {};
    const latestFinalAt = valueTime(latest.latestFinalMessageAt);
    const latestProgressAt = valueTime(latest.latestProgressMessageAt);
    const hasFreshFinal = latestFinalAt > 0 && latestFinalAt >= latestProgressAt;
    return {
      id,
      provider: thread.provider ?? PROVIDER,
      title: thread.title ?? thread.name ?? null,
      preview: thread.preview ?? "",
      cwd: thread.cwd ?? "",
      source: thread.source ?? "",
      createdAt: thread.createdAt ?? null,
      updatedAt: thread.updatedAt ?? null,
      isGenerating: Boolean(thread.isGenerating) && !(clearGenerating && hasFreshFinal),
      waitingOnApproval: Boolean(thread.waitingOnApproval),
      waitingOnUserInput: Boolean(thread.waitingOnUserInput),
      ...latest,
    };
  }).filter((thread) => thread.id);
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
  const cached = sessionFileIndex.get(threadId);
  if (cached) return cached;
  sessionFileIndex = buildSessionFileIndex();
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

function extractTranscriptEntry(event) {
  const payload = event?.payload ?? {};
  if (payload.type === "agent_message" && typeof payload.message === "string") {
    return { role: "assistant", text: payload.message, phase: payload.phase ?? null };
  }
  if (payload.type !== "message") return null;
  const parts = Array.isArray(payload.content) ? payload.content : [];
  const text = parts
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) return null;
  return { role: payload.role ?? "message", text, phase: payload.phase ?? null };
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
  const recentMessages = [];
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
      const transcript = extractTranscriptEntry(event);
      if (!transcript?.text) continue;
      const text = transcript.role === "assistant" ? transcript.text : `${transcript.role}: ${transcript.text}`;
      const phase = event.payload?.phase ?? null;
      const entry = {
        text: text.length > 1800 ? `${text.slice(0, 1800)}...` : text,
        at: event.timestamp ?? null,
        phase,
        role: transcript.role,
      };
      if (recentMessages.length < 20) recentMessages.push(entry);
      const assistantText = extractMessageText(event.payload);
      if (assistantText && !latestFinal && phase === "final_answer") {
        latestFinal = { ...entry, text: assistantText.length > 1800 ? `${assistantText.slice(0, 1800)}...` : assistantText };
      } else if (assistantText && !latestProgress && phase !== "final_answer") {
        latestProgress = { ...entry, text: assistantText.length > 1800 ? `${assistantText.slice(0, 1800)}...` : assistantText };
      }
      if (latestFinal && latestProgress && recentMessages.length >= 20) break;
    }
  } catch {
    latestFinal = null;
    latestProgress = null;
    recentMessages.length = 0;
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
    recentMessages: recentMessages.reverse(),
  } : {};
  SESSION_CACHE.set(filePath, { mtimeMs: stat.mtimeMs, value });
  return value;
}

const SECRET_REDACTORS = [
  [/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'"\s,}]+/gi, "$1=[REDACTED]"],
  [/bearer\s+[a-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED]"],
  [/sk-[a-zA-Z0-9_-]{12,}/g, "sk-[REDACTED]"],
];

function redactSensitiveText(text) {
  return SECRET_REDACTORS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), String(text ?? ""));
}

function fullContextSignature(threadId, messages) {
  const hash = createHash("sha256");
  hash.update(String(threadId));
  for (const message of messages) {
    hash.update(`|${message.at ?? ""}|${message.role ?? ""}|${message.phase ?? ""}|${message.text ?? ""}`);
  }
  return hash.digest("hex").slice(0, 20);
}

function readFullSessionContext(threadId, maxMessages = 200, maxChars = 240000, redact = true) {
  const filePath = sessionFileForThread(threadId);
  if (!filePath) throw new Error(`session file not found for thread ${threadId}`);
  const lines = fs.readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/);
  let messages = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const transcript = extractTranscriptEntry(event);
    if (!transcript?.text?.trim()) continue;
    const text = redact ? redactSensitiveText(transcript.text) : transcript.text;
    messages.push({
      text,
      at: event.timestamp ?? null,
      phase: event.payload?.phase ?? transcript.phase ?? null,
      role: transcript.role ?? null,
    });
  }
  let truncated = false;
  if (messages.length > maxMessages) {
    messages = messages.slice(-maxMessages);
    truncated = true;
  }
  let totalChars = 0;
  let start = messages.length;
  while (start > 0) {
    const size = String(messages[start - 1].text ?? "").length;
    if (totalChars + size > maxChars && start < messages.length) break;
    if (totalChars + size > maxChars && start === messages.length) {
      messages[start - 1] = {
        ...messages[start - 1],
        text: String(messages[start - 1].text ?? "").slice(0, maxChars),
      };
      truncated = true;
      totalChars = maxChars;
      start -= 1;
      break;
    }
    totalChars += size;
    start -= 1;
  }
  if (start > 0) {
    messages = messages.slice(start);
    truncated = true;
  }
  return {
    threadId,
    mode: "full",
    sessionFile: path.basename(filePath),
    messageCount: messages.length,
    truncated,
    redacted: Boolean(redact),
    collectedAt: new Date().toISOString(),
    contextSignature: fullContextSignature(threadId, messages),
    messages,
  };
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
    version: AGENT_VERSION,
    heartbeatSeq: heartbeatSeq += 1,
    collectedAt: new Date().toISOString(),
    agentStartedAt: AGENT_STARTED_AT,
    update: {
      currentVersion: AGENT_VERSION,
      latestKnownVersion: null,
      policy: "server",
    },
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
    sessionFileIndex = null;
    SESSION_CACHE.clear();
    return { ok: true, skipped: false, message: "refresh acknowledged" };
  }

  if (action.kind === "selfUpdate") {
    return {
      ok: true,
      skipped: true,
      message: "selfUpdate acknowledged; run the platform installer to replace binaries safely",
      version: AGENT_VERSION,
    };
  }

  if (action.kind === "readThreadContext") {
    if (!action.threadId) throw new Error("readThreadContext requires threadId");
    return readFullSessionContext(
      String(action.threadId),
      clampNumber(action.maxMessages ?? action.limit, 200, 1, 2000),
      clampNumber(action.maxChars, 240000, 1000, 2_000_000),
      action.redact !== false,
    );
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
        version: AGENT_VERSION,
        heartbeatSeq: heartbeatSeq += 1,
        collectedAt: new Date().toISOString(),
        agentStartedAt: AGENT_STARTED_AT,
        agentLastErrorAt: new Date().toISOString(),
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
