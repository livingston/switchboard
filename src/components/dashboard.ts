import type { Component } from "@mariozechner/pi-tui";
import type { Config, ServerState } from "../types.js";
import { renderCard, CARD_WIDTH } from "./server-card.js";
import { RESET, BOLD, DIM, FG_BLUE, FG_BURGUNDY, FG_GRAY, FG_MAGENTA, FG_RED, stripAnsi } from "../ansi.js";

export class DashboardComponent implements Component {
  config: Config = { groups: [] };
  states: Map<string, ServerState> = new Map();
  focusIndex = 0;
  confirmDelete: string | null = null;
  allocatedHeight = 0;

  private getServerKeys(): string[] {
    const keys: string[] = [];
    for (const group of this.config.groups) {
      for (const server of group.servers) {
        keys.push(`${group.name}/${server.name}`);
      }
    }
    return keys;
  }

  get currentKey(): string | null {
    const keys = this.getServerKeys();
    return keys[this.focusIndex] ?? null;
  }

  get currentGroup(): string | null {
    return this.currentKey?.split("/")[0] ?? null;
  }

  moveUp(): void {
    this.focusIndex = Math.max(0, this.focusIndex - 1);
  }

  moveDown(): void {
    const keys = this.getServerKeys();
    this.focusIndex = Math.min(keys.length - 1, this.focusIndex + 1);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const M = " "; // left margin
    const lines: string[] = [];

    if (this.confirmDelete) {
      lines.push(`${M}${FG_RED}Delete ${this.confirmDelete}? (y/n)${RESET}`);
      lines.push("");
    }

    if (this.config.groups.length === 0) {
      lines.push(`${M}${DIM}No servers configured. Press ${RESET}${BOLD}a${RESET}${DIM} to add one.${RESET}`);
      return this.padToHeight(lines, width);
    }

    const usableWidth = width - 1; // account for margin
    const cardsPerRow = Math.max(1, Math.floor(usableWidth / (CARD_WIDTH + 1)));

    for (const group of this.config.groups) {
      const isFocusedGroup = this.currentGroup === group.name;
      const groupColor = isFocusedGroup ? FG_BLUE : FG_MAGENTA;
      lines.push(`${M}${BOLD}${groupColor}${group.name.toUpperCase()}${RESET}`);

      const cards: string[][] = [];
      for (const server of group.servers) {
        const key = `${group.name}/${server.name}`;
        const state = this.states.get(key) ?? {
          config: server, groupName: group.name,
          status: "stopped" as const, pid: null, cpu: 0, memMb: 0, startedAt: null,
        };
        cards.push(renderCard(state, this.currentKey === key));
      }

      for (let i = 0; i < cards.length; i += cardsPerRow) {
        const rowCards = cards.slice(i, i + cardsPerRow);
        const maxHeight = Math.max(...rowCards.map((c) => c.length));
        for (let row = 0; row < maxHeight; row++) {
          const rowLine = rowCards
            .map((card) => card[row] ?? " ".repeat(CARD_WIDTH))
            .join(" ");
          lines.push(`${M}${rowLine}`);
        }
      }
      lines.push("");
    }

    return this.padToHeight(lines, width);
  }

  private padToHeight(lines: string[], width: number): string[] {
    while (lines.length < this.allocatedHeight) lines.push("");
    const result = lines.slice(0, this.allocatedHeight);
    this.overlayLogo(result, width);
    return result;
  }

  private overlayLogo(lines: string[], width: number): void {
    const logoStyled = [
      `${FG_GRAY}    │ │ │ │ │${RESET}`,
      `${FG_GRAY}────${FG_BURGUNDY}●─●─○─●─○${FG_GRAY}──── ${BOLD}${FG_BURGUNDY}SWITCH${RESET}`,
      `${FG_GRAY}────${FG_BURGUNDY}○─●─●─○─●${FG_GRAY}──── ${BOLD}${FG_BURGUNDY}BOARD${RESET}`,
      `${FG_GRAY}    │ │ │ │ │${RESET}`,
    ];
    const logoVisWidths = [13, 26, 25, 13];
    const maxLogoWidth = 26;
    const rightMargin = 2;
    const startCol = width - maxLogoWidth - rightMargin;
    if (startCol < 40) return;

    for (let i = 0; i < logoStyled.length && i < lines.length; i++) {
      const leftVis = stripAnsi(lines[i]);
      if (leftVis.length > startCol) continue;

      // Build: left content + gap + logo + right pad = exactly width visible chars
      const gap = startCol - leftVis.length;
      const rightPad = width - startCol - logoVisWidths[i];
      lines[i] = lines[i] + " ".repeat(gap) + logoStyled[i] + " ".repeat(Math.max(0, rightPad));
    }
  }
}
