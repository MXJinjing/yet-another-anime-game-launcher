import { log } from "../logging/logger";
import { runInSudo } from "../platform/macos";
import {
  execCommand,
  offSpawnedProcess,
  onSpawnedProcess,
  spawnProcess,
} from "../platform/neutralino";
import { build, CommandSegments, rawString } from "../platform/shell";

export async function exec(
  segments: CommandSegments,
  env?: { [key: string]: string },
  sudo = false,
  log_redirect: string | undefined = undefined
): Promise<Neutralino.os.ExecCommandResult> {
  const cmd = build(
    [...segments, ...(log_redirect ? [rawString("&>"), log_redirect] : [])],
    env
  );
  const command = sudo ? runInSudo(cmd) : cmd;
  await log(command);
  const ret = await execCommand(command, {});
  if (ret.exitCode != 0) {
    throw new Error(
      `Command return non-zero code (${ret.exitCode}) \n${cmd}\nStdOut:\n${ret.stdOut}\nStdErr:\n${ret.stdErr}`
    );
  }
  return ret;
}

export async function exec2(
  segments: CommandSegments,
  env?: { [key: string]: string },
  sudo = false,
  log_redirect: string | undefined = undefined
): Promise<Neutralino.os.ExecCommandResult> {
  const cmd = build(
    [...segments, ...(log_redirect ? [rawString("&>"), log_redirect] : [])],
    env
  );
  const command = sudo ? runInSudo(cmd) : cmd;
  await log(command);

  let id: number | undefined;
  let pid = 0;
  let stdErr = "";
  let stdOut = "";
  const pendingEvents: Neutralino.os.SpawnProcessResult[] = [];
  let handler!: Neutralino.events.Handler<Neutralino.os.SpawnProcessResult>;
  let finish: (exit: number) => void = () => undefined;

  const handleDetail = (detail: Neutralino.os.SpawnProcessResult) => {
    if (detail.id != id) return;
    if (detail.action == "exit") finish(Number(detail.data));
    else if (detail.action == "stdOut") stdOut += detail.data;
    else if (detail.action == "stdErr") stdErr += detail.data;
  };

  const result = new Promise<Neutralino.os.ExecCommandResult>((res, rej) => {
    finish = (exit: number) => {
      offSpawnedProcess(handler);
      if (exit == 0) res({ pid, exitCode: exit, stdErr, stdOut });
      else {
        rej(
          new Error(
            `Command return non-zero code (${exit}) \n${command}\nStdOut:\n${stdOut}\nStdErr:\n${stdErr}`
          )
        );
      }
    };
    handler = event => {
      if (!event) return;
      if (id == undefined) pendingEvents.push(event.detail);
      else handleDetail(event.detail);
    };
  });

  await onSpawnedProcess(handler);
  try {
    const spawned = await spawnProcess(command);
    id = spawned.id;
    pid = spawned.pid;
    for (const detail of pendingEvents) handleDetail(detail);
  } catch (error) {
    await offSpawnedProcess(handler);
    throw error;
  }
  return result;
}

export async function spawn(
  segments: CommandSegments,
  env?: { [key: string]: string }
) {
  const cmd = build(segments, env);
  await log(cmd);
  const { pid, id } = await spawnProcess(cmd);
  await log(pid + "");
  await log(cmd);
  return { pid, id };
}
