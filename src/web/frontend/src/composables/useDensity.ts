import { ref, readonly } from "vue";

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

const STORAGE_KEY = "mcbot.density.v1";
const DEFAULT_DENSITY: Density = "comfortable";

const current = ref<Density>(DEFAULT_DENSITY);

export function isDensity(value: unknown): value is Density {
  return DENSITIES.includes(value as Density);
}

function readStored(): Density {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isDensity(raw) ? raw : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

function writeStored(value: Density): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage disabled: the choice lasts for this page load only. */
  }
}

function applyToDocument(value: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = value;
}

/** Reads the stored choice and applies it. Call once before the app mounts. */
export function initDensity(): void {
  current.value = readStored();
  applyToDocument(current.value);
}

export function useDensity() {
  function setDensity(value: Density): void {
    current.value = value;
    writeStored(value);
    applyToDocument(value);
  }

  function toggleDensity(): void {
    setDensity(current.value === "compact" ? "comfortable" : "compact");
  }

  return { density: readonly(current), setDensity, toggleDensity };
}
