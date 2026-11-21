export function env(key: string) {
  return Neutralino.os.getEnv(key);
}

export function getMemoryInfo() {
  return Neutralino.computer.getMemoryInfo();
}

export function getCPUInfo() {
  return Neutralino.computer.getCPUInfo();
}

export function open(url: string) {
  return Neutralino.os.open(url);
}

export function restart() {
  return Neutralino.app.restartProcess();
}

export function exit(exitCode: number) {
  return Neutralino.app.exit(exitCode);
}

const beforeCloseAppHooks: Array<() => Promise<void>> = [];

export function addBeforeCloseApp(hook: () => Promise<void>) {
  beforeCloseAppHooks.push(hook);
  return () => {
    const index = beforeCloseAppHooks.indexOf(hook);
    if (index >= 0) beforeCloseAppHooks.splice(index, 1);
  };
}

/**
 * Terminates the current app without asking WebView/AppKit to close its
 * window. macOS 26 can throw from Neutralino's graceful WebView teardown
 * (ViewBridge/NSRemoteView), which aborts the process before exit completes.
 * Registered cleanup, including the independent log window, runs first.
 */
export async function closeApp() {
  for (const hook of [...beforeCloseAppHooks]) {
    try {
      await hook();
    } catch {
      // Cleanup must not keep the launcher process alive.
    }
  }
  return Neutralino.app.killProcess();
}

export async function alert(title: string, message: string) {
  return Neutralino.os.showMessageBox(title, message, "OK");
}

export async function prompt(title: string, message: string) {
  return (
    (await Neutralino.os.showMessageBox(title, message, "YES_NO")) == "YES"
  );
}

export function openDir(title: string) {
  return Neutralino.os.showFolderDialog(title, {});
}

export async function promptUpdate(
  title: string,
  message: string,
  cancelText: string,
  ignoreText: string,
  updateText: string
) {
  try {
    const script = `button returned of (display dialog "${message.replaceAll(
      '"',
      '\\"'
    )}" with title "${title.replaceAll(
      '"',
      '\\"'
    )}" buttons {"${ignoreText}", "${cancelText}", "${updateText}"} default button "${updateText}")`;
    const ret = await Neutralino.os.execCommand(`osascript -e '${script}'`, {});
    const val = ret.stdOut.trim();
    if (val === updateText) return "UPDATE";
    if (val === ignoreText) return "IGNORE";
    return "CANCEL";
  } catch {
    const out = await Neutralino.os.showMessageBox(
      title,
      message,
      "YES_NO_CANCEL"
    );
    if (out == "YES") return "UPDATE";
    if (out == "NO") return "IGNORE";
    return "CANCEL";
  }
}
