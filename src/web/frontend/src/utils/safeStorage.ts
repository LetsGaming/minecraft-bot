/**
 * localStorage that never throws. Storage can be missing, full or blocked
 * (private windows, cleared site data); every caller treats it as a
 * convenience, so a failed read is "nothing stored" and a failed write is
 * dropped.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The value lasts for this page load only.
    }
  },
};
