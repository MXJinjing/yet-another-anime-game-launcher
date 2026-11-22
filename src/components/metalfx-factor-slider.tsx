import { Box, HStack, IconButton, Text, createIcon } from "@hope-ui/solid";
import { Locale } from "@locale";
import {
  METALFX_FACTOR_DEFAULT,
  METALFX_FACTOR_MAX,
  METALFX_FACTOR_MIN,
  METALFX_FACTOR_STEP,
} from "@config/metalfx-factor";

function createResetIcon() {
  return createIcon({
    viewBox: "0 0 24 24",
    path() {
      return (
        <path
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"
        />
      );
    },
  });
}

export function MetalFxFactorSlider(props: {
  locale: Locale;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  // Built here instead of at module scope so importing this file (for example
  // from a Node test that never renders it) does not need a DOM.
  const IconReset = createResetIcon();
  const range = `${METALFX_FACTOR_MIN.toFixed(1)}x–${METALFX_FACTOR_MAX.toFixed(
    1
  )}x`;

  return (
    <Box mt="$3">
      <HStack justifyContent="space-between" mb="$1">
        <Text fontSize="sm">
          {`${props.locale.get(
            "SETTING_METALFX_FACTOR"
          )}: ${props.value.toFixed(2)}x (${range})`}
        </Text>
        <IconButton
          size="xs"
          variant="ghost"
          disabled={props.value === METALFX_FACTOR_DEFAULT || props.disabled}
          aria-label={props.locale.get("SETTING_PREFERRED_MAX_FPS_RESET")}
          icon={<IconReset />}
          onClick={() => props.onChange(METALFX_FACTOR_DEFAULT)}
        />
      </HStack>
      <input
        type="range"
        min={METALFX_FACTOR_MIN}
        max={METALFX_FACTOR_MAX}
        step={METALFX_FACTOR_STEP}
        value={props.value}
        onInput={e => props.onChange(Number(e.currentTarget.value))}
        disabled={props.disabled}
        style={{ width: "100%" }}
      />
    </Box>
  );
}
