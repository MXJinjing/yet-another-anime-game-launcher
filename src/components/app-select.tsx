import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { JSXElement } from "solid-js";
import "./app-select.css";

export type AppSelectOption = {
  value: string;
  label: JSXElement;
  color?: string;
  disabled?: boolean;
};

export function AppSelect(props: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  width?: number | string;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const selected = () =>
    props.options.find(option => option.value === props.value);

  function toggle() {
    if (!props.disabled) setOpen(open => !open);
  }

  function choose(option: AppSelectOption) {
    setOpen(false);
    if (option.value !== props.value) {
      props.onChange(option.value);
    }
  }

  function onDocumentPointerDown(event: PointerEvent) {
    if (
      rootRef &&
      event.target instanceof Node &&
      !rootRef.contains(event.target)
    ) {
      setOpen(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener("pointerdown", onDocumentPointerDown);
  });

  onCleanup(() => {
    document.removeEventListener("pointerdown", onDocumentPointerDown);
  });

  return (
    <div
      ref={rootRef}
      class="app-select"
      style={{
        width:
          typeof props.width === "number" ? `${props.width}px` : props.width,
      }}
      onKeyDown={onKeyDown}
    >
      <button
        id={props.id}
        type="button"
        class={`app-select-trigger${open() ? " app-select-trigger--open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={toggle}
      >
        <span class="app-select-value">
          <Show
            when={selected()?.color}
            fallback={selected()?.label ?? props.placeholder ?? ""}
          >
            {color => (
              <>
                <span
                  class="app-select-swatch"
                  style={{ background: color() }}
                />
                {selected()?.label}
              </>
            )}
          </Show>
        </span>
        <svg
          class="app-select-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="app-select-menu" role="listbox">
          <For each={props.options}>
            {option => (
              <button
                type="button"
                class={`app-select-option${
                  option.value === props.value
                    ? " app-select-option--selected"
                    : ""
                }`}
                role="option"
                aria-selected={option.value === props.value}
                disabled={option.disabled}
                onClick={() => choose(option)}
              >
                <Show when={option.color}>
                  <span
                    class="app-select-swatch"
                    style={{ background: option.color }}
                  />
                </Show>
                <span class="app-select-option-label">{option.label}</span>
                <Show when={option.value === props.value}>
                  <svg
                    class="app-select-check"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
