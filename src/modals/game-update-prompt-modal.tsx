import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@hope-ui/solid";
import { Show, type Accessor } from "solid-js";
import type { Locale } from "../locale";

export function GameUpdatePromptModal<T>(props: {
  game: Accessor<T | undefined>;
  locale: Locale;
  onClose: () => void;
  onConfirm: (game: T) => void;
}) {
  return (
    <Modal
      opened={!!props.game()}
      onClose={props.onClose}
      scrollBehavior="inside"
    >
      <ModalOverlay />
      <Show when={props.game()}>
        <ModalContent>
          <ModalHeader>
            {props.locale.get("SETTING_GAME_UPDATE_AVAILABLE")}
          </ModalHeader>
          <ModalBody>
            <Text style={{ "white-space": "pre-wrap" }}>
              {props.locale.get("SETTING_GAME_UPDATE_AVAILABLE_DESC")}
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="$3" onClick={props.onClose}>
              {props.locale.get("SETTING_CANCEL_INSTALL")}
            </Button>
            <Button onClick={() => props.onConfirm(props.game()!)}>
              {props.locale.get("SETTING_CONFIRM_INSTALL")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Show>
    </Modal>
  );
}
