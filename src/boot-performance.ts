import { appendFile } from "./platform/neutralino/filesystem";
import { resolve } from "./platform/neutralino/path";

export type BootPerformanceEntry = {
  name: string;
  durationMs: number;
  startMs: number;
  endMs: number;
};

export type BootPerformanceReport = {
  totalMs: number;
  entries: BootPerformanceEntry[];
};

type Clock = () => number;

/** Development-only startup timing. It intentionally buffers output until the UI is mounted. */
export class BootPerformance {
  private readonly startedAt: number;
  private readonly entries: BootPerformanceEntry[] = [];
  private readonly active = new Map<string, number>();

  constructor(
    private readonly enabled: boolean,
    private readonly clock: Clock = () => performance.now()
  ) {
    this.startedAt = this.clock();
  }

  mark(name: string) {
    if (!this.enabled) return;
    const now = this.clock();
    this.entries.push({ name, durationMs: 0, startMs: now, endMs: now });
  }

  start(name: string) {
    if (!this.enabled) return;
    this.active.set(name, this.clock());
  }

  end(name: string) {
    if (!this.enabled) return;
    const start = this.active.get(name);
    if (start === undefined) return;
    const end = this.clock();
    this.active.delete(name);
    this.entries.push({
      name,
      durationMs: Math.max(0, end - start),
      startMs: start,
      endMs: end,
    });
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await operation();
    } finally {
      this.end(name);
    }
  }

  report(): BootPerformanceReport {
    return {
      totalMs: Math.max(0, this.clock() - this.startedAt),
      entries: [...this.entries],
    };
  }

  async flush() {
    if (!this.enabled) return;
    const report = this.report();
    const summary = report.entries
      .map(entry => `${entry.name}=${entry.durationMs.toFixed(1)}ms`)
      .join(", ");
    const message = `[boot-performance] total=${report.totalMs.toFixed(1)}ms ${summary}`;
    console.info(message);
    const output = JSON.stringify({
      recordedAt: new Date().toISOString(),
      totalMs: report.totalMs,
      entries: report.entries,
    });
    await appendFile(resolve("./boot-performance.jsonl"), `${output}\n`);
  }
}

export function createBootPerformance(enabled: boolean) {
  return new BootPerformance(enabled);
}
