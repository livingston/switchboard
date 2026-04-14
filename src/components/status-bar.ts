import type { Component } from "@mariozechner/pi-tui";
import { RESET, DIM, FG_GRAY, BOX_SINGLE, boxTop, boxBottom, boxRow } from "../ansi.js";

type ViewType = "dashboard" | "logs" | "add" | "edit";

const KEYS: Record<ViewType, string> = {
  dashboard: "↑↓←→ navigate  s start  x stop  r restart  l logs  S/X group  a add  ^L redraw  q quit",
  logs: "esc back  / search  f follow  ↑↓ scroll",
  add: "tab/↓ next  ↑ prev  enter confirm  esc cancel",
  edit: "tab/↓ next  ↑ prev  enter confirm  esc cancel",
};

export class StatusBarComponent implements Component {
  viewType: ViewType = "dashboard";

  invalidate(): void {}

  render(width: number): string[] {
    return [
      boxTop(width, BOX_SINGLE, FG_GRAY),
      boxRow(`${DIM}${KEYS[this.viewType]}${RESET}`, width, BOX_SINGLE, FG_GRAY),
      boxBottom(width, BOX_SINGLE, FG_GRAY),
    ];
  }
}
