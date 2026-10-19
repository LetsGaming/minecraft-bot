export interface PageVisibility {
  isHidden(): boolean;
  /** Calls `cb` whenever the page becomes visible. Returns the unsubscribe. */
  onVisible(cb: () => void): () => void;
}

export const browserVisibility: PageVisibility = {
  isHidden: () => typeof document !== "undefined" && document.hidden,
  onVisible(cb) {
    if (typeof document === "undefined") return () => undefined;
    const handler = () => {
      if (!document.hidden) cb();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};
