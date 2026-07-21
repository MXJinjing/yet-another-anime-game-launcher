import { createSignal } from "solid-js";
import { Box, Text } from "@hope-ui/solid";
import { Locale } from "@locale";

const SUDOERS_CMD =
  'echo "$USER ALL=(ALL) NOPASSWD: /sbin/pfctl" | sudo tee /etc/sudoers.d/yaagl-pf';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Neutralino WebView supports navigator.clipboard
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: use osascript
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
  config: Partial<never>;
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
          <Box
            as="pre"
            p="$2"
            bg="#0d0d1a"
            borderRadius="$sm"
            fontSize="$xs"
            fontFamily="monospace"
            color="#7ec8e3"
            overflowX="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
            userSelect="all"
            mb="$2"
          >
            {SUDOERS_CMD}
          </Box>
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
