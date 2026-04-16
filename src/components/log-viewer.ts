import type { Component } from "@mariozechner/pi-tui";
import { RESET, BOLD, DIM, FG_BLUE, FG_GREEN, FG_YELLOW, FG_GRAY, BOX_SINGLE, boxTop, boxBottom, boxRow, visTruncate } from "../ansi.js";

export class LogViewerComponent implements Component {
  serverKey = "";
  private getLogs: () => string[] = () => [];
  private getCount: () => number = () => 0;
  private logs: string[] = [];
  private logCount = 0;
  scrollOffset = 0;
  follow = true;
  search = "";
  searchMode = false;
  allocatedHeight = 0;

  setLogSource(key: string, getLogs: () => string[], getCount: () => number): void {
    this.serverKey = key;
    this.getLogs = getLogs;
    this.getCount = getCount;
    this.logs = getLogs();
    this.logCount = this.logs.length;
    this.scrollOffset = 0;
    this.follow = true;
    this.search = "";
    this.searchMode = false;
  }

  pollLogs(): boolean {
    const freshCount = this.getCount();
    if (freshCount === this.logCount) return false;
    this.logCount = freshCount;
    this.logs = this.getLogs();
    return true;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const headerRight: string[] = [];
    if (this.follow) headerRight.push(`${FG_GREEN}FOLLOW${RESET}`);
    if (this.search) headerRight.push(`search: ${FG_YELLOW}${this.search}${RESET}`);
    const rightStr = headerRight.join("  ");
    lines.push(`${BOLD}${FG_BLUE}LOGS — ${this.serverKey}${RESET}` + (rightStr ? "  " + rightStr : ""));
    lines.push("");

    const borderLines = 2;
    const logAreaHeight = Math.max(1, this.allocatedHeight - lines.length - borderLines - (this.searchMode ? 2 : 0));
    const filtered = this.search
      ? this.logs.filter((l) => l.toLowerCase().includes(this.search.toLowerCase()))
      : this.logs;

    if (this.follow) {
      this.scrollOffset = Math.max(0, filtered.length - logAreaHeight);
    }
    const visible = filtered.slice(this.scrollOffset, this.scrollOffset + logAreaHeight);

    lines.push(boxTop(width, BOX_SINGLE, FG_GRAY));
    if (visible.length === 0) {
      lines.push(boxRow(`${DIM} No logs yet...${RESET}`, width, BOX_SINGLE, FG_GRAY));
      for (let i = 1; i < logAreaHeight; i++) {
        lines.push(boxRow("", width, BOX_SINGLE, FG_GRAY));
      }
    } else {
      for (const line of visible) {
        lines.push(boxRow(visTruncate(line, width - 2), width, BOX_SINGLE, FG_GRAY));
      }
      for (let i = visible.length; i < logAreaHeight; i++) {
        lines.push(boxRow("", width, BOX_SINGLE, FG_GRAY));
      }
    }
    lines.push(boxBottom(width, BOX_SINGLE, FG_GRAY));

    if (this.searchMode) {
      lines.push("");
      lines.push(`/ ${FG_YELLOW}${this.search}${RESET}${DIM}_${RESET}`);
    }
    return lines;
  }

  scrollUp(): void {
    this.follow = false;
    this.scrollOffset = Math.max(0, this.scrollOffset - 1);
  }

  scrollDown(): void {
    this.follow = false;
    const filtered = this.search
      ? this.logs.filter((l) => l.toLowerCase().includes(this.search.toLowerCase()))
      : this.logs;
    const logAreaHeight = Math.max(1, this.allocatedHeight - 4);
    this.scrollOffset = Math.min(Math.max(0, filtered.length - logAreaHeight), this.scrollOffset + 1);
  }
}
