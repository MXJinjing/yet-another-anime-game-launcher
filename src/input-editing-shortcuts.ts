const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

type EditableInput = HTMLInputElement | HTMLTextAreaElement;

function getEditableInput(target: EventTarget | null): EditableInput | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (!(target instanceof HTMLInputElement)) return null;
  return NON_TEXT_INPUT_TYPES.has(target.type) ? null : target;
}

function getSelection(input: EditableInput) {
  try {
    return {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? input.value.length,
    };
  } catch {
    // Some input types (notably number) do not expose selection ranges.
    return { start: 0, end: input.value.length };
  }
}

function replaceSelection(
  input: EditableInput,
  value: string,
  selection = getSelection(input)
) {
  const { start, end } = selection;

  try {
    input.setRangeText(value, start, end, "end");
  } catch {
    // Number-like inputs cannot use setRangeText. Replacing the whole value
    // still gives the expected result after Command+A, which is the common
    // editing flow for these settings fields.
    input.value = value;
  }

  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertFromPaste",
    })
  );
}

/**
 * Provides macOS editing shortcuts in Neutralino's WebView, where the native
 * Edit menu selectors are not always installed for HTML form controls.
 */
export function installInputEditingShortcuts() {
  const onKeyDown = (event: KeyboardEvent) => {
    if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;

    const input = getEditableInput(event.target);
    if (!input || input.disabled) return;

    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      input.select();
      return;
    }

    if (key === "c" || key === "x") {
      const { start, end } = getSelection(input);
      if (start === end) return;

      event.preventDefault();
      void Neutralino.clipboard
        .writeText(input.value.slice(start, end))
        .catch(error => console.error("Failed to copy input text", error));

      if (key === "x" && !input.readOnly) replaceSelection(input, "");
      return;
    }

    if (key === "v" && !input.readOnly) {
      event.preventDefault();
      const selection = getSelection(input);
      void Neutralino.clipboard
        .readText()
        .then(value => {
          if (document.activeElement === input) {
            replaceSelection(input, value, selection);
          }
        })
        .catch(error => console.error("Failed to paste input text", error));
    }
  };

  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}
