import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Switch,
  Text,
} from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import "./setting-switch.css";

export function SettingSwitch(props: {
  id?: string;
  label: string;
  description?: JSXElement;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  control?: JSXElement;
  children?: JSXElement;
}) {
  return (
    <FormControl id={props.id} class="setting-switch">
      <HStack
        class="setting-switch-row"
        justifyContent="space-between"
        alignItems="center"
        spacing="$5"
      >
        <Box flex={1}>
          <FormLabel class="setting-switch-label">{props.label}</FormLabel>
          {props.description ? (
            <Text class="setting-switch-description">{props.description}</Text>
          ) : null}
        </Box>
        <div class="setting-switch-controls">
          {props.control}
          <Switch
            checked={props.checked}
            disabled={props.disabled}
            aria-label={props.label}
            size="lg"
            onChange={(e: Event) =>
              props.onChange((e.currentTarget as HTMLInputElement).checked)
            }
          />
        </div>
      </HStack>
      {props.children}
    </FormControl>
  );
}
