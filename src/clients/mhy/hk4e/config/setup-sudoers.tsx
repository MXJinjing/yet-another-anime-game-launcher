import { createSignal } from "solid-js";
import { Box, Text } from "@hope-ui/solid";
import { Locale } from "@locale";
import { Config } from "@config/config-def";

const SUDOERS_CMD =
  'echo "$USER ALL=(ALL) NOPASSWD: /sbin/pfctl" | sudo tee /etc/sudoers.d/yaagl-pf';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const { exec } = await import("@utils");
      await exec(
        [
          "osascript",
          "-e",
          `set the clipboard to "${text.replace(/"/g, '\\"')}"`,
        ],
        {},
        false
      );
      return true;
    } catch {
      return false;
    }
  }
}

export default async function ({
  locale,
}: {
  locale: Locale;
  config: Partial<Config>;
}) {
  const [copied, setCopied] = createSignal(false);

  return [
    function UI() {
      return (
        <Box mt="$4" p="$3" bg="#1a1a2e" borderRadius="$md">
          <Text fontSize="$sm" fontWeight="bold" mb="$2">
            {locale.get("SETTING_SUDOERS_SETUP")}
          </Text>
          <Text fontSize="$xs" mb="$2" color="#aaa">
            {locale.get("SETTING_SUDOERS_DESC")}
          </Text>
          <pre
            style="margin:0 0 8px 0;padding:8px;background:#0d0d1a;border-radius:4px;font-size:12px;font-family:monospace;color:#7ec8e3;overflow-x:auto;white-space:pre-wrap;word-break:break-all;user-select:all"
          >
            {SUDOERS_CMD}
          </pre>
          <Box
            as="button"
            px="$3"
            py="$1"
            bg={copied() ? "#2d6a4f" : "#3b82f6"}
            color="white"
            borderRadius="$sm"
            border="none"
            cursor="pointer"
            fontSize="$xs"
            onClick={async () => {
              const ok = await copyToClipboard(SUDOERS_CMD);
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
          >
            {copied()
              ? locale.get("SETTING_COPIED")
              : locale.get("SETTING_COPY")}
          </Box>
        </Box>
      );
    },
  ] as const;
}
