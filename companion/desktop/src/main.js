const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pkg = require("../package.json");

const APP_NAME = "CodexHub Companion";
const LATEST_RELEASE_API = "https://api.github.com/repos/hedatu/codexhub/releases/latest";
const WINDOWS_TASKS = ["CodexHubFarfield", "CodexHubAgent"];
const LINUX_SERVICES = ["codexhub-farfield.service", "codexhub-agent.service"];
const MACOS_LABELS = ["com.codexhub.farfield", "com.codexhub.agent"];
const WINDOWS_RUN_NAME = "CodexHub Companion";

const I18N = {
  zh: {
    checking: "检查中",
    localStatus: "本机状态",
    status: "状态",
    connected: "已连接",
    attention: "需处理",
    node: "节点",
    name: "名称",
    nodeId: "节点 ID",
    server: "服务器",
    config: "配置",
    notConfigured: "未配置",
    cloud: "云端",
    lastSeen: "最后上报",
    running: "运行中",
    attentionCount: "待处理",
    localUrl: "本地地址",
    health: "健康",
    ok: "正常",
    offline: "离线",
    appReady: "应用就绪",
    startup: "启动",
    companionLogin: "Companion 开机启动",
    startupSource: "启动来源",
    installFolder: "安装目录",
    logFolder: "日志目录",
    enabled: "已启用",
    disabled: "未启用",
    localServices: "本地服务",
    state: "状态",
    detail: "详情",
    lastResult: "结果",
    servicesSummary: (running, total) => `本地服务 ${running}/${total}`,
    farfieldOk: "Farfield 正常",
    farfieldOffline: "Farfield 离线",
    cloudOk: (status) => `云端 ${status}`,
    cloudOffline: "云端离线",
    serviceStates: {
      Running: "运行中",
      RunningManual: "运行中（手动）",
      Ready: "就绪",
      Queued: "已排队",
      Disabled: "已禁用",
      Missing: "未注册",
      active: "运行中",
      loaded: "已加载",
      inactive: "未运行",
      failed: "失败",
    },
    yes: "是",
    no: "否",
    never: "从未",
    menuOpenStatus: "打开本机状态",
    menuOpenConsole: "打开控制台",
    menuOpenTv: "打开大屏",
    menuStart: "启动本地服务",
    menuStop: "停止本地服务",
    menuRefresh: "刷新状态",
    menuCheckUpdate: "检查更新",
    menuAutoRepair: "自动修复本机服务",
    menuLanguage: "语言",
    menuLaunchAtLogin: "开机启动 Companion",
    menuOpenConfig: "打开配置目录",
    menuOpenLogs: "打开日志目录",
    menuShowDetails: "显示详情",
    menuQuit: "退出 Companion",
    dialogTitle: "CodexHub 本机状态",
    updateReady: (version) => `发现新版本 ${version}`,
    updateCurrent: "当前已是最新版本",
    autoRepair: "自动修复",
    lastRepair: "最近修复",
  },
  en: {
    checking: "Checking",
    localStatus: "Local Status",
    status: "Status",
    connected: "connected",
    attention: "attention",
    node: "Node",
    name: "Name",
    nodeId: "Node ID",
    server: "Server",
    config: "Config",
    notConfigured: "not configured",
    cloud: "Cloud",
    lastSeen: "Last Seen",
    running: "Running",
    attentionCount: "Attention",
    localUrl: "Local URL",
    health: "Health",
    ok: "ok",
    offline: "offline",
    appReady: "App Ready",
    startup: "Startup",
    companionLogin: "Companion Login",
    startupSource: "Startup Source",
    installFolder: "Install Folder",
    logFolder: "Log Folder",
    enabled: "enabled",
    disabled: "disabled",
    localServices: "Local Services",
    state: "State",
    detail: "Detail",
    lastResult: "Last Result",
    servicesSummary: (running, total) => `${running}/${total} local services`,
    farfieldOk: "Farfield OK",
    farfieldOffline: "Farfield offline",
    cloudOk: (status) => `Cloud ${status}`,
    cloudOffline: "Cloud offline",
    serviceStates: {
      Running: "Running",
      RunningManual: "Running manually",
      Ready: "Ready",
      Queued: "Queued",
      Disabled: "Disabled",
      Missing: "Missing",
      active: "active",
      loaded: "loaded",
      inactive: "inactive",
      failed: "failed",
    },
    yes: "Yes",
    no: "No",
    never: "never",
    menuOpenStatus: "Open Local Status",
    menuOpenConsole: "Open Console",
    menuOpenTv: "Open TV Dashboard",
    menuStart: "Start Local Services",
    menuStop: "Stop Local Services",
    menuRefresh: "Refresh Status",
    menuCheckUpdate: "Check for Updates",
    menuAutoRepair: "Auto Repair Local Services",
    menuLanguage: "Language",
    menuLaunchAtLogin: "Launch Companion at Login",
    menuOpenConfig: "Open Config Folder",
    menuOpenLogs: "Open Log Folder",
    menuShowDetails: "Show Details",
    menuQuit: "Quit Companion",
    dialogTitle: "CodexHub local status",
    updateReady: (version) => `New version available: ${version}`,
    updateCurrent: "You are on the latest version",
    autoRepair: "Auto Repair",
    lastRepair: "Last Repair",
  },
};

let tray = null;
let statusWindow = null;
let currentLanguage = readSettings().language || "zh";
let lastStatus = I18N[currentLanguage].checking;
let lastDetails = null;
let lastConfig = readAgentConfig();
let repairInFlight = false;
let lastRepair = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  openStatusWindow().catch(() => {});
});

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error,
      });
    });
  });
}

function configPath() {
  if (process.platform === "win32") {
    return path.join(process.env.ProgramData || "C:\\ProgramData", "CodexHub", "agent.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "CodexHub", "agent.json");
  }
  return path.join(os.homedir(), ".config", "codexhub", "agent.json");
}

function installDir() {
  if (process.platform === "win32") {
    return path.join(process.env.ProgramData || "C:\\ProgramData", "CodexHub");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "CodexHub");
  }
  return path.join(os.homedir(), ".local", "share", "codexhub");
}

function logFolder() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", "CodexHub");
  }
  return installDir();
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    const filePath = settingsPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const filePath = settingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

function autoRepairEnabled() {
  return readSettings().autoRepair !== false;
}

function text() {
  return I18N[currentLanguage] || I18N.zh;
}

async function setLanguage(language) {
  currentLanguage = language === "en" ? "en" : "zh";
  writeSettings({ ...readSettings(), language: currentLanguage });
  lastStatus = lastDetails ? summarizeStatus(lastDetails) : text().checking;
  rebuildMenu();
  if (statusWindow && !statusWindow.isDestroyed()) {
    await openStatusWindow();
  }
}

function compareVersion(a, b) {
  const pa = String(a || "0").replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const pb = String(b || "0").replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] || 0) - (pb[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function downloadUpdateInstaller(asset) {
  const target = path.join(os.tmpdir(), asset.name || "codexhub-companion-update.exe");
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, bytes);
  if (asset.size && bytes.length !== asset.size) {
    throw new Error(`Downloaded size mismatch: ${bytes.length} != ${asset.size}`);
  }
  return target;
}

async function checkForUpdates(interactive = true) {
  try {
    const result = await fetchJson(LATEST_RELEASE_API);
    if (!result.ok) throw new Error(result.payload?.message || `HTTP ${result.status}`);
    const latest = String(result.payload?.tag_name || "").replace(/^v/, "");
    if (latest && compareVersion(latest, pkg.version) > 0) {
      const installerAsset = (result.payload?.assets ?? []).find((asset) => /companion-installer-windows-x64.*\.exe$/i.test(asset.name || ""));
      const choice = await dialog.showMessageBox({
        type: "info",
        buttons: [
          installerAsset && process.platform === "win32" ? (currentLanguage === "en" ? "Install Update" : "下载并安装") : (currentLanguage === "en" ? "Open Release" : "打开下载页"),
          currentLanguage === "en" ? "Open Release" : "打开下载页",
          currentLanguage === "en" ? "Later" : "稍后",
        ],
        defaultId: 0,
        message: text().updateReady(latest),
        detail: result.payload?.html_url || "https://github.com/hedatu/codexhub/releases/latest",
      });
      if (choice.response === 0 && installerAsset && process.platform === "win32") {
        const installer = await downloadUpdateInstaller(installerAsset);
        await shell.openPath(installer);
      } else if (choice.response === 0 || choice.response === 1) {
        await shell.openExternal(result.payload.html_url);
      }
      return { ok: true, latest, updateAvailable: true };
    }
    if (interactive) {
      await dialog.showMessageBox({ type: "info", message: text().updateCurrent, detail: `${APP_NAME} ${pkg.version}` });
    }
    return { ok: true, latest: latest || pkg.version, updateAvailable: false };
  } catch (error) {
    if (interactive) {
      await dialog.showMessageBox({ type: "warning", message: currentLanguage === "en" ? "Update check failed" : "检查更新失败", detail: error.message });
    }
    return { ok: false, error: error.message };
  }
}

function readAgentConfig() {
  try {
    const filePath = configPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function consoleUrl(pathname = "/") {
  const server = String(lastConfig.server || "https://codex.915500.xyz").replace(/\/+$/, "");
  return `${server}${pathname}`;
}

function trayIcon() {
  const iconPath = path.join(__dirname, "..", "assets", process.platform === "win32" ? "icon.ico" : "icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  return process.platform === "darwin" ? icon.resize({ width: 18, height: 18 }) : icon.resize({ width: 24, height: 24 });
}

async function windowsTaskState(name) {
  const result = await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `(Get-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue).State`,
  ]);
  return result.stdout.trim() || "Missing";
}

async function windowsTaskDetails() {
  const command = `
    $names = @(${WINDOWS_TASKS.map((task) => `'${task}'`).join(",")});
    $items = foreach ($name in $names) {
      $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;
      $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue;
      [pscustomobject]@{
        name = $name;
        kind = 'scheduled-task';
        state = if ($task) { [string]$task.State } else { 'Missing' };
        lastRunTime = if ($info) { $info.LastRunTime } else { $null };
        lastResult = if ($info) { $info.LastTaskResult } else { $null };
        nextRunTime = if ($info) { $info.NextRunTime } else { $null };
      }
    }
    $items | ConvertTo-Json -Compress
  `;
  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  if (!result.ok) {
    return windowsProcessBackedServiceDetails();
  }
  try {
    return enrichWindowsMissingServices([JSON.parse(result.stdout)].flat());
  } catch {
    return windowsProcessBackedServiceDetails();
  }
}

async function windowsProcessBackedServiceDetails() {
  return enrichWindowsMissingServices(WINDOWS_TASKS.map((name) => ({ name, kind: "scheduled-task", state: "Missing" })));
}

async function enrichWindowsMissingServices(rows) {
  const processes = await windowsCodexHubProcesses();
  return rows.map((row) => {
    if (row.state === "Running") return row;
    const match = row.name === "CodexHubFarfield"
      ? processes.find((process) => /@farfield[\\/]server|@farfield\/server|PORT\s*=\s*['"]?4311|127\.0\.0\.1:4311/i.test(process.commandLine))
      : processes.find((process) => /codexhub-agent|desktop-agent[\\/]agent\.mjs|desktop-agent\\agent\.mjs/i.test(process.commandLine));
    if (!match) return row;
    return {
      ...row,
      state: "RunningManual",
      subState: "process fallback",
      lastResult: `PID ${match.processId}`,
      path: match.commandLine,
    };
  });
}

async function windowsCodexHubProcesses() {
  const command = `
    Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -match 'CodexHub|farfield|4311|desktop-agent|codexhub-agent' } |
      Select-Object @{n='processId';e={$_.ProcessId}}, @{n='name';e={$_.Name}}, @{n='commandLine';e={$_.CommandLine}} |
      ConvertTo-Json -Compress
  `;
  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  if (!result.ok || !result.stdout.trim()) return [];
  try {
    return [JSON.parse(result.stdout)].flat().map((row) => ({
      processId: row.processId,
      name: row.name || "",
      commandLine: row.commandLine || "",
    }));
  } catch {
    return [];
  }
}

async function linuxServiceState(name) {
  const result = await run("systemctl", ["--user", "is-active", name]);
  return result.stdout.trim() || "unknown";
}

function parseSystemdShow(output) {
  const row = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) row[line.slice(0, index)] = line.slice(index + 1);
  }
  return row;
}

async function linuxServiceDetails() {
  return Promise.all(LINUX_SERVICES.map(async (name) => {
    const result = await run("systemctl", ["--user", "show", name, "--property=Id,LoadState,ActiveState,SubState,ExecMainStatus,FragmentPath", "--no-pager"]);
    if (!result.ok) return { name, kind: "systemd-user", state: await linuxServiceState(name) };
    const row = parseSystemdShow(result.stdout);
    return {
      name,
      kind: "systemd-user",
      state: row.ActiveState || "unknown",
      subState: row.SubState || "",
      loadState: row.LoadState || "",
      lastResult: row.ExecMainStatus || "",
      path: row.FragmentPath || "",
    };
  }));
}

async function macosServiceState(label) {
  const result = await run("launchctl", ["print", `gui/${process.getuid()}/${label}`]);
  return result.ok ? "loaded" : "missing";
}

async function macosServiceDetails() {
  return Promise.all(MACOS_LABELS.map(async (label) => {
    const result = await run("launchctl", ["print", `gui/${process.getuid()}/${label}`]);
    return {
      name: label,
      kind: "launch-agent",
      state: result.ok ? "loaded" : "missing",
      lastResult: result.ok ? "" : result.stderr.trim(),
      path: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`),
    };
  }));
}

async function fetchJson(url, token = "") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function queryFarfieldHealth(config) {
  const farfieldUrl = String(config.farfieldUrl || "http://127.0.0.1:4311").replace(/\/+$/, "");
  try {
    const result = await fetchJson(`${farfieldUrl}/api/health`);
    const state = result.payload?.state || {};
    return {
      ok: Boolean(result.ok && result.payload?.ok !== false),
      url: farfieldUrl,
      appReady: Boolean(state.appReady),
      ipcConnected: Boolean(state.ipcConnected),
      codexAvailable: state.codexAvailable !== false,
      lastError: state.lastError || result.payload?.error || "",
    };
  } catch (error) {
    return { ok: false, url: farfieldUrl, lastError: error.message };
  }
}

async function queryCloudSelf(config) {
  if (!config.server || !config.nodeId || !config.nodeKey) {
    return { ok: false, status: "not enrolled", lastError: "Missing server, nodeId, or nodeKey in agent config." };
  }
  const server = String(config.server).replace(/\/+$/, "");
  try {
    const result = await fetchJson(`${server}/api/nodes/${encodeURIComponent(config.nodeId)}/self`, config.nodeKey);
    if (!result.ok) return { ok: false, status: result.status, lastError: result.payload?.error || "Cloud check failed" };
    const node = result.payload?.node || {};
    return {
      ok: true,
      status: node.status || "unknown",
      lastSeenAt: node.lastSeenAt || "",
      metrics: node.metrics || {},
    };
  } catch (error) {
    return { ok: false, status: "error", lastError: error.message };
  }
}

async function serviceDetails() {
  if (process.platform === "win32") return windowsTaskDetails();
  if (process.platform === "darwin") return macosServiceDetails();
  return linuxServiceDetails();
}

function runningServiceCount(services) {
  return services.filter((service) => ["Running", "RunningManual", "active", "loaded"].includes(service.state)).length;
}

function summarizeStatus(details) {
  const tx = text();
  const services = tx.servicesSummary(runningServiceCount(details.services), details.services.length);
  const farfield = details.farfield.ok ? tx.farfieldOk : tx.farfieldOffline;
  const cloud = details.cloud.ok ? tx.cloudOk(details.cloud.status) : tx.cloudOffline;
  return `${services}, ${farfield}, ${cloud}`;
}

async function queryStatus() {
  lastConfig = readAgentConfig();
  const details = {
    generatedAt: new Date().toISOString(),
    configPath: configPath(),
    installDir: installDir(),
    logFolder: logFolder(),
    startup: await startupSettings(),
    autoRepair: { enabled: autoRepairEnabled(), lastRepair },
    version: pkg.version,
    config: lastConfig,
    services: await serviceDetails(),
    farfield: await queryFarfieldHealth(lastConfig),
    cloud: await queryCloudSelf(lastConfig),
  };
  lastDetails = details;
  return summarizeStatus(details);
}

async function startServices() {
  if (process.platform === "win32") {
    for (const task of WINDOWS_TASKS) {
      const result = await run("schtasks.exe", ["/Run", "/TN", task]);
      if (!result.ok) startWindowsManualService(task);
    }
  } else if (process.platform === "darwin") {
    for (const label of MACOS_LABELS) {
      const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
      if (fs.existsSync(plist)) await run("launchctl", ["load", plist]);
    }
  } else {
    for (const service of LINUX_SERVICES) await run("systemctl", ["--user", "start", service]);
  }
  await refresh();
}

function needsRepair(details) {
  const services = details.services || [];
  const serviceBroken = services.some((service) => !serviceOk(service));
  return serviceBroken || !details.farfield?.ok || !details.cloud?.ok;
}

async function autoRepairTick() {
  if (!autoRepairEnabled() || repairInFlight) return;
  repairInFlight = true;
  try {
    await queryStatus();
    if (!needsRepair(lastDetails)) return;
    await startServices();
    lastRepair = {
      at: new Date().toISOString(),
      reason: summarizeStatus(lastDetails),
    };
    writeSettings({ ...readSettings(), lastRepair });
  } catch (error) {
    lastRepair = { at: new Date().toISOString(), reason: error.message };
  } finally {
    repairInFlight = false;
  }
}

async function stopServices() {
  if (process.platform === "win32") {
    for (const task of WINDOWS_TASKS.slice().reverse()) await run("schtasks.exe", ["/End", "/TN", task]);
    await stopWindowsManualServices();
  } else if (process.platform === "darwin") {
    for (const label of MACOS_LABELS.slice().reverse()) {
      const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
      if (fs.existsSync(plist)) await run("launchctl", ["unload", plist]);
    }
  } else {
    for (const service of LINUX_SERVICES.slice().reverse()) await run("systemctl", ["--user", "stop", service]);
  }
  await refresh();
}

function startWindowsManualService(task) {
  if (task === "CodexHubFarfield") {
    const wrapperPath = path.join(installDir(), "codex-wrapper.exe");
    const command = `$env:CODEX_CLI_PATH = '${wrapperPath}'; $env:PORT = '4311'; Set-Location '${process.env.CODEXHUB_FARFIELD_CWD || "C:\\codex"}'; & npx.cmd -y '@farfield/server@latest'`;
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd: process.env.CODEXHUB_FARFIELD_CWD || "C:\\codex",
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  const agentPath = path.join(installDir(), "src", "desktop-agent", "agent.mjs");
  spawn("node.exe", [agentPath, "--config", configPath()], {
    cwd: installDir(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

async function stopWindowsManualServices() {
  const command = `
    Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -match '@farfield/server|desktop-agent\\\\agent\\.mjs|desktop-agent/agent\\.mjs|codexhub-agent' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `;
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { timeout: 30_000 });
}

async function openConfigFolder() {
  const filePath = configPath();
  await shell.openPath(path.dirname(filePath));
}

async function openLogFolder() {
  await shell.openPath(logFolder());
}

async function startupSettings() {
  const electronLogin = app.getLoginItemSettings();
  if (process.platform !== "win32") {
    return { enabled: Boolean(electronLogin.openAtLogin), source: "electron-login-item" };
  }
  const result = await run("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", WINDOWS_RUN_NAME]);
  const enabled = result.ok && result.stdout.toLowerCase().includes("codexhub companion.exe");
  return { enabled: enabled || Boolean(electronLogin.openAtLogin), source: enabled ? "HKCU Run" : "electron-login-item" };
}

async function setStartupEnabled(enabled) {
  if (process.platform === "win32") {
    if (enabled) {
      await run("reg.exe", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", WINDOWS_RUN_NAME, "/t", "REG_SZ", "/d", `"${process.execPath}"`, "/f"]);
    } else {
      await run("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", WINDOWS_RUN_NAME, "/f"]);
    }
  }
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return text().never;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(currentLanguage === "en" ? "en-US" : "zh-CN");
}

function statusClass(ok) {
  return ok ? "ok" : "bad";
}

function serviceOk(service) {
  return ["Running", "RunningManual", "active", "loaded"].includes(service.state);
}

function serviceStateLabel(state) {
  return text().serviceStates[state] || state || (currentLanguage === "en" ? "unknown" : "未知");
}

function yesNo(value) {
  return value ? text().yes : text().no;
}

function statusHtml(details) {
  const tx = text();
  const config = details.config || {};
  const services = details.services || [];
  const rows = services.map((service) => `
    <tr>
      <td>${escapeHtml(service.name)}</td>
      <td><span class="pill ${statusClass(serviceOk(service))}">${escapeHtml(serviceStateLabel(service.state))}</span></td>
      <td>${escapeHtml(service.subState || service.loadState || "")}</td>
      <td>${escapeHtml(service.lastResult ?? "")}</td>
    </tr>
  `).join("");
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>CodexHub Companion ${escapeHtml(tx.localStatus)}</title>
      <style>
        :root { color-scheme: light; --ink:#1a1c1e; --muted:#66707b; --line:#d9e0e8; --bg:#f7f9fc; --panel:#fff; --primary:#336289; --green:#2c6956; --red:#af2c2c; }
        body { margin:0; padding:22px; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; }
        header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
        h1 { margin:0; font-size:24px; }
        h2 { margin:0 0 10px; font-size:15px; }
        p { margin:4px 0; color:var(--muted); }
        .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px; }
        .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; box-shadow:0 12px 34px rgba(43,71,94,.08); }
        .wide { grid-column:1 / -1; }
        .kv { display:grid; gap:7px; }
        .kv div { display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid var(--line); padding-bottom:7px; }
        .kv strong { text-align:right; overflow-wrap:anywhere; }
        .pill { display:inline-flex; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:800; background:#eef2f6; color:var(--muted); }
        .pill.ok { background:#dff5ec; color:var(--green); }
        .pill.bad { background:#ffe0dd; color:var(--red); }
        table { width:100%; border-collapse:collapse; }
        th, td { text-align:left; border-top:1px solid var(--line); padding:8px; vertical-align:top; }
        th { color:var(--muted); font-size:12px; }
        code { overflow-wrap:anywhere; }
        @media (max-width: 680px) { body { padding:14px; } .grid { grid-template-columns:1fr; } }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>CodexHub Companion</h1>
          <p>${escapeHtml(tx.localStatus)}</p>
          <p>${escapeHtml(lastStatus)}</p>
        </div>
        <span class="pill ${statusClass(details.cloud.ok && details.farfield.ok)}">${escapeHtml(details.cloud.ok && details.farfield.ok ? tx.connected : tx.attention)}</span>
      </header>
      <main class="grid">
        <section class="card">
          <h2>${escapeHtml(tx.node)}</h2>
          <div class="kv">
            <div><span>Companion</span><strong>${escapeHtml(details.version || pkg.version)}</strong></div>
            <div><span>${escapeHtml(tx.name)}</span><strong>${escapeHtml(config.nodeName || config.nodeId || os.hostname())}</strong></div>
            <div><span>${escapeHtml(tx.nodeId)}</span><strong>${escapeHtml(config.nodeId || tx.notConfigured)}</strong></div>
            <div><span>${escapeHtml(tx.server)}</span><strong>${escapeHtml(config.server || tx.notConfigured)}</strong></div>
            <div><span>${escapeHtml(tx.config)}</span><strong><code>${escapeHtml(details.configPath)}</code></strong></div>
          </div>
        </section>
        <section class="card">
          <h2>${escapeHtml(tx.autoRepair)}</h2>
          <div class="kv">
            <div><span>${escapeHtml(tx.status)}</span><strong>${details.autoRepair?.enabled ? tx.enabled : tx.disabled}</strong></div>
            <div><span>${escapeHtml(tx.lastRepair)}</span><strong>${escapeHtml(details.autoRepair?.lastRepair?.at ? formatTime(details.autoRepair.lastRepair.at) : tx.never)}</strong></div>
          </div>
          ${details.autoRepair?.lastRepair?.reason ? `<p>${escapeHtml(details.autoRepair.lastRepair.reason)}</p>` : ""}
        </section>
        <section class="card">
          <h2>${escapeHtml(tx.cloud)}</h2>
          <div class="kv">
            <div><span>${escapeHtml(tx.status)}</span><strong><span class="pill ${statusClass(details.cloud.ok)}">${escapeHtml(details.cloud.status || "unknown")}</span></strong></div>
            <div><span>${escapeHtml(tx.lastSeen)}</span><strong>${escapeHtml(formatTime(details.cloud.lastSeenAt))}</strong></div>
            <div><span>${escapeHtml(tx.running)}</span><strong>${escapeHtml(details.cloud.metrics?.running ?? 0)}</strong></div>
            <div><span>${escapeHtml(tx.attentionCount)}</span><strong>${escapeHtml(details.cloud.metrics?.attention ?? 0)}</strong></div>
          </div>
          ${details.cloud.lastError ? `<p>${escapeHtml(details.cloud.lastError)}</p>` : ""}
        </section>
        <section class="card">
          <h2>Farfield</h2>
          <div class="kv">
            <div><span>${escapeHtml(tx.localUrl)}</span><strong>${escapeHtml(details.farfield.url)}</strong></div>
            <div><span>${escapeHtml(tx.health)}</span><strong><span class="pill ${statusClass(details.farfield.ok)}">${details.farfield.ok ? tx.ok : tx.offline}</span></strong></div>
            <div><span>${escapeHtml(tx.appReady)}</span><strong>${yesNo(details.farfield.appReady)}</strong></div>
            <div><span>IPC</span><strong>${escapeHtml(details.farfield.ipcConnected ?? false)}</strong></div>
          </div>
          ${details.farfield.lastError ? `<p>${escapeHtml(details.farfield.lastError)}</p>` : ""}
        </section>
        <section class="card">
          <h2>${escapeHtml(tx.startup)}</h2>
          <div class="kv">
            <div><span>${escapeHtml(tx.companionLogin)}</span><strong>${details.startup?.enabled ? tx.enabled : tx.disabled}</strong></div>
            <div><span>${escapeHtml(tx.startupSource)}</span><strong>${escapeHtml(details.startup?.source || "unknown")}</strong></div>
            <div><span>${escapeHtml(tx.installFolder)}</span><strong><code>${escapeHtml(details.installDir)}</code></strong></div>
            <div><span>${escapeHtml(tx.logFolder)}</span><strong><code>${escapeHtml(details.logFolder)}</code></strong></div>
          </div>
        </section>
        <section class="card wide">
          <h2>${escapeHtml(tx.localServices)}</h2>
          <table>
            <thead><tr><th>${escapeHtml(tx.name)}</th><th>${escapeHtml(tx.state)}</th><th>${escapeHtml(tx.detail)}</th><th>${escapeHtml(tx.lastResult)}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
      </main>
    </body>
  </html>`;
}

async function openStatusWindow() {
  if (!lastDetails) {
    lastStatus = "Checking";
    lastStatus = await queryStatus();
  }
  if (!statusWindow || statusWindow.isDestroyed()) {
    statusWindow = new BrowserWindow({
      width: 780,
      height: 680,
      title: APP_NAME,
      icon: path.join(__dirname, "..", "assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    statusWindow.on("closed", () => {
      statusWindow = null;
    });
  }
  await statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(statusHtml(lastDetails))}`);
  statusWindow.show();
}

async function showStatusDialog() {
  const tx = text();
  if (!lastDetails) {
    lastStatus = await queryStatus();
  }
  lastConfig = lastDetails?.config || readAgentConfig();
  dialog.showMessageBox({
    type: "info",
    title: APP_NAME,
    message: `CodexHub ${tx.localStatus}`,
    detail: [
      `${tx.status}: ${lastStatus}`,
      `${tx.config}: ${configPath()}`,
      `${tx.server}: ${lastConfig.server || tx.notConfigured}`,
      `${tx.node}: ${lastConfig.nodeName || lastConfig.nodeId || os.hostname()}`,
      `Farfield: ${lastDetails?.farfield?.ok ? "ok" : "offline"}`,
      `${tx.cloud}: ${lastDetails?.cloud?.ok ? lastDetails.cloud.status : "offline"}`,
    ].join("\n"),
  });
}

function rebuildMenu() {
  const tx = text();
  const startup = lastDetails?.startup || { enabled: Boolean(app.getLoginItemSettings().openAtLogin) };
  const menu = Menu.buildFromTemplate([
    { label: `${tx.status}: ${lastStatus}`, enabled: false },
    { type: "separator" },
    { label: tx.menuOpenStatus, click: openStatusWindow },
    { label: tx.menuOpenConsole, click: () => shell.openExternal(consoleUrl("/")) },
    { label: tx.menuOpenTv, click: () => shell.openExternal(consoleUrl("/tv.html")) },
    { type: "separator" },
    { label: tx.menuStart, click: startServices },
    { label: tx.menuStop, click: stopServices },
    { label: tx.menuRefresh, click: refresh },
    { label: tx.menuCheckUpdate, click: () => checkForUpdates(true) },
    {
      label: tx.menuAutoRepair,
      type: "checkbox",
      checked: autoRepairEnabled(),
      click: (menuItem) => {
        writeSettings({ ...readSettings(), autoRepair: menuItem.checked });
        rebuildMenu();
      },
    },
    { type: "separator" },
    {
      label: tx.menuLanguage,
      submenu: [
        { label: "中文", type: "radio", checked: currentLanguage === "zh", click: () => setLanguage("zh") },
        { label: "English", type: "radio", checked: currentLanguage === "en", click: () => setLanguage("en") },
      ],
    },
    {
      label: tx.menuLaunchAtLogin,
      type: "checkbox",
      checked: Boolean(startup.enabled),
      click: async (menuItem) => {
        await setStartupEnabled(menuItem.checked);
        lastDetails = { ...(lastDetails || {}), startup: await startupSettings() };
        rebuildMenu();
      },
    },
    { label: tx.menuOpenConfig, click: openConfigFolder },
    { label: tx.menuOpenLogs, click: openLogFolder },
    { label: tx.menuShowDetails, click: showStatusDialog },
    { type: "separator" },
    { label: tx.menuQuit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`${APP_NAME}\n${lastStatus}`);
}

async function refresh() {
  lastStatus = text().checking;
  rebuildMenu();
  lastStatus = await queryStatus();
  rebuildMenu();
  if (statusWindow && !statusWindow.isDestroyed() && lastDetails) {
    await statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(statusHtml(lastDetails))}`);
  }
}

app.setName(APP_NAME);
app.whenReady().then(async () => {
  tray = new Tray(trayIcon());
  tray.on("click", openStatusWindow);
  rebuildMenu();
  await refresh();
  setInterval(refresh, 30_000);
  setInterval(autoRepairTick, 60_000);
  setTimeout(() => checkForUpdates(false), 15_000);
  setTimeout(autoRepairTick, 20_000);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
