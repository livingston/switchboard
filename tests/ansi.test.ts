import { describe, it, expect } from "bun:test";
import {
  pad, stripAnsi, visLen, statusColor, formatUptime,
  boxTop, boxBottom, boxRow, BOX_SINGLE, BOX_ROUND,
  FG_GREEN, FG_RED, FG_GRAY, BOLD, RESET,
} from "../src/ansi";

describe("pad", () => {
  it("pads short strings with spaces", () => {
    expect(pad("hi", 5)).toBe("hi   ");
  });

  it("truncates long strings", () => {
    expect(pad("hello world", 5)).toBe("hello");
  });

  it("returns exact-length strings unchanged", () => {
    expect(pad("hello", 5)).toBe("hello");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI color codes", () => {
    expect(stripAnsi(`${FG_GREEN}hello${RESET}`)).toBe("hello");
  });

  it("removes multiple codes", () => {
    expect(stripAnsi(`${BOLD}${FG_RED}test${RESET}`)).toBe("test");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("visLen", () => {
  it("returns visible length ignoring ANSI", () => {
    expect(visLen(`${FG_GREEN}hello${RESET}`)).toBe(5);
  });

  it("returns length of plain text", () => {
    expect(visLen("hello")).toBe(5);
  });
});

describe("statusColor", () => {
  it("returns green for running", () => {
    expect(statusColor("running")).toBe(FG_GREEN);
  });

  it("returns red for crashed", () => {
    expect(statusColor("crashed")).toBe(FG_RED);
  });

  it("returns gray for stopped", () => {
    expect(statusColor("stopped")).toBe(FG_GRAY);
  });
});

describe("formatUptime", () => {
  it("returns dash for null", () => {
    expect(formatUptime(null)).toBe("—");
  });

  it("formats seconds", () => {
    expect(formatUptime(Date.now() - 30_000)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatUptime(Date.now() - 5 * 60_000)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    const twoHoursTenMin = Date.now() - (2 * 60 * 60_000 + 10 * 60_000);
    expect(formatUptime(twoHoursTenMin)).toBe("2h 10m");
  });
});

describe("box drawing", () => {
  it("boxTop draws correct width", () => {
    const top = boxTop(10, BOX_SINGLE, "");
    expect(stripAnsi(top)).toBe("┌────────┐");
  });

  it("boxBottom draws correct width", () => {
    const bottom = boxBottom(10, BOX_ROUND, "");
    expect(stripAnsi(bottom)).toBe("╰────────╯");
  });

  it("boxRow pads content to width", () => {
    const row = boxRow("hi", 10, BOX_SINGLE, "");
    const visible = stripAnsi(row);
    expect(visible).toBe("│hi      │");
    expect(visible.length).toBe(10);
  });

  it("boxRow handles ANSI content", () => {
    const row = boxRow(`${FG_GREEN}ok${RESET}`, 10, BOX_SINGLE, "");
    const visible = stripAnsi(row);
    expect(visible).toBe("│ok      │");
  });
});
