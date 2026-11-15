import {
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { openDir } from "@platform/neutralino";
import type { Locale } from "@locale";
import { sophonDownloaderText } from "../../locale/sophon-downloader";
import {
  SophonSettings,
  sophonDefaults,
  sophonNumberSettings,
  sophonSettingsError,
  readSophonSettings,
  saveSophonSettings,
} from "../../integrations/sophon-settings";

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <FormControl>
      <FormLabel>{props.label}</FormLabel>
      <Select value={props.value} onChange={props.onChange}>
        <SelectTrigger>
          <SelectValue />
          <SelectIcon />
        </SelectTrigger>
        <SelectContent
          bg="#202328"
          color="white"
          css={{
            "& .hope-select__option:hover": { bg: "rgba(255, 255, 255, 0.1)" },
          }}
        >
          <SelectListbox>
            <For each={props.options}>
              {option => (
                <SelectOption value={option.value} disabled={option.disabled}>
                  <SelectOptionText>{option.label}</SelectOptionText>
                  <SelectOptionIndicator />
                </SelectOption>
              )}
            </For>
          </SelectListbox>
        </SelectContent>
      </Select>
    </FormControl>
  );
}

export function SophonSettingsPanel(props: { locale: Locale }) {
  const [settings] = createResource(readSophonSettings);
  return (
    <Show when={settings()} keyed>
      {initial => (
        <SophonSettingsForm initial={initial} locale={props.locale} />
      )}
    </Show>
  );
}

function SophonSettingsForm(props: {
  initial: SophonSettings;
  locale: Locale;
}) {
  const [committed, setCommitted] = createSignal(props.initial);
  const [value, setValue] = createSignal<SophonSettings>({ ...props.initial });
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const disabled = saving;
  const text = () => sophonDownloaderText(props.locale.currentLanguage);
  const invalid = () => sophonSettingsError(value(), text());
  const dirty = () => JSON.stringify(value()) !== JSON.stringify(committed());

  function update(settings: Partial<SophonSettings>) {
    setValue(previous => ({ ...previous, ...settings }));
    setError("");
    setSaved(false);
  }

  async function save() {
    if (disabled() || invalid()) return;
    setSaving(true);
    setError("");
    try {
      const next = { ...value() };
      await saveSophonSettings(next);
      setCommitted(next);
      setSaved(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  function NumberSetting(props: {
    field: (typeof sophonNumberSettings)[number];
  }) {
    const field = props.field;
    const minimum = () =>
      field.key === "maxCachedFileHandles" && value().ioPolicy === "parallel"
        ? value().writes
        : field.min;
    return (
      <FormControl
        disabled={
          (field.key === "writes" && value().ioPolicy === "serialized") ||
          (field.key === "diskGiB" && !value().diskCacheEnabled)
        }
      >
        <FormLabel>{text()[field.key]}</FormLabel>
        <Input
          type="number"
          required
          min={minimum()}
          max={field.max}
          step={1}
          value={Number.isFinite(value()[field.key]) ? value()[field.key] : ""}
          onInput={event =>
            update({ [field.key]: event.currentTarget.valueAsNumber })
          }
        />
        <Show when={field.key === "writes"}>
          <FormHelperText>
            {value().ioPolicy === "serialized"
              ? text().singleWriter
              : text().writeHelp}
          </FormHelperText>
        </Show>
        <Show when={field.key === "checks"}>
          <FormHelperText>{text().checkHelp}</FormHelperText>
        </Show>
        <Show when={field.key === "memoryMiB"}>
          <FormHelperText>{text().memoryHelp}</FormHelperText>
        </Show>
        <Show when={field.key === "diskGiB"}>
          <FormHelperText>{text().diskHelp}</FormHelperText>
        </Show>
      </FormControl>
    );
  }

  return (
    <form
      class="sophon-downloader-settings"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset
        disabled={disabled()}
        style={{ border: "0", padding: "0", margin: "0", "min-width": "0" }}
      >
        <VStack spacing="$5" alignItems="stretch">
          <Text fontSize="$lg" fontWeight={600}>
            {text().title}
          </Text>
          <Text size="sm" color="rgba(255, 255, 255, 0.7)">
            {text().intro}
          </Text>
          <FormControl>
            <FormLabel>{text().directory}</FormLabel>
            <Input
              readOnly
              value={value().predownloadDirectory}
              placeholder={text().gameDirectory}
            />
            <HStack spacing="$2" mt="$2">
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  try {
                    const directory = await openDir(text().chooseDirectory);
                    if (directory) update({ predownloadDirectory: directory });
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              >
                {text().browse}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                disabled={!value().predownloadDirectory}
                onClick={() => update({ predownloadDirectory: "" })}
              >
                {text().useDefault}
              </Button>
            </HStack>
            <FormHelperText>{text().directoryHelp}</FormHelperText>
          </FormControl>
          <For
            each={sophonNumberSettings.filter(
              field => field.key === "downloads"
            )}
          >
            {field => <NumberSetting field={field} />}
          </For>
          <VStack
            as="section"
            aria-labelledby="sophon-advanced-heading"
            spacing="$5"
            alignItems="stretch"
            bg="rgba(255, 255, 255, 0.045)"
            borderWidth="1px"
            borderColor="rgba(255, 255, 255, 0.13)"
            borderRadius={12}
            p="$5"
          >
            <Box color="rgba(255, 255, 255, 0.92)">
              <Text as="h3" id="sophon-advanced-heading" fontWeight={600}>
                {props.locale.get("SETTING_ADVANCED")}
              </Text>
            </Box>
            <Choice
              label={text().ioPolicy}
              value={value().ioPolicy}
              onChange={ioPolicy => update({ ioPolicy })}
              options={[
                { value: "parallel", label: text().parallel },
                { value: "serialized", label: text().serialized },
              ]}
            />
            <Box
              display="grid"
              gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))"
              gap="$4"
            >
              <For
                each={sophonNumberSettings.filter(
                  field => field.key !== "downloads"
                )}
              >
                {field => <NumberSetting field={field} />}
              </For>
            </Box>
            <FormControl>
              <Switch
                checked={value().diskCacheEnabled}
                disabled={value().writeMode === "in-place"}
                onChange={() =>
                  update({ diskCacheEnabled: !value().diskCacheEnabled })
                }
              >
                {text().diskCache}
              </Switch>
              <Show when={value().writeMode === "in-place"}>
                <FormHelperText>{text().diskRequired}</FormHelperText>
              </Show>
            </FormControl>
            <Divider borderColor="rgba(255, 255, 255, 0.12)" />
            <Choice
              label={text().writeMode}
              value={value().writeMode}
              onChange={writeMode => update({ writeMode })}
              options={[
                { value: "temporary", label: text().temporary },
                {
                  value: "in-place",
                  label: text().inPlace,
                  disabled: !value().diskCacheEnabled,
                },
              ]}
            />
            <FormControl>
              <Switch
                checked={value().preserveState}
                onChange={() =>
                  update({ preserveState: !value().preserveState })
                }
              >
                {text().preserveState}
              </Switch>
              <FormHelperText>{text().preserveHelp}</FormHelperText>
            </FormControl>
            <Divider borderColor="rgba(255, 255, 255, 0.12)" />
            <Switch
              checked={value().debugLogging}
              onChange={() => update({ debugLogging: !value().debugLogging })}
            >
              {text().debugLogging}
            </Switch>
            <Text size="sm" color="rgba(255, 255, 255, 0.7)">
              {text().debugHelp}
            </Text>
          </VStack>
          <Show when={invalid() || error()}>
            <Text size="sm" color="$danger11" role="alert">
              {invalid() || error()}
            </Text>
          </Show>
          <HStack spacing="$3">
            <Button type="submit" disabled={!dirty() || Boolean(invalid())}>
              {saving() ? text().saving : props.locale.get("SETTING_SAVE")}
            </Button>
            <Button
              type="button"
              variant="subtle"
              onClick={() => update(sophonDefaults)}
            >
              {text().reset}
            </Button>
          </HStack>
          <Show when={saved()}>
            <Text size="sm" role="status">
              {text().saved}
            </Text>
          </Show>
        </VStack>
      </fieldset>
    </form>
  );
}
