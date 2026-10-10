import { computed, onBeforeUnmount, ref } from "vue";
import { ConfigApplyState, type ConfigStatusResponse } from "@mcbot/schema";
import { ApiError, apiGet } from "../api";

const POLL_MS = 5_000;

export interface ChipView {
  label: string;
  hint: string;
  severity: "success" | "info" | "warn" | "secondary";
  icon: string;
}

export function describeStatus(status: ConfigStatusResponse | null): ChipView {
  if (!status) {
    return { label: "Status unknown", hint: "Could not read the applied-config status.", severity: "secondary", icon: "pi pi-question-circle" };
  }
  switch (status.state) {
    case ConfigApplyState.Applied:
      return { label: "Applied", hint: "The running bot has loaded this config.", severity: "success", icon: "pi pi-check-circle" };
    case ConfigApplyState.Pending:
      return { label: "Pending", hint: "Saved. Waiting for the bot to load it.", severity: "info", icon: "pi pi-spin pi-spinner" };
    case ConfigApplyState.BotDown:
      return { label: "Bot not running", hint: "Saved. It takes effect when the bot starts.", severity: "warn", icon: "pi pi-power-off" };
    case ConfigApplyState.RestartRequired:
      return {
        label: "Restart required",
        hint: `Applied, but connection settings for ${status.restartRequired.join(", ")} only take effect after a bot restart.`,
        severity: "warn",
        icon: "pi pi-refresh",
      };
    default:
      return { label: "Status unavailable", hint: "The running bot does not report which config it applied.", severity: "secondary", icon: "pi pi-question-circle" };
  }
}

/** Polls whether the bot has applied the config on disk while a view is open. */
export function useConfigStatus() {
  const status = ref<ConfigStatusResponse | null>(null);
  /** Guild managers cannot read the file-level status; the chip then stays hidden. */
  const forbidden = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      status.value = await apiGet<ConfigStatusResponse>("/api/config/status");
    } catch (err) {
      status.value = null;
      if (err instanceof ApiError && err.status === 403) {
        forbidden.value = true;
        stop();
      }
    }
  }

  function start(): void {
    if (timer) return;
    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  onBeforeUnmount(stop);

  return { status, forbidden, view: computed(() => describeStatus(status.value)), refresh, start, stop };
}
