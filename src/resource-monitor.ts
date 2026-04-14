export interface ResourceStats {
  cpu: number;
  memMb: number;
}

export function parsePsOutput(output: string): ResourceStats {
  const line = output.trim().split("\n").pop()?.trim();
  if (!line) return { cpu: 0, memMb: 0 };

  const parts = line.split(/\s+/);
  if (parts.length < 3) return { cpu: 0, memMb: 0 };

  const cpu = parseFloat(parts[0]);
  const rssKb = parseInt(parts[2], 10);

  if (isNaN(cpu) || isNaN(rssKb)) return { cpu: 0, memMb: 0 };

  return {
    cpu: Math.round(cpu * 10) / 10,
    memMb: Math.round(rssKb / 1024),
  };
}

function parsePsLine(line: string): ResourceStats | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const cpu = parseFloat(parts[1]);
  const rssKb = parseInt(parts[3], 10);
  if (isNaN(cpu) || isNaN(rssKb)) return null;
  return {
    cpu: Math.round(cpu * 10) / 10,
    memMb: Math.round(rssKb / 1024),
  };
}

/** Batch-fetch stats for multiple PIDs in a single ps call */
export async function getBatchResourceStats(
  pids: number[]
): Promise<Map<number, ResourceStats>> {
  const result = new Map<number, ResourceStats>();
  if (pids.length === 0) return result;

  try {
    const proc = Bun.spawn(
      ["ps", "-o", "pid,%cpu,%mem,rss", "-p", pids.join(",")],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // Skip header line, parse each data line
    const lines = output.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const pid = parseInt(parts[0], 10);
      const stats = parsePsLine(line);
      if (!isNaN(pid) && stats) {
        result.set(pid, stats);
      }
    }
  } catch {
    // ps failed — return empty
  }
  return result;
}

export async function getResourceStats(
  pid: number
): Promise<ResourceStats> {
  const batch = await getBatchResourceStats([pid]);
  return batch.get(pid) ?? { cpu: 0, memMb: 0 };
}

export async function isPortListening(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        open(socket) { socket.end(); },
        error() {},
      },
    });
    conn.end();
    return true;
  } catch {
    return false;
  }
}
