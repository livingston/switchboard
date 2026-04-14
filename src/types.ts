export interface ServerConfig {
  name: string;
  cmd: string;
  dir?: string;
  port?: number;
  sudo?: boolean | string;
  pidFile?: string;
  stopCmd?: string;
}

export interface AppGroup {
  name: string;
  servers: ServerConfig[];
}

export interface Config {
  groups: AppGroup[];
}

export type ServerStatus = "stopped" | "running" | "crashed";

export interface ServerState {
  config: ServerConfig;
  groupName: string;
  status: ServerStatus;
  pid: number | null;
  cpu: number;
  memMb: number;
  startedAt: number | null;
}

export type View =
  | { type: "dashboard" }
  | { type: "logs"; serverKey: string }
  | { type: "add" }
  | { type: "edit"; serverKey: string };
