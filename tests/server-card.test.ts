import { describe, it, expect } from "bun:test";
import { renderCard, CARD_WIDTH } from "../src/components/server-card";
import { stripAnsi } from "../src/ansi";
import type { ServerState } from "../src/types";

function makeState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    config: { name: "API", cmd: "bun dev" },
    groupName: "MyApp",
    status: "stopped",
    pid: null,
    cpu: 0,
    memMb: 0,
    startedAt: null,
    ...overrides,
  };
}

describe("renderCard", () => {
  it("renders a stopped server card", () => {
    const lines = renderCard(makeState(), false);
    const visible = lines.map(stripAnsi);
    expect(visible[0]).toContain("╭");
    expect(visible[0]).toContain("╮");
    expect(visible[1]).toContain("API");
    expect(visible[1]).toContain("stopped");
    expect(visible[visible.length - 1]).toContain("╰");
  });

  it("renders a running server with stats", () => {
    const lines = renderCard(makeState({
      status: "running",
      pid: 1234,
      cpu: 2.5,
      memMb: 48,
      startedAt: Date.now() - 60_000,
      config: { name: "API", cmd: "bun dev", port: 3001 },
    }), false);
    const visible = lines.map(stripAnsi);
    const joined = visible.join("\n");
    expect(joined).toContain(":3001");
    expect(joined).toContain("cpu 2.5%");
    expect(joined).toContain("48MB");
  });

  it("uses double border when focused", () => {
    const lines = renderCard(makeState(), true);
    const visible = lines.map(stripAnsi);
    expect(visible[0]).toContain("╔");
    expect(visible[0]).toContain("╗");
  });

  it("uses round border when not focused", () => {
    const lines = renderCard(makeState(), false);
    const visible = lines.map(stripAnsi);
    expect(visible[0]).toContain("╭");
  });

  it("all lines have consistent visible width", () => {
    const lines = renderCard(makeState({ status: "running", pid: 1, cpu: 0, memMb: 10, startedAt: Date.now() }), false);
    for (const line of lines) {
      expect(stripAnsi(line).length).toBe(CARD_WIDTH);
    }
  });

  it("wraps long commands", () => {
    const lines = renderCard(makeState({
      config: { name: "API", cmd: "bun run --filter @myapp/api dev" },
    }), false);
    const visible = lines.map(stripAnsi);
    const cmdLines = visible.filter(l => l.includes("bun") || l.includes("dev"));
    expect(cmdLines.length).toBeGreaterThanOrEqual(2);
  });

  it("shows crashed status", () => {
    const lines = renderCard(makeState({ status: "crashed" }), false);
    const joined = lines.map(stripAnsi).join("\n");
    expect(joined).toContain("crashed");
  });
});
