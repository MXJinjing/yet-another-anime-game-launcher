import yaaglmConfig from "../constants/yaaglm-config.secret.json";

/** Hosts that must resolve locally for both IPv4 and IPv6 at startup. */
export const ENSURE_HOSTS: [string, string][] =
  yaaglmConfig.persistentHosts.flatMap(domain => [
    [domain, "0.0.0.0"] as [string, string],
    [domain, "::1"] as [string, string],
  ]);
