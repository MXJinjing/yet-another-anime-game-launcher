import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@hope-ui/solid";
import { createEffect, JSXElement } from "solid-js";
import type { JSX } from "solid-js";
import "./app-modal.css";
import "./app-modal-motion.css";

export type AppModalButtonVariant = "primary" | "secondary" | "danger";

export function AppModalButton(props: {
  variant?: AppModalButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: JSXElement;
}) {
  let ref: HTMLButtonElement | undefined;
  createEffect(() => {
    if (ref) ref.disabled = Boolean(props.disabled);
  });
  return (
    <button
      ref={el => {
        ref = el;
      }}
      class={`app-modal-button app-modal-button--${
        props.variant ?? "secondary"
      }`}
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function AppModal(props: {
  opened: boolean;
  onClose: () => void;
  title: JSXElement;
  children: JSXElement;
  footer?: JSXElement;
  maxWidth?: number | string;
  height?: number | string;
  bodyClass?: string;
}) {
  // NOTE: keep all reads through `props.*`. Destructuring a reactive prop
  // evaluates it once when the component is created, freezing dynamic content
  // such as modal titles, bodies, and footer buttons.
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      centered
      scrollBehavior="inside"
      closeOnOverlayClick={false}
      closeOnEsc={true}
      motionPreset="scale"
    >
      <ModalOverlay class="app-modal-overlay" />
      <ModalContent
        class="app-modal-content"
        style={
          {
            "--app-modal-max-width":
              typeof props.maxWidth === "number"
                ? `${props.maxWidth}px`
                : props.maxWidth ?? "460px",
            "--app-modal-height":
              typeof props.height === "number"
                ? `${props.height}px`
                : props.height ?? "auto",
          } as JSX.CSSProperties
        }
      >
        <ModalCloseButton class="app-modal-close" />
        <ModalHeader>{props.title}</ModalHeader>
        <ModalBody class={props.bodyClass}>{props.children}</ModalBody>
        {props.footer ? <ModalFooter>{props.footer}</ModalFooter> : null}
      </ModalContent>
    </Modal>
  );
}
