import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import type { JSX } from "solid-js";
import "./app-modal.css";

export type AppModalButtonVariant = "primary" | "secondary" | "danger";

export function AppModalButton({
  variant = "secondary",
  disabled,
  onClick,
  children,
}: {
  variant?: AppModalButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: JSXElement;
}) {
  return (
    <button
      class={`app-modal-button app-modal-button--${variant}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function AppModal({
  opened,
  onClose,
  title,
  children,
  footer,
  maxWidth = 460,
  height,
  bodyClass,
}: {
  opened: boolean;
  onClose: () => void;
  title: JSXElement;
  children: JSXElement;
  footer?: JSXElement;
  maxWidth?: number | string;
  height?: number | string;
  bodyClass?: string;
}) {
  return (
    <Modal opened={opened} onClose={onClose} centered scrollBehavior="inside">
      <ModalOverlay class="app-modal-overlay" />
      <ModalContent
        class="app-modal-content"
        style={
          {
            "--app-modal-max-width":
              typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
            "--app-modal-height":
              typeof height === "number" ? `${height}px` : height ?? "auto",
          } as JSX.CSSProperties
        }
      >
        <ModalCloseButton class="app-modal-close" />
        <ModalHeader>{title}</ModalHeader>
        <ModalBody class={bodyClass}>{children}</ModalBody>
        {footer ? <ModalFooter>{footer}</ModalFooter> : null}
      </ModalContent>
    </Modal>
  );
}
