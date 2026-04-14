import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { parse, stringify } from "yaml";
import type { Config } from "./types.js";

const DEFAULT_CONFIG_DIR = join(
  process.env.HOME ?? "~",
  ".config",
  "switchboard"
);

export interface ProcessStateEntry {
  pid: number;
  startedAt: number;
}

export type ProcessStateMap = Record<string, ProcessStateEntry>;

export function getConfigPath(): string {
  return join(DEFAULT_CONFIG_DIR, "apps.yaml");
}

export function loadConfig(path: string = getConfigPath()): Config {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parse(raw);
    if (!parsed || !Array.isArray(parsed.groups)) return { groups: [] };
    return parsed as Config;
  } catch {
    return { groups: [] };
  }
}

export function saveConfig(
  path: string = getConfigPath(),
  config: Config
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, stringify(config), "utf-8");
}

function getStatePath(): string {
  return join(DEFAULT_CONFIG_DIR, "state.json");
}

export function loadProcessState(): ProcessStateMap {
  try {
    return JSON.parse(readFileSync(getStatePath(), "utf-8"));
  } catch {
    return {};
  }
}

export function saveProcessState(state: ProcessStateMap): void {
  mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
  writeFileSync(getStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

export function clearProcessState(): void {
  try {
    unlinkSync(getStatePath());
  } catch {
    // Already gone
  }
}
