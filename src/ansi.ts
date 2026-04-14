export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";

export const FG_WHITE = "\x1b[97m";
export const FG_CYAN = "\x1b[96m";
export const FG_GREEN = "\x1b[92m";
export const FG_RED = "\x1b[91m";
export const FG_YELLOW = "\x1b[93m";
export const FG_BLUE = "\x1b[94m";
export const FG_MAGENTA = "\x1b[95m";
export const FG_GRAY = "\x1b[90m";
export const FG_BURGUNDY = "\x1b[38;2;204;51;82m";

export const BG_BAR_FILLED = "\x1b[42m";
export const BG_BAR_EMPTY = "\x1b[48;5;238m";

export function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visLen(s: string): number {
  return stripAnsi(s).length;
}

export function statusColor(status: "running" | "stopped" | "crashed"): string {
  switch (status) {
    case "running": return FG_GREEN;
    case "crashed": return FG_RED;
    case "stopped": return FG_GRAY;
  }
}

export function formatUptime(startedAt: number | null): string {
  if (!startedAt) return "—";
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export const BOX_ROUND = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
export const BOX_DOUBLE = { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" };
export const BOX_SINGLE = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };

export interface BoxChars { tl: string; tr: string; bl: string; br: string; h: string; v: string }

export function boxTop(width: number, box: BoxChars, color: string): string {
  return `${color}${box.tl}${box.h.repeat(width - 2)}${box.tr}${RESET}`;
}

export function boxBottom(width: number, box: BoxChars, color: string): string {
  return `${color}${box.bl}${box.h.repeat(width - 2)}${box.br}${RESET}`;
}

export function boxRow(content: string, width: number, box: BoxChars, color: string): string {
  const inner = width - 2;
  const contentLen = visLen(content);
  const padding = Math.max(0, inner - contentLen);
  return `${color}${box.v}${RESET}${content}${" ".repeat(padding)}${color}${box.v}${RESET}`;
}
