import { Text, VStack } from "@hope-ui/solid";
import { createSignal, For, Show } from "solid-js";
import type { Locale } from "@locale";
import type { WineDistribution } from "@wine";
import { AppModal, AppModalButton } from "../components/app-modal";

export function InitialWineSetupModal(props: {
  locale: Locale;
  recommended: WineDistribution;
  defaultDistro: WineDistribution;
  distributions: WineDistribution[];
  onClose: () => void;
  onConfirm: (distro: WineDistribution, useRecommended: boolean) => void;
}) {
  const [custom, setCustom] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal(props.defaultDistro.id);
  const selected = () =>
    props.distributions.find(distro => distro.id === selectedId());
  const { locale } = props;
  return (
    <AppModal
      opened
      onClose={props.onClose}
      title={locale.get("INIT_ENVIRONMENT_TITLE")}
      maxWidth={560}
      footer={
        <>
          <AppModalButton onClick={props.onClose}>
            {locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <Show
            when={custom()}
            fallback={
              <>
                <AppModalButton onClick={() => setCustom(true)}>
                  {locale.get("INIT_ENVIRONMENT_CUSTOM_WINE")}
                </AppModalButton>
                <AppModalButton
                  variant="primary"
                  onClick={() => props.onConfirm(props.recommended, true)}
                >
                  {locale.get("INIT_ENVIRONMENT_USE_RECOMMENDED")}
                </AppModalButton>
              </>
            }
          >
            <AppModalButton
              variant="primary"
              disabled={!selected()}
              onClick={() => {
                const distro = selected();
                if (distro) props.onConfirm(distro, false);
              }}
            >
              {locale.get("SETTING_WINE_INSTALL")}
            </AppModalButton>
          </Show>
        </>
      }
    >
      <VStack spacing="$3" alignItems="stretch">
        <Text>{locale.get("INIT_ENVIRONMENT_DESC")}</Text>
        <Show
          when={custom()}
          fallback={
            <Text>
              {locale.format("INIT_ENVIRONMENT_CONFIRM_DESC", [
                props.recommended.displayName,
              ])}
            </Text>
          }
        >
          <label for="initial-wine-distro">
            {locale.get("INIT_ENVIRONMENT_WINE_VERSION")}
          </label>
          {/* The native menu opens outside the modal's scrollable body. */}
          <select
            id="initial-wine-distro"
            class="initial-wine-distro-select"
            onChange={event => setSelectedId(event.currentTarget.value)}
          >
            <For each={props.distributions}>
              {distro => (
                <option value={distro.id} selected={distro.id === selectedId()}>
                  {distro.displayName}
                </option>
              )}
            </For>
          </select>
        </Show>
      </VStack>
    </AppModal>
  );
}
