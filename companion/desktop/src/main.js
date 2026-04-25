const { app, Menu, Tray, shell, dialog, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "CodexHub Companion";
const WINDOWS_TASKS = ["CodexHubFarfield", "CodexHubAgent"];
const LINUX_SERVICES = ["codexhub-farfield.service", "codexhub-agent.service"];
const MACOS_LABELS = ["com.codexhub.farfield", "com.codexhub.agent"];

let tray = null;
let lastStatus = "Checking";
let lastConfig = readAgentConfig();

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
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#336289"/>
      <text x="32" y="39" text-anchor="middle" font-size="22" font-family="Arial" font-weight="700" fill="#fff">CH</text>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
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

async function linuxServiceState(name) {
  const result = await run("systemctl", ["--user", "is-active", name]);
  return result.stdout.trim() || "unknown";
}

async function macosServiceState(label) {
  const result = await run("launchctl", ["print", `gui/${process.getuid()}/${label}`]);
  return result.ok ? "loaded" : "missing";
}

async function queryStatus() {
  lastConfig = readAgentConfig();
  if (process.platform === "win32") {
    const states = await Promise.all(WINDOWS_TASKS.map((task) => windowsTaskState(task)));
    return states.map((state, index) => `${WINDOWS_TASKS[index]}=${state}`).join(", ");
  }
  if (process.platform === "darwin") {
    const states = await Promise.all(MACOS_LABELS.map((label) => macosServiceState(label)));
    return states.map((state, index) => `${MACOS_LABELS[index]}=${state}`).join(", ");
  }
  const states = await Promise.all(LINUX_SERVICES.map((service) => linuxServiceState(service)));
  return states.map((state, index) => `${LINUX_SERVICES[index]}=${state}`).join(", ");
}

async function startServices() {
  if (process.platform === "win32") {
    for (const task of WINDOWS_TASKS) await run("schtasks.exe", ["/Run", "/TN", task]);
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

async function stopServices() {
  if (process.platform === "win32") {
    for (const task of WINDOWS_TASKS.toReversed()) await run("schtasks.exe", ["/End", "/TN", task]);
  } else if (process.platform === "darwin") {
    for (const label of MACOS_LABELS.toReversed()) {
      const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
      if (fs.existsSync(plist)) await run("launchctl", ["unload", plist]);
    }
  } else {
    for (const service of LINUX_SERVICES.toReversed()) await run("systemctl", ["--user", "stop", service]);
  }
  await refresh();
}

async function openConfigFolder() {
  const filePath = configPath();
  await shell.openPath(path.dirname(filePath));
}

async function showStatusDialog() {
  lastConfig = readAgentConfig();
  dialog.showMessageBox({
    type: "info",
    title: APP_NAME,
    message: "CodexHub local status",
    detail: [
      `Status: ${lastStatus}`,
      `Config: ${configPath()}`,
      `Server: ${lastConfig.server || "not configured"}`,
      `Node: ${lastConfig.nodeName || lastConfig.nodeId || os.hostname()}`,
    ].join("\n"),
  });
}

function rebuildMenu() {
  const menu = Menu.buildFromTemplate([
    { label: `Status: ${lastStatus}`, enabled: false },
    { type: "separator" },
    { label: "Open Console", click: () => shell.openExternal(consoleUrl("/")) },
    { label: "Open TV Dashboard", click: () => shell.openExternal(consoleUrl("/tv.html")) },
    { type: "separator" },
    { label: "Start Local Services", click: startServices },
    { label: "Stop Local Services", click: stopServices },
    { label: "Refresh Status", click: refresh },
    { type: "separator" },
    { label: "Open Config Folder", click: openConfigFolder },
    { label: "Show Details", click: showStatusDialog },
    { type: "separator" },
    { label: "Quit Companion", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`${APP_NAME}\n${lastStatus}`);
}

async function refresh() {
  lastStatus = "Checking";
  rebuildMenu();
  lastStatus = await queryStatus();
  rebuildMenu();
}

app.setName(APP_NAME);
app.whenReady().then(async () => {
  tray = new Tray(trayIcon());
  rebuildMenu();
  await refresh();
  setInterval(refresh, 30_000);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
