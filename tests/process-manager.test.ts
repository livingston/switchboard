import { describe, it, expect, afterEach } from "bun:test";
import { ProcessManager } from "../src/process-manager";

let pm: ProcessManager;

afterEach(() => {
  pm?.stopAll();
});

describe("ProcessManager", () => {
  it("starts a process and reports it as running", async () => {
    pm = new ProcessManager();
    await pm.start("test-server", { cmd: "sleep 60", name: "Test" });
    const state = pm.getState("test-server");
    expect(state.status).toBe("running");
    expect(state.pid).toBeGreaterThan(0);
    expect(state.startedAt).toBeGreaterThan(0);
  });

  it("stops a running process", async () => {
    pm = new ProcessManager();
    await pm.start("test-server", { cmd: "sleep 60", name: "Test" });
    await pm.stop("test-server");
    const state = pm.getState("test-server");
    expect(state.status).toBe("stopped");
    expect(state.pid).toBeNull();
  });

  it("captures stdout in log buffer", async () => {
    pm = new ProcessManager();
    await pm.start("echo-server", { cmd: "echo hello-world", name: "Echo" });
    await new Promise((r) => setTimeout(r, 200));
    const logs = pm.getLogs("echo-server");
    expect(logs.some((line) => line.includes("hello-world"))).toBe(true);
  });

  it("detects a crashed process", async () => {
    pm = new ProcessManager();
    await pm.start("bad-server", { cmd: "bash -c 'exit 1'", name: "Bad" });
    await new Promise((r) => setTimeout(r, 200));
    const state = pm.getState("bad-server");
    expect(state.status).toBe("crashed");
  });

  it("returns stopped state for unknown key", () => {
    pm = new ProcessManager();
    const state = pm.getState("nonexistent");
    expect(state.status).toBe("stopped");
    expect(pm.getLogs("nonexistent")).toEqual([]);
    expect(pm.getPid("nonexistent")).toBeNull();
  });
});

describe("ProcessManager (no spawn)", () => {
  it("isProcessAlive detects live and dead processes", () => {
    pm = new ProcessManager();
    expect(pm.isProcessAlive(process.pid)).toBe(true);
    expect(pm.isProcessAlive(999999)).toBe(false);
  });

  it("attach tracks an external process", () => {
    // Use a dedicated PM so stopAll doesn't kill the test runner
    const localPm = new ProcessManager();
    localPm.attach("ext", { cmd: "test", name: "Ext" }, process.pid, Date.now());
    expect(localPm.getState("ext").status).toBe("running");
    expect(localPm.getState("ext").pid).toBe(process.pid);
    // Don't call stopAll — it would SIGTERM the test runner
  });

  it("attach ignores dead processes", () => {
    pm = new ProcessManager();
    pm.attach("dead", { cmd: "test", name: "Dead" }, 999999, Date.now());
    expect(pm.getState("dead").status).toBe("stopped");
  });

  it("stop returns error for unknown server", async () => {
    pm = new ProcessManager();
    const result = await pm.stop("nonexistent");
    expect(result.ok).toBe(false);
  });
});
