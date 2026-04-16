import type { Component } from "@mariozechner/pi-tui";
import { RESET, BOLD, DIM, FG_YELLOW, FG_RED, BOX_DOUBLE, boxTop, boxBottom, boxRow } from "../ansi.js";

export class SudoPromptComponent implements Component {
  serverName = "";
  action: "start" | "stop" | "restart" = "start";
  password = "";
  error = "";
  busy = false;
  termWidth = 80;
  termHeight = 24;

  reset(serverName: string, action: "start" | "stop" | "restart"): void {
    this.serverName = serverName;
    this.action = action;
    this.password = "";
    this.error = "";
    this.busy = false;
  }

  typeChar(ch: string): void { this.password += ch; }
  backspace(): void { this.password = this.password.slice(0, -1); }
  invalidate(): void {}

  render(width: number): string[] {
    const dialogWidth = Math.min(50, width - 4);
    const dialogHeight = this.error ? 8 : 7;
    const topPad = Math.max(0, Math.floor((this.termHeight - dialogHeight) / 2));
    const leftPad = Math.max(0, Math.floor((width - dialogWidth) / 2));
    const indent = " ".repeat(leftPad);
    const blank = " ".repeat(width);

    const dialogLines: string[] = [];
    dialogLines.push(indent + boxTop(dialogWidth, BOX_DOUBLE, FG_YELLOW));
    dialogLines.push(indent + boxRow(
      `${BOLD}${FG_YELLOW} 🔒 sudo — ${this.action} ${this.serverName}${RESET}`,
      dialogWidth, BOX_DOUBLE, FG_YELLOW
    ));
    if (this.error) {
      dialogLines.push(indent + boxRow(
        ` ${FG_RED}${this.error}${RESET}`,
        dialogWidth, BOX_DOUBLE, FG_YELLOW
      ));
    }
    dialogLines.push(indent + boxRow("", dialogWidth, BOX_DOUBLE, FG_YELLOW));
    if (this.busy) {
      dialogLines.push(indent + boxRow(
        ` ${DIM}authenticating…${RESET}`,
        dialogWidth, BOX_DOUBLE, FG_YELLOW
      ));
    } else {
      dialogLines.push(indent + boxRow(
        ` Password: ${this.password.length > 0 ? "•".repeat(this.password.length) : ""}${FG_YELLOW}_${RESET}`,
        dialogWidth, BOX_DOUBLE, FG_YELLOW
      ));
    }
    dialogLines.push(indent + boxRow("", dialogWidth, BOX_DOUBLE, FG_YELLOW));
    dialogLines.push(indent + boxRow(
      this.busy ? `${DIM} please wait…${RESET}` : `${DIM} enter submit  ·  esc cancel${RESET}`,
      dialogWidth, BOX_DOUBLE, FG_YELLOW
    ));
    dialogLines.push(indent + boxBottom(dialogWidth, BOX_DOUBLE, FG_YELLOW));

    const lines: string[] = [];
    for (let i = 0; i < this.termHeight; i++) {
      if (i >= topPad && i < topPad + dialogLines.length) {
        lines.push(dialogLines[i - topPad]);
      } else {
        lines.push(blank);
      }
    }
    return lines;
  }
}
