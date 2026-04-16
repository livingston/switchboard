import { existsSync, readFileSync } from "fs";
import type { ServerConfig, ServerState, ServerStatus } from "./types.js";

const MAX_LOG_LINES = 1000;

let cachedShell: string | null = null;
function findShell(): string {
  if (cachedShell) return cachedShell;
  const candidates = [
    process.env.SHELL,
    "/opt/homebrew/bin/zsh",
    "/usr/local/bin/zsh",
    "/bin/zsh",
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/sh",
    "/usr/bin/sh",
  ];
  for (const s of candidates) {
    if (s && existsSync(s)) {
      cachedShell = s;
      return s;
    }
  }
  cachedShell = "zsh";
  return cachedShell;
}

const spawnEnv = { ...process.env, FORCE_COLOR: "1" };

const SUDO_AUTH_FAIL_MARKERS = [
  "incorrect password",
  "Sorry, try again",
  "no password was provided",
];

function isSudoAuthFailure(text: string): boolean {
  return SUDO_AUTH_FAIL_MARKERS.some((m) => text.includes(m));
}

/** Ring buffer for log lines — O(1) push, no array shifting */
class LogBuffer {
  private buf: string[];
  private head = 0;
  private len = 0;
  private cap: number;

  constructor(capacity = MAX_LOG_LINES) {
    this.cap = capacity;
    this.buf = new Array(capacity);
  }

  push(line: string): void {
    this.buf[(this.head + this.len) % this.cap] = line;
    if (this.len < this.cap) {
      this.len++;
    } else {
      this.head = (this.head + 1) % this.cap;
    }
  }

  get length(): number {
    return this.len;
  }

  toArray(): string[] {
    const result = new Array(this.len);
    for (let i = 0; i < this.len; i++) {
      result[i] = this.buf[(this.head + i) % this.cap];
    }
    return result;
  }

  static from(lines: string[]): LogBuffer {
    const buf = new LogBuffer();
    for (const line of lines) buf.push(line);
    return buf;
  }
}

interface ManagedProcess {
  proc: ReturnType<typeof Bun.spawn> | null; // null for re-attached processes
  config: ServerConfig;
  logs: LogBuffer;
  startedAt: number;
  status: ServerStatus;
  pid: number; // tracked separately for re-attached processes
  pollInterval?: ReturnType<typeof setInterval>;
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();

  async start(key: string, config: ServerConfig, sudoPassword?: string): Promise<{ ok: boolean; error?: string }> {
    const existing = this.processes.get(key);
    if (existing && existing.status === "running") {
      await this.stop(key, sudoPassword, config);
    } else if (existing) {
      this.markStopped(existing);
      this.processes.delete(key);
    }

    let shellCmd: string;
    let needsStdin = false;

    if (config.sudo) {
      const userFlags = typeof config.sudo === "string" ? config.sudo : "";
      let sudoFlags = userFlags;
      if (!sudoFlags.includes("-S")) sudoFlags = `${sudoFlags} -S`.trim();
      if (!sudoFlags.includes("-k")) sudoFlags = `-k ${sudoFlags}`;
      needsStdin = true;
      shellCmd = `sudo ${sudoFlags} ${config.cmd}`;
    } else {
      shellCmd = config.cmd;
    }

    const cwd = config.dir
      ? config.dir.replace(/^~/, process.env.HOME ?? "~")
      : process.cwd();

    if (!existsSync(cwd)) {
      const managed: ManagedProcess = {
        proc: null,
        config,
        logs: LogBuffer.from([`[switchboard] Directory not found: ${cwd}`]),
        startedAt: Date.now(),
        status: "crashed",
        pid: 0,
      };
      this.processes.set(key, managed);
      return { ok: false, error: `Directory not found: ${cwd}` };
    }

    const shell = findShell();
    let proc: ReturnType<typeof Bun.spawn>;

    try {
      proc = Bun.spawn([shell, "-c", shellCmd], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: needsStdin ? "pipe" : undefined,
        env: spawnEnv,
        detached: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const managed: ManagedProcess = {
        proc: null,
        config,
        logs: LogBuffer.from([`[switchboard] Failed to start: ${msg}`]),
        startedAt: Date.now(),
        status: "crashed",
        pid: 0,
      };
      this.processes.set(key, managed);
      return { ok: false, error: msg };
    }

    if (needsStdin && sudoPassword && proc.stdin && typeof proc.stdin !== "number") {
      proc.stdin.write(sudoPassword + "\n");
      proc.stdin.flush();
      proc.stdin.end();
    }

    const managed: ManagedProcess = {
      proc,
      config,
      logs: new LogBuffer(),
      startedAt: Date.now(),
      status: "running",
      pid: proc.pid,
    };

    this.processes.set(key, managed);

    // For sudo commands: capture streams, then wait briefly for auth failure
    if (config.sudo && sudoPassword) {
      this.captureStream(managed, proc.stdout);
      this.captureStream(managed, proc.stderr);

      // Wait up to 5s for the process to exit (auth failure or daemon done)
      const exited = await Promise.race([
        proc.exited.then((code) => ({ done: true as const, code })),
        new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 5000)),
      ]);

      if (exited.done && exited.code !== 0) {
        // Wait for streams to drain so logs are populated
        await new Promise((r) => setTimeout(r, 200));
        const logs = managed.logs.toArray().join("\n");
        const msg = isSudoAuthFailure(logs) ? "Incorrect password" : `Exit code ${exited.code}`;
        managed.status = "crashed";
        return { ok: false, error: msg };
      }

      if (exited.done && exited.code === 0 && config.pidFile) {
        await new Promise((r) => setTimeout(r, 500));
        const daemonPid = this.readPidFile(config.pidFile);
        if (daemonPid && this.isProcessAlive(daemonPid)) {
          managed.pid = daemonPid;
          managed.proc = null;
          managed.status = "running";
          managed.logs.push(`[switchboard] Daemon running with PID ${daemonPid}`);
          this.pollAlive(key, daemonPid, managed);
        } else {
          managed.status = "stopped";
        }
      } else if (exited.done && exited.code === 0) {
        managed.status = "stopped";
      } else if (!exited.done) {
        // Still running — wire an exit handler so status updates when it ends.
        proc.exited.then((code) => {
          const current = this.processes.get(key);
          if (current && current.proc === proc) {
            current.status = code === 0 ? "stopped" : "crashed";
          }
        });
      }

      return { ok: true };
    }

    // Non-sudo: capture streams and handle exit asynchronously
    this.captureStream(managed, proc.stdout);
    this.captureStream(managed, proc.stderr);

    proc.exited.then((code) => {
      const current = this.processes.get(key);
      if (!current || current.proc !== proc) return;

      if (code === 0 && config.pidFile) {
        setTimeout(() => {
          const daemonPid = this.readPidFile(config.pidFile!);
          if (daemonPid && this.isProcessAlive(daemonPid)) {
            current.pid = daemonPid;
            current.proc = null;
            current.status = "running";
            current.logs.push(`[switchboard] Daemon running with PID ${daemonPid}`);
            this.pollAlive(key, daemonPid, current);
          } else {
            current.status = "stopped";
            current.logs.push("[switchboard] Launcher exited but no daemon PID found");
          }
        }, 500);
      } else {
        current.status = code === 0 ? "stopped" : "crashed";
      }
    });

    return { ok: true };
  }

  private async captureStream(
    managed: ManagedProcess,
    stream: ReadableStream<Uint8Array> | number | null | undefined
  ): Promise<void> {
    if (!stream || typeof stream === "number") return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.length > 0);
        for (const line of lines) {
          managed.logs.push(line);
        }
      }
    } catch {
      // Stream closed
    }
  }

  async stop(key: string, sudoPassword?: string, serverConfig?: ServerConfig): Promise<{ ok: boolean; error?: string }> {
    const managed = this.processes.get(key);
    const config = managed?.config ?? serverConfig;
    if (!config) return { ok: false, error: "Server not found" };

    if (config.stopCmd) {
      let stopShellCmd = config.stopCmd;
      if (config.sudo) {
        const userFlags = typeof config.sudo === "string" ? config.sudo : "";
        let sudoFlags = userFlags;
        if (!sudoFlags.includes("-S")) sudoFlags = `${sudoFlags} -S`.trim();
        if (!sudoFlags.includes("-k")) sudoFlags = `-k ${sudoFlags}`;
        stopShellCmd = `sudo ${sudoFlags} ${stopShellCmd}`;
      }
      const shell = findShell();
      const proc = Bun.spawn([shell, "-c", stopShellCmd], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: config.sudo ? "pipe" : undefined,
        env: spawnEnv,
      });
      if (sudoPassword && proc.stdin && typeof proc.stdin !== "number") {
        proc.stdin.write(sudoPassword + "\n");
        proc.stdin.flush();
      }
      // Read stderr concurrently with waiting for exit
      const stderrPromise = new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      const stderr = await stderrPromise;
      const authFail = isSudoAuthFailure(stderr);
      if (exitCode !== 0 || authFail) {
        const msg = authFail
          ? "Incorrect password"
          : stderr.trim() || `Exit code ${exitCode}`;
        managed?.logs.push(`[switchboard] Stop failed: ${msg}`);
        return { ok: false, error: msg };
      }
    } else if (!managed || managed.status !== "running") {
      return { ok: false, error: "Not running" };
    } else if (managed.proc) {
      await this.killTree(managed.proc.pid);
      await managed.proc.exited;
    } else {
      await this.killTree(managed.pid);
    }

    if (managed) this.markStopped(managed);
    return { ok: true };
  }

  async restart(key: string): Promise<void> {
    const managed = this.processes.get(key);
    if (!managed) return;
    const config = managed.config;
    await this.stop(key);
    await this.start(key, config);
  }

  stopAll(): void {
    for (const [, managed] of this.processes) {
      if (managed.status === "running") {
        this.signalTree(managed.pid, "SIGTERM");
        this.markStopped(managed);
      }
    }
  }

  attach(key: string, config: ServerConfig, pid: number, startedAt: number): void {
    if (!this.isProcessAlive(pid)) return;

    const managed: ManagedProcess = {
      proc: null,
      config,
      logs: LogBuffer.from(["(logs not available — process started in a previous session)"]),
      startedAt,
      status: "running",
      pid,
    };

    this.processes.set(key, managed);
    this.pollAlive(key, pid, managed);
  }

  private async killTree(pid: number): Promise<void> {
    // kill(-pid) reaches the whole pgroup; pkill -P only walks depth 1 and orphans grandchildren.
    this.signalTree(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (this.isProcessAlive(pid)) this.signalTree(pid, "SIGKILL");
  }

  private signalTree(pid: number, sig: NodeJS.Signals): void {
    try { process.kill(-pid, sig); } catch { /* group gone or not a pgid leader */ }
    try { process.kill(pid, sig); } catch { /* dead */ }
  }

  private readPidFile(path: string): number | null {
    try {
      const expanded = path.replace(/^~/, process.env.HOME ?? "~");
      const content = readFileSync(expanded, "utf-8").trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private pollAlive(_key: string, pid: number, managed: ManagedProcess): void {
    managed.pollInterval = setInterval(() => {
      if (!this.isProcessAlive(pid)) this.markStopped(managed);
    }, 2000);
  }

  private markStopped(managed: ManagedProcess): void {
    managed.status = "stopped";
    managed.startedAt = 0;
    if (managed.pollInterval) {
      clearInterval(managed.pollInterval);
      managed.pollInterval = undefined;
    }
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // signal 0 = just check existence
      return true;
    } catch {
      return false;
    }
  }

  /** Get map of key -> {pid, startedAt} for all running processes */
  getRunningEntries(): Record<string, { pid: number; startedAt: number }> {
    const entries: Record<string, { pid: number; startedAt: number }> = {};
    for (const [key, managed] of this.processes) {
      if (managed.status === "running") {
        entries[key] = { pid: managed.pid, startedAt: managed.startedAt };
      }
    }
    return entries;
  }

  getState(key: string): ServerState {
    const managed = this.processes.get(key);
    if (!managed) {
      return {
        config: { name: "", cmd: "" },
        groupName: "",
        status: "stopped",
        pid: null,
        cpu: 0,
        memMb: 0,
        startedAt: null,
      };
    }
    return {
      config: managed.config,
      groupName: "",
      status: managed.status,
      pid: managed.status === "running" ? managed.pid : null,
      cpu: 0,
      memMb: 0,
      startedAt: managed.status === "running" ? managed.startedAt : null,
    };
  }

  getLogs(key: string): string[] {
    return this.processes.get(key)?.logs.toArray() ?? [];
  }

  getLogCount(key: string): number {
    return this.processes.get(key)?.logs.length ?? 0;
  }

  getPid(key: string): number | null {
    const managed = this.processes.get(key);
    if (!managed || managed.status !== "running") return null;
    return managed.pid;
  }
}
