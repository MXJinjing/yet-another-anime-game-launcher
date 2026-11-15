import { normalizeHttpProxy } from "../config/proxy";
import { getKeyOrDefault } from "../runtime/storage";

export async function getDownloadProxy(): Promise<string | undefined> {
  if (
    (await getKeyOrDefault("config_downloadProxyEnabled", "false")) !== "true"
  ) {
    return undefined;
  }
  const address = normalizeHttpProxy(
    await getKeyOrDefault("config_downloadProxyHost", "")
  );
  return address || undefined;
}
