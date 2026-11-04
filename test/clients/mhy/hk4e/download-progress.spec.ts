import { describe, expect, it, vi } from "vitest";

vi.mock("@runtime/format", () => ({
  downloadPercent: (downloaded: number, total: number) =>
    `percent:${downloaded}/${total}`,
  formatDownloadSpeed: (speed: number) => `speed:${speed}`,
  humanFileSize: (size: number) => `size:${size}`,
}));

vi.mock("@logging/logger", () => ({
  log: vi.fn(),
}));

vi.mock("@runtime/storage", () => ({
  setKey: vi.fn(async () => undefined),
  globalStorage: {
    namespace: undefined,
    getKey: vi.fn(async () => {
      throw new Error("not found");
    }),
    getKeyOrDefault: vi.fn(async () => "NOTFOUND"),
    setKey: vi.fn(async () => undefined),
  },
}));

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => false),
  stats: vi.fn(),
  readAllLines: vi.fn(),
}));

vi.mock("@runtime/macos-filesystem", () => ({
  mkdirp: vi.fn(async () => undefined),
}));

vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(async () => undefined),
}));

vi.mock("@runtime/patching", () => ({
  md5: vi.fn(),
}));

import type { TaskProgressCommand } from "@tasks/task-program";
import type { Sophon, SophonClient, SophonProgressEvent } from "@sophon";
import { checkIntegrityProgram } from "@src/clients/mhy/hk4e/program-check-integrity";
import { downloadAndInstallGameProgram } from "@src/clients/mhy/hk4e/program-install-game";
import {
  predownloadGameProgram,
  updateGameProgram,
} from "@src/clients/mhy/hk4e/program-update-game";

const FIRST_TRANSFER = {
  download_speed: 1024,
  downloaded_size: 2048,
  total_size: 4096,
  overall_percent: 50,
};
const SECOND_TRANSFER = {
  download_speed: 2048,
  downloaded_size: 4096,
  total_size: 8192,
  overall_percent: 75,
};

function createSophon(events: SophonProgressEvent[]) {
  return {
    startInstallation: vi.fn(async () => "install-task"),
    startUpdate: vi.fn(async () => "update-task"),
    startRepair: vi.fn(async () => "repair-task"),
    async *streamOperationProgress() {
      for (const event of events) yield event;
    },
  };
}

async function collect(program: AsyncGenerator<TaskProgressCommand, unknown>) {
  const commands: TaskProgressCommand[] = [];
  for await (const command of program) commands.push(command);
  return commands;
}

function downloadCommands(commands: TaskProgressCommand[]) {
  return commands.filter(
    command =>
      command[0] === "setStateText" &&
      command[1] === "DOWNLOADING_FILE_PROGRESS"
  );
}

function transferArgs(command: TaskProgressCommand) {
  return command.slice(3, 7);
}

describe("hk4e download progress across file boundaries", () => {
  it("keeps install transfer stats when the next file starts", async () => {
    const sophon = createSophon([
      { type: "file_download_start", task_id: "t" },
      {
        type: "chunk_progress",
        task_id: "t",
        filename: "first.bin",
        overall_progress: FIRST_TRANSFER,
      },
      { type: "file_download_start", task_id: "t" },
    ]);

    const commands = downloadCommands(
      await collect(
        downloadAndInstallGameProgram({
          sophonClient: sophon as unknown as SophonClient,
          gameDir: "/game",
          installReltype: "os",
        })
      )
    );

    expect(transferArgs(commands[0])).toEqual(["", "", "", ""]);
    expect(transferArgs(commands[2])).toEqual(transferArgs(commands[1]));
  });

  it("keeps update transfer stats when the next diff starts", async () => {
    const sophon = createSophon([
      {
        type: "ldiff_download_complete",
        task_id: "t",
        filename: "first.diff",
        overall_progress: FIRST_TRANSFER,
      },
      {
        type: "ldiff_download_start",
        task_id: "t",
        filename: "second.diff",
      },
    ]);

    const commands = downloadCommands(
      await collect(
        updateGameProgram({
          sophon: sophon as unknown as Sophon,
          gameDir: "/game",
          server: {} as never,
          updatedGameVersion: "3.5.0",
        })
      )
    );

    expect(transferArgs(commands[1])).toEqual(transferArgs(commands[0]));
  });

  it("keeps repair stats across regular and diff file starts", async () => {
    const sophon = createSophon([
      {
        type: "chunk_progress",
        task_id: "t",
        filename: "first.bin",
        overall_progress: FIRST_TRANSFER,
      },
      { type: "file_download_start", task_id: "t" },
      {
        type: "ldiff_download_complete",
        task_id: "t",
        filename: "first.diff",
        overall_progress: SECOND_TRANSFER,
      },
      {
        type: "ldiff_download_start",
        task_id: "t",
        filename: "second.diff",
      },
    ]);

    const commands = downloadCommands(
      await collect(
        checkIntegrityProgram({
          sophon: sophon as unknown as Sophon,
          gameDir: "/game",
        })
      )
    );

    expect(transferArgs(commands[1])).toEqual(transferArgs(commands[0]));
    expect(transferArgs(commands[3])).toEqual(transferArgs(commands[2]));
  });

  it("keeps predownload stats when the next diff starts", async () => {
    const sophon = createSophon([
      {
        type: "ldiff_download_complete",
        task_id: "t",
        filename: "first.diff",
        overall_progress: FIRST_TRANSFER,
      },
      {
        type: "ldiff_download_start",
        task_id: "t",
        filename: "second.diff",
      },
    ]);

    const commands = downloadCommands(
      await collect(
        predownloadGameProgram({
          sophon: sophon as unknown as Sophon,
          gameDir: "/game",
          targetVersion: "1.0.0",
        })
      )
    );

    expect(transferArgs(commands[1])).toEqual(transferArgs(commands[0]));
  });
});

describe("local processing progress", () => {
  it("switches from patching to file checking with separate counters", async () => {
    const sophon = createSophon([
      {
        type: "processing_progress",
        task_id: "t",
        phase: "patching",
        filename: "Data/patch.bin",
        processed_files: 2,
        total_files: 4,
        current_bytes: 1024,
        file_bytes: 2048,
        elapsed_seconds: 3,
      },
      {
        type: "processing_progress",
        task_id: "t",
        phase: "calculating_download",
        filename: "Data/check.bin",
        processed_files: 1,
        total_files: 10,
        elapsed_seconds: 2,
      },
    ]);
    const commands = await collect(
      updateGameProgram({
        sophon: sophon as unknown as Sophon,
        gameDir: "/game",
        server: { dataDir: "Data" } as never,
        updatedGameVersion: "7.2.0",
        storage: { setKey: vi.fn() } as never,
      })
    );
    expect(commands).toContainEqual([
      "setStateText",
      "PATCHING_FILE_PROGRESS",
      "2",
      "4",
      "patch.bin",
      " (size:1024/size:2048)",
      "3",
    ]);
    expect(commands).toContainEqual([
      "setStateText",
      "CHECKING_DOWNLOAD_FILES",
      "1",
      "10",
      "check.bin",
      "",
      "2",
    ]);
    expect(commands).toContainEqual(["setProgress", 50]);
    expect(commands).toContainEqual(["setProgress", 10]);
    expect(commands).toContainEqual([
      "setDownloadStats",
      { speed: 0, downloaded: 0, total: 0 },
    ]);
  });
});
