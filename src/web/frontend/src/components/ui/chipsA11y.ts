/**
 * Pass-through for a multiple AutoComplete used as a free-text chips box
 * (typeahead off). PrimeVue still renders it as a combobox over a listbox of
 * options with the text box inside one more option, which axe reports as an
 * interactive control nested in an option, and the combobox points at a popup
 * that never opens. Read as a plain list of entries plus the box to type the
 * next one, nothing is nested and the box is an ordinary text input.
 */
export interface ChipsInputPtOptions {
  describedby?: string;
  onKeydown?: (event: KeyboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => void;
}

export function chipsInputPt(options: ChipsInputPtOptions = {}) {
  return {
    inputMultiple: { role: "list", "aria-orientation": null, "aria-activedescendant": null },
    chipItem: {
      role: "listitem",
      "aria-label": null,
      "aria-selected": null,
      "aria-setsize": null,
      "aria-posinset": null,
    },
    inputChip: { role: "listitem" },
    input: {
      role: null,
      "aria-haspopup": null,
      "aria-autocomplete": null,
      "aria-expanded": null,
      "aria-controls": null,
      "aria-activedescendant": null,
      "aria-describedby": options.describedby,
      onKeydown: options.onKeydown,
      onPaste: options.onPaste,
    },
  };
}

/** Splits typed or pasted text into trimmed, non-empty entries. */
export function splitEntries(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
