import type { Component } from "@mariozechner/pi-tui";
import type { Config, ServerConfig } from "../types.js";
import { RESET, BOLD, DIM, FG_BLUE } from "../ansi.js";

type Field = "group" | "name" | "cmd" | "dir" | "port" | "sudo";
const FIELDS: Field[] = ["group", "name", "cmd", "dir", "port", "sudo"];
const LABELS: Record<Field, string> = {
  group: "Group", name: "Name", cmd: "Command",
  dir: "Directory", port: "Port", sudo: "Sudo",
};

export class ServerFormComponent implements Component {
  isEdit = false;
  editKey?: string;
  activeField = 0;
  values: Record<Field, string> = { group: "", name: "", cmd: "", dir: "", port: "", sudo: "" };
  allocatedHeight = 0;

  loadForEdit(config: Config, key: string): void {
    this.isEdit = true;
    this.editKey = key;
    const [groupName, serverName] = key.split("/");
    const group = config.groups.find((g) => g.name === groupName);
    const server = group?.servers.find((s) => s.name === serverName);
    this.values = {
      group: groupName ?? "",
      name: server?.name ?? "",
      cmd: server?.cmd ?? "",
      dir: server?.dir ?? "",
      port: server?.port?.toString() ?? "",
      sudo: server?.sudo ? (typeof server.sudo === "string" ? server.sudo : "true") : "",
    };
    this.activeField = 0;
  }

  loadForAdd(): void {
    this.isEdit = false;
    this.editKey = undefined;
    this.values = { group: "", name: "", cmd: "", dir: "", port: "", sudo: "" };
    this.activeField = 0;
  }

  get currentField(): Field { return FIELDS[this.activeField]; }
  nextField(): void { this.activeField = Math.min(FIELDS.length - 1, this.activeField + 1); }
  prevField(): void { this.activeField = Math.max(0, this.activeField - 1); }
  typeChar(ch: string): void { this.values[this.currentField] += ch; }
  backspace(): void { this.values[this.currentField] = this.values[this.currentField].slice(0, -1); }
  isValid(): boolean { return !!(this.values.group && this.values.name && this.values.cmd); }

  toServerConfig(): ServerConfig {
    const port = this.values.port ? parseInt(this.values.port, 10) : undefined;
    const sudo = this.values.sudo
      ? (this.values.sudo === "true" ? true : this.values.sudo)
      : undefined;
    return {
      name: this.values.name, cmd: this.values.cmd,
      dir: this.values.dir || undefined,
      port: isNaN(port ?? NaN) ? undefined : port, sudo,
    };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(`${BOLD}${FG_BLUE}${this.isEdit ? "EDIT SERVER" : "ADD SERVER"}${RESET}`);
    lines.push("");
    for (let i = 0; i < FIELDS.length; i++) {
      const field = FIELDS[i];
      const isFocused = i === this.activeField;
      const prefix = isFocused ? `${FG_BLUE}▸ ` : "  ";
      const value = this.values[field];
      const cursor = isFocused ? `${DIM}_${RESET}` : "";
      const hint = isFocused && field === "sudo" ? ` ${DIM}(true, or flags like -E)${RESET}` : "";
      lines.push(`${prefix}${LABELS[field]}: ${RESET}${value}${cursor}${hint}`);
    }
    lines.push("");
    lines.push(`${DIM}tab/↓ next field · enter confirm · esc cancel${RESET}`);
    return lines;
  }
}
