import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Text,
  VStack,
} from "@hope-ui/solid";
import {
  createResource,
  createSignal,
  createUniqueId,
  For,
  Show,
} from "solid-js";
import { AppModal, AppModalButton } from "../components/app-modal";
import type { Locale } from "../locale";
import {
  sophonInstallSize,
  type SophonInstallOptionsMetadata,
  type SophonInstallSelection,
} from "../integrations/sophon-install-options";
import { humanFileSize } from "../runtime/format";

const voiceLabels: Record<string, [string, string]> = {
  "en-us": ["English", "英语"],
  "ja-jp": ["Japanese", "日语"],
  "ko-kr": ["Korean", "韩语"],
  "zh-cn": ["Chinese", "中文"],
};

export function SophonInstallModal(props: {
  title: string;
  directory: string;
  locale: Locale;
  load: () => Promise<SophonInstallOptionsMetadata | null>;
  onClose: () => void;
  onConfirm: (selection?: SophonInstallSelection) => void;
}) {
  const id = createUniqueId();
  const zh = props.locale.currentLanguage.startsWith("zh");
  const [selectedMode, setSelectedMode] = createSignal<"full" | "base">("full");
  const [selectedVoices, setSelectedVoices] = createSignal<string[]>([]);
  const [options, { refetch }] = createResource(async () => {
    try {
      return { catalog: await props.load() };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  const catalog = () => options()?.catalog;
  const error = () => options()?.error;
  const busy = () => options.loading;
  const resuming = () => Boolean(catalog()?.resume);
  const mode = () => catalog()?.resume?.mode ?? selectedMode();
  const voicePacks = () => catalog()?.resume?.voicePacks ?? selectedVoices();
  const selection = () => ({
    mode: mode(),
    voicePacks: voicePacks(),
    version: catalog()?.version ?? "",
  });
  const totalSize = () => {
    const value = catalog();
    return value ? humanFileSize(sophonInstallSize(value, selection())) : "—";
  };
  const modeLabel = (mode: "full" | "base") =>
    mode === "full"
      ? zh
        ? "完整安装"
        : "Full install"
      : zh
      ? "基础安装"
      : "Base install";

  const optionStyle = {
    display: "flex",
    minW: 0,
    gap: "$2",
    p: "$3",
    borderWidth: "1px",
    borderColor: "$neutral5",
    borderRadius: "$lg",
    bg: "$neutral2",
    color: "$neutral12",
    cursor: "pointer",
    transition: "background-color 0.15s, border-color 0.15s",
    _hover: { borderColor: "$neutral7" },
    _focusWithin: { outline: "2px solid $primary8", outlineOffset: "2px" },
    css: {
      "&[data-selected=true]": {
        bg: "$primary2",
        borderColor: "$primary7",
      },
      "&[data-disabled=true]": { cursor: "default" },
      "& input": {
        width: "16px",
        height: "16px",
        margin: 0,
        flexShrink: 0,
        accentColor: "var(--hope-colors-primary9)",
        cursor: "inherit",
        colorScheme: "light",
        _dark: { colorScheme: "dark" },
      },
    },
  };
  const choiceGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "$2",
    css: { "@media (max-width: 540px)": { gridTemplateColumns: "1fr" } },
  };

  return (
    <AppModal
      opened
      onClose={props.onClose}
      title={`${props.locale.get("INSTALL")} · ${props.title}`}
      maxWidth={760}
      footer={
        <>
          <VStack alignItems="flex-start" spacing={0} mr="auto">
            <Text size="xs" color="$neutral11">
              {zh ? "预计安装大小" : "Estimated installation size"}
            </Text>
            <Text
              fontSize="$xl"
              fontWeight={600}
              color="$neutral12"
              aria-live="polite"
            >
              {totalSize()}
            </Text>
          </VStack>
          <AppModalButton onClick={props.onClose}>
            {props.locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            disabled={busy() || Boolean(error()) || !options()}
            onClick={() => props.onConfirm(catalog() ? selection() : undefined)}
          >
            {catalog() === null
              ? zh
                ? "导入"
                : "Import"
              : resuming()
              ? props.locale.get("DOWNLOAD_RESUME")
              : props.locale.get("INSTALL")}
          </AppModalButton>
        </>
      }
    >
      <VStack alignItems="stretch" spacing="$4">
        <FormControl id={`${id}-directory`}>
          <FormLabel fontSize="$sm">
            {zh ? "游戏目录" : "Game directory"}
          </FormLabel>
          <Input
            readOnly
            size="sm"
            value={props.directory}
            title={props.directory}
            minW={0}
            bg="$neutral2"
            css={{ textOverflow: "ellipsis" }}
          />
        </FormControl>
        <Show when={busy()}>
          <Text role="status" size="sm" color="$neutral11">
            {zh ? "正在加载安装选项…" : "Loading installation options…"}
          </Text>
        </Show>
        <Show when={!busy() && error()}>
          <Text
            role="alert"
            size="sm"
            color="$danger11"
            css={{ overflowWrap: "anywhere" }}
          >
            {error()}
          </Text>
          <Button
            variant="subtle"
            size="sm"
            alignSelf="flex-start"
            onClick={() => void refetch()}
          >
            {zh ? "重试" : "Retry"}
          </Button>
        </Show>
        <Show when={!busy() && catalog() === null}>
          <Text size="sm">
            {zh
              ? "将校验并导入现有游戏文件。"
              : "Verify and import the existing game files."}
          </Text>
        </Show>
        <Show when={!busy() && catalog()}>
          <Box as="fieldset" border={0} p={0} minW={0}>
            <FormLabel as="legend" fontSize="$sm">
              {zh ? "安装模式" : "Installation mode"}
            </FormLabel>
            <Box
              {...choiceGrid}
              gridTemplateColumns={
                catalog()?.modes.length === 1
                  ? "1fr"
                  : "repeat(2, minmax(0, 1fr))"
              }
            >
              <For each={catalog()?.modes}>
                {option => (
                  <Box
                    as="label"
                    {...optionStyle}
                    flexDirection="column"
                    data-selected={mode() === option.mode}
                    data-disabled={busy() || resuming()}
                    for={`${id}-mode-${option.mode}`}
                  >
                    <HStack spacing="$2" minW={0}>
                      <input
                        type="radio"
                        id={`${id}-mode-${option.mode}`}
                        name={`${id}-mode`}
                        value={option.mode}
                        aria-label={modeLabel(option.mode)}
                        checked={mode() === option.mode}
                        disabled={busy() || resuming()}
                        aria-describedby={
                          option.description
                            ? `${id}-${option.mode}-description`
                            : undefined
                        }
                        onChange={() => setSelectedMode(option.mode)}
                      />
                      <Text as="span" size="sm" fontWeight={600}>
                        {modeLabel(option.mode)}
                      </Text>
                      <Text
                        as="span"
                        size="sm"
                        color="$neutral11"
                        ml="auto"
                        flexShrink={0}
                      >
                        {humanFileSize(option.size)}
                      </Text>
                    </HStack>
                    <Show when={option.description}>
                      <Text
                        id={`${id}-${option.mode}-description`}
                        fontSize="13px"
                        lineHeight="1.5"
                        color="$neutral11"
                        css={{
                          whiteSpace: "pre-line",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {option.description}
                      </Text>
                    </Show>
                  </Box>
                )}
              </For>
            </Box>
          </Box>
          <Show when={catalog()?.voicePacks.length}>
            <Box as="fieldset" border={0} p={0} minW={0}>
              <FormLabel as="legend" fontSize="$sm">
                {zh ? "可选语音包" : "Optional voice packs"}
              </FormLabel>
              <Box {...choiceGrid}>
                <For each={catalog()?.voicePacks}>
                  {pack => (
                    <Box
                      as="label"
                      {...optionStyle}
                      alignItems="center"
                      data-selected={voicePacks().includes(pack.id)}
                      data-disabled={busy() || resuming()}
                      for={`${id}-voice-${pack.id}`}
                    >
                      <input
                        type="checkbox"
                        id={`${id}-voice-${pack.id}`}
                        checked={voicePacks().includes(pack.id)}
                        disabled={busy() || resuming()}
                        onChange={() =>
                          setSelectedVoices(values =>
                            values.includes(pack.id)
                              ? values.filter(value => value !== pack.id)
                              : [...values, pack.id]
                          )
                        }
                      />
                      <Text as="span" size="sm" fontWeight={500}>
                        {voiceLabels[pack.id]?.[zh ? 1 : 0] ?? pack.id}
                      </Text>
                      <Text
                        as="span"
                        size="sm"
                        color="$neutral11"
                        ml="auto"
                        flexShrink={0}
                      >
                        {humanFileSize(pack.size)}
                      </Text>
                    </Box>
                  )}
                </For>
              </Box>
            </Box>
          </Show>
        </Show>
      </VStack>
    </AppModal>
  );
}
