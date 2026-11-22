import { describe, expect, it, vi } from "vitest";
import { forceStopThenLaunch } from "@src/launcher/controller/force-stop-launch";

function wine() {
  return {
    killAll: vi.fn(async () => undefined),
    waitForWineServerExit: vi.fn(
      async (_options?: { timeoutMs?: number }) => true
    ),
  };
}

describe("force stop then launch", () => {
  it("waits for the Wine server before launching again", async () => {
    const steps: string[] = [];
    const fake = wine();
    fake.killAll.mockImplementation(async () => {
      steps.push("kill");
    });
    fake.waitForWineServerExit.mockImplementation(async options => {
      steps.push(`wait:${options?.timeoutMs}`);
      return true;
    });

    await forceStopThenLaunch(fake, async () => {
      steps.push("launch");
    });

    expect(steps).toEqual(["kill", "wait:5000", "launch"]);
  });

  it("still launches when the Wine server does not finish in time", async () => {
    const fake = wine();
    fake.waitForWineServerExit.mockResolvedValue(false);
    const launch = vi.fn(async () => undefined);

    await forceStopThenLaunch(fake, launch, 250);

    expect(fake.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 250,
    });
    expect(launch).toHaveBeenCalledOnce();
  });

  it("does not launch when stopping the game fails", async () => {
    const fake = wine();
    fake.killAll.mockRejectedValue(new Error("wine is gone"));
    const launch = vi.fn(async () => undefined);

    await expect(forceStopThenLaunch(fake, launch)).rejects.toThrow(
      "wine is gone"
    );
    expect(launch).not.toHaveBeenCalled();
  });
});
