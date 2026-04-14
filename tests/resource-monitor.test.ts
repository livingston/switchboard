import { describe, it, expect } from "bun:test";
import { parsePsOutput, getBatchResourceStats, isPortListening } from "../src/resource-monitor";

describe("parsePsOutput", () => {
  it("parses valid ps output", () => {
    const output = "  2.3  0.4  51200\n";
    const result = parsePsOutput(output);
    expect(result).toEqual({ cpu: 2.3, memMb: 50 });
  });

  it("returns zeros for empty output", () => {
    const result = parsePsOutput("");
    expect(result).toEqual({ cpu: 0, memMb: 0 });
  });

  it("returns zeros for header-only output", () => {
    const result = parsePsOutput("%CPU %MEM   RSS\n");
    expect(result).toEqual({ cpu: 0, memMb: 0 });
  });

  it("rounds cpu to one decimal", () => {
    const result = parsePsOutput("  3.14  0.5  10240\n");
    expect(result.cpu).toBe(3.1);
  });

  it("rounds memory to nearest MB", () => {
    const result = parsePsOutput("  0.0  0.0  1536\n");
    expect(result.memMb).toBe(2); // 1536 KB ≈ 1.5 MB → rounds to 2
  });
});

describe("getBatchResourceStats", () => {
  it("returns empty map for empty pid list", async () => {
    const result = await getBatchResourceStats([]);
    expect(result.size).toBe(0);
  });

  it("returns stats for current process", async () => {
    const result = await getBatchResourceStats([process.pid]);
    expect(result.has(process.pid)).toBe(true);
    const stats = result.get(process.pid)!;
    expect(typeof stats.cpu).toBe("number");
    expect(typeof stats.memMb).toBe("number");
  });

  it("handles invalid pids gracefully", async () => {
    const result = await getBatchResourceStats([999999]);
    // ps may fail or return nothing for invalid pid
    expect(result.size).toBeLessThanOrEqual(1);
  });

  it("handles multiple pids", async () => {
    const result = await getBatchResourceStats([process.pid, 1]);
    expect(result.has(process.pid)).toBe(true);
  });
});

describe("isPortListening", () => {
  it("returns false for a port nothing listens on", async () => {
    const result = await isPortListening(59999);
    expect(result).toBe(false);
  });
});
