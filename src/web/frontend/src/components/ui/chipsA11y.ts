/**
 * Pass-through for PrimeVue InputChips. It renders the chips as a listbox of
 * options with the text box inside one more option, which axe reports as an
 * unnamed listbox with an interactive control nested in an option. Read as a
 * plain list of entries plus the box to type the next one, nothing is nested.
 */
export const CHIPS_PT = {
  input: { role: "list", "aria-orientation": null },
  chipItem: { role: "listitem", "aria-selected": null },
  inputItem: { role: "listitem" },
} as const;
