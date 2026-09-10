/** Hosts that must resolve locally for both IPv4 and IPv6 at startup. */
const PERSISTENT_HOSTS = [
  "uspider.yuanshen.com",
  "log-upload.mihoyo.com",
  "public-data-api.mihoyo.com",
  "log-upload-os.hoyoverse.com",
  "sg-public-data-api.hoyoverse.com",
  "overseauspider.yuanshen.com",
] as const;

export const ENSURE_HOSTS: [string, string][] = PERSISTENT_HOSTS.flatMap(
  domain => [
    [domain, "0.0.0.0"] as [string, string],
    [domain, "::1"] as [string, string],
  ]
);
