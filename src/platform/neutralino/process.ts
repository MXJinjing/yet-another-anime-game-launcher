export function execCommand(command: string, options = {}) {
  return Neutralino.os.execCommand(command, options);
}

export function spawnProcess(command: string) {
  return Neutralino.os.spawnProcess(command);
}

export function updateSpawnedProcess(
  id: number,
  action: "stdIn" | "stdInEnd" | "exit",
  data?: object
) {
  return Neutralino.os.updateSpawnedProcess(id, action, data);
}

export function onSpawnedProcess(
  handler: Neutralino.events.Handler<Neutralino.os.SpawnProcessResult>
) {
  return Neutralino.events.on("spawnedProcess", handler);
}

export function offSpawnedProcess(
  handler: Neutralino.events.Handler<Neutralino.os.SpawnProcessResult>
) {
  return Neutralino.events.off("spawnedProcess", handler);
}
