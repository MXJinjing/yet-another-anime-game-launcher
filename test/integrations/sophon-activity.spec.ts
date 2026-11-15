import { describe, expect, it } from "vitest";
import {
  activityMetric,
  recordSophonActivity,
  type SophonActivity,
} from "@src/integrations/sophon-activity";
import type { SophonSnapshot } from "@src/integrations/sophon-progress";

function snapshot(time: number, phase = "running"): SophonSnapshot {
  const metric = { completed: 41, rate: 30, etaSeconds: 2 };
  const io = { read: metric, write: metric };
  return {
    phase,
    metrics: {
      common: {
        ...io,
        network: metric,
        files: metric,
        timing: {
          elapsedSeconds: time,
          stageElapsedSeconds: time,
          etaSeconds: 2,
          phaseDurations: {},
        },
        resources: {
          memoryBytes: 24,
          memoryLimit: 256,
          diskLimit: 4096,
          diskReservedBytes: 300,
          memoryCache: io,
          diskCache: io,
          target: io,
          downloads: [],
          devices: [
            {
              ...io,
              id: "cache",
              location: "/volume",
              roles: ["cache"],
              cacheBytes: 93,
              reservedCacheBytes: 300,
            },
          ],
        },
      },
      verification: {
        files: metric,
        bytes: metric,
        chunks: metric,
        missingFiles: 1,
        brokenFiles: 0,
      },
      downloadedChunks: 0,
      processing: { bytes: 0 },
      retries: 0,
    },
  };
}

function operation(id: string): SophonActivity {
  return {
    id,
    kind: "install",
    predownload: false,
    status: "starting",
    history: [],
  };
}

describe("Sophon activity sampling", () => {
  it("tracks cache, disk and transfer metrics for one operation", () => {
    const inactive = operation("inactive");
    const progress = snapshot(1);
    const activity = recordSophonActivity(operation("active"), {
      status: "running",
      progress,
    });
    expect(activity.history).toEqual([
      {
        time: 1,
        values: expect.objectContaining({
          "common.network": 30,
          "common.resources.target.write": 30,
          "verification.files": 30,
          "disk.write": 30,
          "volume:cache:write": 30,
          memory: 24,
          stored: 93,
          reserved: 300,
        }),
      },
    ]);
    expect(activity.progress?.metrics.common.timing.etaSeconds).toBe(2);
    expect(inactive.history).toEqual([]);
    expect(activityMetric(progress, "repair.write")).toBeUndefined();
    const withoutResources = snapshot(1);
    delete withoutResources.metrics.common.resources;
    expect(
      activityMetric(withoutResources, "common.resources.target.read")
    ).toMatchObject({ rate: 30 });
  });

  it("bounds each activity to one sample per second for the last minute", () => {
    let activity = operation("task");
    for (let tick = 0; tick <= 160; tick += 0.25) {
      activity = recordSophonActivity(activity, {
        status: "running",
        progress: snapshot(tick),
      });
    }
    expect(activity.history).toHaveLength(61);
    expect(activity.history.at(0)?.time).toBe(100);
    expect(activity.history.at(-1)?.time).toBe(160);
  });

  it("resets when the sidecar swaps a repair from update into verification", () => {
    const activity = recordSophonActivity(operation("repair"), {
      status: "running",
      progress: snapshot(80),
    });
    const verification = recordSophonActivity(activity, {
      status: "running",
      progress: snapshot(0.5, "scanning"),
    });
    expect(verification.history.map(sample => sample.time)).toEqual([0.5]);
    const finished = recordSophonActivity(verification, {
      status: "completed",
    });
    expect(finished.progress?.phase).toBe("scanning");
    expect(finished.history).toHaveLength(1);
  });
});
