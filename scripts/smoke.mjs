const SERVER = process.env.CODEXHUB_SERVER ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.CODEXHUB_ADMIN_TOKEN ?? process.env.CODEXHUB_TOKEN ?? "dev-token";
const INSTALL_KEY = process.env.CODEXHUB_INSTALL_KEY ?? process.env.CODEXHUB_TOKEN ?? ADMIN_TOKEN;
const NODE = process.env.CODEXHUB_NODE_ID ?? "TMT-DEMO";

async function request(method, path, body, token) {
  const response = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

async function post(path, body, token) {
  return request("POST", path, body, token);
}

async function get(path, token) {
  return request("GET", path, null, token);
}

const enrollment = await post("/api/enroll", {
  installKey: INSTALL_KEY,
  nodeId: NODE,
  nodeName: NODE,
  host: {
    hostname: "demo-host",
    platform: "win32",
    release: "test",
    arch: "x64",
  },
}, INSTALL_KEY);

const nodeKey = enrollment.credentials.nodeKey;

async function queueAction(body) {
  return post(`/api/nodes/${encodeURIComponent(NODE)}/actions`, body, ADMIN_TOKEN);
}

async function adminNodeAction(action, body = {}) {
  return post(`/api/nodes/${encodeURIComponent(NODE)}/${action}`, body, ADMIN_TOKEN);
}

async function pollCommands() {
  return get(`/api/nodes/${encodeURIComponent(NODE)}/commands/poll`, nodeKey);
}

async function completeCommand(id) {
  return post(`/api/nodes/${encodeURIComponent(NODE)}/commands/${encodeURIComponent(id)}/result`, {
    ok: true,
    result: { ok: true, simulated: true },
  }, nodeKey);
}

async function assertUnauthorized() {
  const response = await fetch(`${SERVER}/api/state`, {
    headers: { authorization: "Bearer wrong-token" },
  });
  if (response.status !== 401) {
    throw new Error(`Expected unauthorized status 401, got ${response.status}`);
  }
}

const now = Math.floor(Date.now() / 1000);
await post(`/api/nodes/${encodeURIComponent(NODE)}/heartbeat`, {
  name: NODE,
  version: "smoke",
  host: {
    hostname: "demo-host",
    platform: "win32",
    release: "test",
    arch: "x64",
  },
  farfield: {
    ok: true,
    appReady: true,
    ipcConnected: true,
    ipcInitialized: true,
    codexAvailable: true,
  },
  threads: [
    {
      id: "thread-running",
      provider: "codex",
      title: "内容生成任务",
      preview: "正在生成小红书文案批量素材",
      cwd: "C:\\codex\\demo",
      createdAt: now - 3600,
      updatedAt: now - 30,
      isGenerating: true,
    },
    {
      id: "thread-waiting",
      provider: "codex",
      title: "API 对接",
      preview: "需要确认是否允许执行测试命令",
      cwd: "C:\\codex\\demo",
      createdAt: now - 7200,
      updatedAt: now - 120,
      waitingOnApproval: true,
    },
  ],
}, nodeKey);

await queueAction({ kind: "interrupt", provider: "codex", threadId: "thread-waiting" });
const commandBatch = await pollCommands();
if ((commandBatch.commands ?? []).length !== 1) {
  throw new Error(`Expected 1 queued command, got ${(commandBatch.commands ?? []).length}`);
}
await completeCommand(commandBatch.commands[0].id);
await adminNodeAction("update", { name: `${NODE}-RENAMED`, tags: ["smoke"] });
await adminNodeAction("revoke");
const revoked = await fetch(`${SERVER}/api/nodes/${encodeURIComponent(NODE)}/heartbeat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${nodeKey}`,
  },
  body: JSON.stringify({ name: NODE, threads: [] }),
});
if (revoked.status !== 401) {
  throw new Error(`Expected revoked node heartbeat to return 401, got ${revoked.status}`);
}
const reenrolled = await post("/api/enroll", {
  installKey: INSTALL_KEY,
  nodeId: NODE,
  nodeName: NODE,
}, INSTALL_KEY);
const newNodeKey = reenrolled.credentials.nodeKey;
await post(`/api/nodes/${encodeURIComponent(NODE)}/heartbeat`, {
  name: NODE,
  version: "smoke",
  host: {
    hostname: "demo-host",
    platform: "win32",
    release: "test",
    arch: "x64",
  },
  farfield: {
    ok: true,
    appReady: true,
    ipcConnected: true,
    ipcInitialized: true,
    codexAvailable: true,
  },
  threads: [
    {
      id: "thread-running",
      provider: "codex",
      title: "内容生成任务",
      preview: "正在生成小红书文案批量素材",
      cwd: "C:\\codex\\demo",
      createdAt: now - 3600,
      updatedAt: now - 30,
      isGenerating: true,
    },
    {
      id: "thread-waiting",
      provider: "codex",
      title: "API 对接",
      preview: "需要确认是否允许执行测试命令",
      cwd: "C:\\codex\\demo",
      createdAt: now - 7200,
      updatedAt: now - 120,
      waitingOnApproval: true,
    },
  ],
}, newNodeKey);
await assertUnauthorized();
const audit = await get("/api/audit?limit=20", ADMIN_TOKEN);
if ((audit.auditLogs ?? []).length < 4) {
  throw new Error("Expected audit logs to be recorded");
}
const installProfile = await get("/api/install-profile", ADMIN_TOKEN);
if (!installProfile.installKey || !installProfile.desktop?.powershell?.includes("install-desktop-agent.ps1")) {
  throw new Error("Expected install profile to include install key and PowerShell command");
}
const security = await get("/api/security/status", ADMIN_TOKEN);
if (!security.auth || !security.devices || !security.storage) {
  throw new Error("Expected security status to include auth, devices and storage");
}
const backups = await get("/api/backups", ADMIN_TOKEN);
if (!Array.isArray(backups.backups)) {
  throw new Error("Expected backup list");
}
const update = await get("/api/update/check", ADMIN_TOKEN);
if (!update.currentVersion) {
  throw new Error("Expected update check to include currentVersion");
}
await queueAction({ kind: "selfUpdate", provider: "codex" });

const state = await get("/api/state", ADMIN_TOKEN);
console.log(JSON.stringify(state.totals, null, 2));
