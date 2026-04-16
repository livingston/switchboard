import { TUI, ProcessTerminal, matchesKey, Key, decodeKittyPrintable, isKeyRelease } from "@mariozechner/pi-tui";
import { YogaLayout } from "./yoga-layout.js";
import type { Config, View, ServerState, ServerConfig } from "./types.js";
import { loadConfig, saveConfig, getConfigPath, loadProcessState, saveProcessState } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { getBatchResourceStats, isPortListening } from "./resource-monitor.js";

import { StatusBarComponent } from "./components/status-bar.js";
import { DashboardComponent } from "./components/dashboard.js";
import { LogViewerComponent } from "./components/log-viewer.js";
import { ServerFormComponent } from "./components/server-form.js";
import { SudoPromptComponent } from "./components/sudo-prompt.js";

const pm = new ProcessManager();
let config: Config = loadConfig();
let view: View = { type: "dashboard" };
let sudoState: { key: string; config: ServerConfig; action: "start" | "stop" | "restart" } | null = null;
let preSudoComponent: import("@mariozechner/pi-tui").Component | null = null;

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

const statusBar = new StatusBarComponent();
const dashboard = new DashboardComponent();
const logViewer = new LogViewerComponent();
const serverForm = new ServerFormComponent();
const sudoPrompt = new SudoPromptComponent();

let contentComponent: import("@mariozechner/pi-tui").Component = dashboard;

const layout = new YogaLayout(
  {
    flexDirection: "column",
    children: [
      { flexGrow: 1, get component() { return contentComponent; } },
      { height: 3, component: statusBar },
    ],
  },
  () => terminal.rows || 24
);

tui.addChild(layout);

function updateHeights(): void {
  const contentHeight = (terminal.rows || 24) - 3; // 3 for status bar
  dashboard.allocatedHeight = contentHeight;
  logViewer.allocatedHeight = contentHeight;
  serverForm.allocatedHeight = contentHeight;
}

let logPollInterval: ReturnType<typeof setInterval> | null = null;

function setView(v: View): void {
  view = v;
  statusBar.viewType = v.type;
  updateHeights();
  if (v.type !== "logs" && logPollInterval) {
    clearInterval(logPollInterval);
    logPollInterval = null;
  }
  switch (v.type) {
    case "dashboard":
      contentComponent = dashboard;
      break;
    case "logs":
      logViewer.setLogSource(v.serverKey, () => pm.getLogs(v.serverKey), () => pm.getLogCount(v.serverKey));
      contentComponent = logViewer;
      if (!logPollInterval) {
        logPollInterval = setInterval(() => {
          if (logViewer.pollLogs()) tui.requestRender();
        }, 500);
      }
      break;
    case "add":
      serverForm.loadForAdd();
      contentComponent = serverForm;
      break;
    case "edit":
      serverForm.loadForEdit(config, v.serverKey);
      contentComponent = serverForm;
      break;
  }
  tui.requestRender();
}

function findServer(key: string): ServerConfig | undefined {
  const [groupName, serverName] = key.split("/");
  const group = config.groups.find((g) => g.name === groupName);
  return group?.servers.find((s) => s.name === serverName);
}

function needsSudo(server: ServerConfig): boolean {
  return !!server.sudo;
}

async function checkPorts(ports: number[]): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>();
  if (ports.length === 0) return result;
  const checks = await Promise.all(
    ports.map(async (port) => ({ port, up: await isPortListening(port) }))
  );
  for (const { port, up } of checks) result.set(port, up);
  return result;
}

function statesEqual(a: Map<string, ServerState>, b: Map<string, ServerState>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, sa] of a) {
    const sb = b.get(key);
    if (!sb) return false;
    if (sa.status !== sb.status || sa.pid !== sb.pid ||
        sa.cpu !== sb.cpu || sa.memMb !== sb.memMb ||
        sa.startedAt !== sb.startedAt) return false;
  }
  return true;
}

async function refreshStates(): Promise<void> {
  const pids: number[] = [];
  const portsToCheck: number[] = [];
  for (const group of config.groups) {
    for (const server of group.servers) {
      const pid = pm.getPid(`${group.name}/${server.name}`);
      if (pid) pids.push(pid);
      if (server.port) portsToCheck.push(server.port);
    }
  }
  const [batchStats, portStatus] = await Promise.all([
    getBatchResourceStats(pids),
    checkPorts(portsToCheck),
  ]);

  const next = new Map<string, ServerState>();
  for (const group of config.groups) {
    for (const server of group.servers) {
      const key = `${group.name}/${server.name}`;
      const pmState = pm.getState(key);
      const stats = pmState.pid ? batchStats.get(pmState.pid) : undefined;
      let status = pmState.status;
      if (status === "stopped" && server.port && portStatus.get(server.port)) {
        status = "running";
      }
      next.set(key, {
        ...pmState, status, config: server, groupName: group.name,
        cpu: stats?.cpu ?? 0, memMb: stats?.memMb ?? 0,
      });
    }
  }
  updateHeights();
  const changed = !statesEqual(dashboard.states, next);
  dashboard.states = next;
  dashboard.config = config;
  if (changed) tui.requestRender();
}

async function handleStart(key: string): Promise<void> {
  const server = findServer(key);
  if (!server) return;
  if (needsSudo(server)) {
    sudoState = { key, config: server, action: "start" };
    showSudoOverlay();
    return;
  }
  await pm.start(key, server);
  await refreshStates();
}

async function handleStop(key: string): Promise<void> {
  const server = findServer(key);
  if (server?.stopCmd && needsSudo(server)) {
    sudoState = { key, config: server, action: "stop" };
    showSudoOverlay();
    return;
  }
  await pm.stop(key, undefined, server);
  await refreshStates();
}

async function handleRestart(key: string): Promise<void> {
  const server = findServer(key);
  if (server && needsSudo(server)) {
    sudoState = { key, config: server, action: "restart" };
    showSudoOverlay();
    return;
  }
  if (server) {
    await pm.stop(key, undefined, server);
    await pm.start(key, server);
  }
  await refreshStates();
}

async function handleSudoSubmit(password: string): Promise<void> {
  if (!sudoState) return;
  const { key, config: serverConfig, action } = sudoState;

  sudoPrompt.error = "";
  sudoPrompt.busy = true;
  tui.requestRender(true);

  let result: { ok: boolean; error?: string } = { ok: true };

  try {
    if (action === "start") {
      result = await pm.start(key, serverConfig, password);
    } else if (action === "stop") {
      result = await pm.stop(key, password, serverConfig);
    } else if (action === "restart") {
      result = await pm.stop(key, password, serverConfig);
      if (result.ok) {
        result = await pm.start(key, serverConfig, password);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { ok: false, error: msg };
  }

  if (!result.ok) {
    sudoPrompt.error = result.error ?? "Failed";
    sudoPrompt.password = "";
    sudoPrompt.busy = false;
    tui.requestRender(true);
    return;
  }

  sudoState = null;
  restoreFromSudo();
  await refreshStates();
}

function showSudoOverlay(): void {
  if (!sudoState) return;
  sudoPrompt.reset(sudoState.key, sudoState.action);
  sudoPrompt.termWidth = terminal.columns || 80;
  sudoPrompt.termHeight = (terminal.rows || 24) - 3;
  preSudoComponent = contentComponent;
  contentComponent = sudoPrompt;
  tui.requestRender();
}

function restoreFromSudo(): void {
  if (preSudoComponent) {
    contentComponent = preSudoComponent;
    preSudoComponent = null;
  }
  tui.requestRender();
}

function handleSaveServer(groupName: string, server: ServerConfig, editKey?: string): void {
  const updated = { ...config, groups: [...config.groups] };
  if (editKey) {
    const [oldGroup, oldName] = editKey.split("/");
    const g = updated.groups.find((gr) => gr.name === oldGroup);
    if (g) g.servers = g.servers.filter((s) => s.name !== oldName);
  }
  let group = updated.groups.find((gr) => gr.name === groupName);
  if (!group) {
    group = { name: groupName, servers: [] };
    updated.groups.push(group);
  }
  group.servers.push(server);
  saveConfig(getConfigPath(), updated);
  config = updated;
  setView({ type: "dashboard" });
  refreshStates();
}

function handleDeleteServer(key: string): void {
  const [groupName, serverName] = key.split("/");
  const updated = { ...config, groups: [...config.groups] };
  const group = updated.groups.find((g) => g.name === groupName);
  if (group) {
    group.servers = group.servers.filter((s) => s.name !== serverName);
    if (group.servers.length === 0) {
      updated.groups = updated.groups.filter((g) => g.name !== groupName);
    }
  }
  saveConfig(getConfigPath(), updated);
  config = updated;
  dashboard.confirmDelete = null;
  refreshStates();
}

async function handleStartGroup(groupName: string): Promise<void> {
  const group = config.groups.find((g) => g.name === groupName);
  if (!group) return;
  await Promise.all(group.servers.map((server) =>
    pm.start(`${groupName}/${server.name}`, server)
  ));
  await refreshStates();
}

async function handleStopGroup(groupName: string): Promise<void> {
  const group = config.groups.find((g) => g.name === groupName);
  if (!group) return;
  await Promise.all(group.servers.map((server) =>
    pm.stop(`${groupName}/${server.name}`)
  ));
  await refreshStates();
}

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try { saveProcessState(pm.getRunningEntries()); } catch { /* best effort */ }
  try { tui.stop(); } catch { /* already stopped */ }
  process.stdout.write("\x1b[?1049l");
  process.exit(code);
}

function handleQuit(): void {
  shutdown(0);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("uncaughtException", (err) => {
  process.stdout.write("\x1b[?1049l");
  console.error(err);
  shutdown(1);
});

// ─── Input Handling ─────────────────────────────────────────────────────────

const CONSUME = { consume: true } as const;

tui.addInputListener((data: string) => {
  if (isKeyRelease(data)) return CONSUME;

  // Ctrl+L: force full repaint (recover from Cmd+K / terminal corruption)
  if (matchesKey(data, Key.ctrl("l"))) {
    tui.requestRender(true);
    return CONSUME;
  }

  if (sudoState) {
    if (sudoPrompt.busy) return CONSUME;
    if (matchesKey(data, Key.escape)) {
      sudoState = null;
      restoreFromSudo();
    } else if (matchesKey(data, Key.enter)) {
      handleSudoSubmit(sudoPrompt.password);
    } else if (matchesKey(data, Key.backspace)) {
      sudoPrompt.backspace();
      tui.requestRender();
    } else {
      const ch = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " ? data : null);
      if (ch) {
        sudoPrompt.typeChar(ch);
        tui.requestRender();
      }
    }
    return CONSUME;
  }

  switch (view.type) {
    case "dashboard": handleDashboardInput(data); break;
    case "logs": handleLogInput(data); break;
    case "add":
    case "edit": handleFormInput(data); break;
  }
  return CONSUME;
});

function handleDashboardInput(data: string): void {
  if (dashboard.confirmDelete) {
    if (data === "y") handleDeleteServer(dashboard.confirmDelete);
    else dashboard.confirmDelete = null;
    tui.requestRender();
    return;
  }

  if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) { dashboard.moveUp(); tui.requestRender(); }
  else if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) { dashboard.moveDown(); tui.requestRender(); }
  else if (data === "q") handleQuit();
  else if (data === "s" && dashboard.currentKey) handleStart(dashboard.currentKey);
  else if (data === "x" && dashboard.currentKey) handleStop(dashboard.currentKey);
  else if (data === "r" && dashboard.currentKey) handleRestart(dashboard.currentKey);
  else if (data === "l" && dashboard.currentKey) setView({ type: "logs", serverKey: dashboard.currentKey });
  else if (data === "e" && dashboard.currentKey) setView({ type: "edit", serverKey: dashboard.currentKey });
  else if (data === "a") setView({ type: "add" });
  else if (data === "d" && dashboard.currentKey) { dashboard.confirmDelete = dashboard.currentKey; tui.requestRender(); }
  else if (data === "S" && dashboard.currentGroup) handleStartGroup(dashboard.currentGroup);
  else if (data === "X" && dashboard.currentGroup) handleStopGroup(dashboard.currentGroup);
}

function handleLogInput(data: string): void {
  if (logViewer.searchMode) {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      logViewer.searchMode = false;
    } else if (matchesKey(data, Key.backspace)) {
      logViewer.search = logViewer.search.slice(0, -1);
    } else {
      const ch = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " ? data : null);
      if (ch) logViewer.search += ch;
    }
    tui.requestRender();
    return;
  }

  if (matchesKey(data, Key.escape)) setView({ type: "dashboard" });
  else if (data === "/") { logViewer.searchMode = true; logViewer.search = ""; tui.requestRender(); }
  else if (data === "f") { logViewer.follow = !logViewer.follow; tui.requestRender(); }
  else if (matchesKey(data, Key.up)) { logViewer.scrollUp(); tui.requestRender(); }
  else if (matchesKey(data, Key.down)) { logViewer.scrollDown(); tui.requestRender(); }
}

function handleFormInput(data: string): void {
  if (matchesKey(data, Key.escape)) { setView({ type: "dashboard" }); return undefined; }
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.down)) { serverForm.nextField(); tui.requestRender(); return undefined; }
  if (matchesKey(data, Key.up)) { serverForm.prevField(); tui.requestRender(); return undefined; }
  if (matchesKey(data, Key.enter)) {
    if (serverForm.activeField < 5) {
      serverForm.nextField();
    } else if (serverForm.isValid()) {
      handleSaveServer(serverForm.values.group, serverForm.toServerConfig(), serverForm.editKey);
    }
    tui.requestRender();
    return;
  }
  if (matchesKey(data, Key.backspace)) { serverForm.backspace(); tui.requestRender(); return undefined; }

  const ch = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " ? data : null);
  if (ch) { serverForm.typeChar(ch); tui.requestRender(); }
}

// ─── Polling ────────────────────────────────────────────────────────────────

setInterval(async () => {
  await refreshStates();
  saveProcessState(pm.getRunningEntries());
}, 3000);

// ─── Startup ────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const saved = loadProcessState();
  for (const group of config.groups) {
    for (const server of group.servers) {
      const key = `${group.name}/${server.name}`;
      const prev = saved[key];
      if (prev && pm.isProcessAlive(prev.pid)) {
        pm.attach(key, server, prev.pid, prev.startedAt);
      }
    }
  }

  // Enter alternate screen buffer (no scroll history, like vim/htop)
  process.stdout.write("\x1b[?1049h");
  tui.start();
  await refreshStates();
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
