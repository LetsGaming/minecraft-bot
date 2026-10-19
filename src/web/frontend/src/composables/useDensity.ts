import { ref, readonly } from "vue";
import { safeStorage } from "../utils/safeStorage";

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

const STORAGE_KEY = "mcbot.density.v1";
const DEFAULT_DENSITY: Density = "comfortable";

const current = ref<Density>(DEFAULT_DENSITY);

export function isDensity(value: unknown): value is Density {
  return DENSITIES.includes(value as Density);
}

function readStored(): Density {
  const raw = safeStorage.get(STORAGE_KEY);
  return isDensity(raw) ? raw : DEFAULT_DENSITY;
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
    safeStorage.set(STORAGE_KEY, value);
    applyToDocument(value);
  }

  function toggleDensity(): void {
    setDensity(current.value === "compact" ? "comfortable" : "compact");
  }

  return { density: readonly(current), setDensity, toggleDensity };
}
