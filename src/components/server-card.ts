import type { ServerState } from "../types.js";
import {
  RESET, BOLD, DIM, FG_CYAN, FG_GRAY,
  statusColor, formatUptime,
  BOX_ROUND, BOX_DOUBLE, boxTop, boxBottom,
  BG_BAR_FILLED, BG_BAR_EMPTY,
  type BoxChars,
} from "../ansi.js";

export const CARD_WIDTH = 34;

function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text.slice(0, maxWidth)];
}
const PAD = 1; // 1 char padding on each side inside the border

function memBar(memMb: number): string {
  const blocks = Math.min(Math.ceil(memMb / 50), 10);
  return `${BG_BAR_FILLED}${"█".repeat(blocks)}${RESET}${BG_BAR_EMPTY}${"░".repeat(10 - blocks)}${RESET}`;
}

/** Render a padded row inside a bordered card */
function cardRow(content: string, contentVisLen: number, width: number, box: BoxChars, color: string): string {
  const inner = width - 2 - PAD * 2; // usable space after border + padding
  const pad = " ".repeat(PAD);
  const rightPad = Math.max(0, inner - contentVisLen);
  return `${color}${box.v}${RESET}${pad}${content}${" ".repeat(rightPad)}${pad}${color}${box.v}${RESET}`;
}

export function renderCard(state: ServerState, focused: boolean): string[] {
  const w = CARD_WIDTH;
  const color = focused ? FG_CYAN : statusColor(state.status);
  const box = focused ? BOX_DOUBLE : BOX_ROUND;
  const dimmed = state.status === "stopped" && !focused;
  const nameStyle = focused ? `${BOLD}${FG_CYAN}` : dimmed ? DIM : BOLD;
  const inner = w - 2 - PAD * 2; // usable content width

  const lines: string[] = [];
  lines.push(boxTop(w, box, color));

  // Name + status row
  const statusLabel = `● ${state.status}`;
  const statusVisLen = statusLabel.length;
  const nameSpace = inner - statusVisLen;
  const name = state.config.name.slice(0, nameSpace);
  const nameGap = Math.max(0, nameSpace - name.length);
  const nameRowContent = `${nameStyle}${name}${RESET}${" ".repeat(nameGap)}${statusColor(state.status)}${statusLabel}${RESET}`;
  lines.push(cardRow(nameRowContent, inner, w, box, color));

  // Command — word-wrap to multiple lines
  const cmdStyle = dimmed ? DIM : FG_GRAY;
  for (const chunk of wordWrap(state.config.cmd, inner)) {
    lines.push(cardRow(`${cmdStyle}${chunk}${RESET}`, chunk.length, w, box, color));
  }

  if (state.status === "running") {
    // Port + uptime row
    const parts: string[] = [];
    if (state.config.port) parts.push(`:${state.config.port}`);
    parts.push(formatUptime(state.startedAt));
    const infoStr = parts.join("  ");
    lines.push(cardRow(`${BOLD}${infoStr}${RESET}`, infoStr.length, w, box, color));

    // Memory bar + CPU row
    const memLabel = `${state.memMb}MB `;
    const cpuLabel = `cpu ${state.cpu}%`;
    const barWidth = 10;
    const memText = `${DIM}${memLabel}${RESET}${memBar(state.memMb)}`;
    const cpuText = `${DIM}${cpuLabel}${RESET}`;
    const usedVis = memLabel.length + barWidth + cpuLabel.length;
    const gap = Math.max(1, inner - usedVis);
    lines.push(cardRow(`${memText}${" ".repeat(gap)}${cpuText}`, usedVis + gap, w, box, color));
  } else {
    const parts: string[] = [];
    if (state.config.port) parts.push(`:${state.config.port}`);
    const infoStr = parts.join("  ");
    lines.push(cardRow(infoStr, infoStr.length, w, box, color));
  }

  lines.push(boxBottom(w, box, color));
  return lines;
}
