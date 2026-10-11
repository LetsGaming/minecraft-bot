import { computed, onBeforeUnmount, ref } from "vue";
import { ConfigApplyState, type ConfigStatusResponse } from "@mcbot/schema";
import { ApiError, apiGet } from "../api";
import { t } from "../i18n";

const POLL_MS = 5_000;

export interface ChipView {
  label: string;
  hint: string;
}

export function describeStatus(status: ConfigStatusResponse | null): ChipView {
  if (!status) return { label: t("applyView.unreadable"), hint: t("applyView.unreadableHint") };
  switch (status.state) {
    case ConfigApplyState.Applied:
      return { label: t("apply.applied"), hint: t("applyView.appliedHint") };
    case ConfigApplyState.Pending:
      return { label: t("apply.pending"), hint: t("applyView.pendingHint") };
    case ConfigApplyState.BotDown:
      return { label: t("applyView.botDown"), hint: t("applyView.botDownHint") };
    case ConfigApplyState.RestartRequired:
      return {
        label: t("apply.restartRequired"),
        hint: t("applyView.restartHint", { servers: status.restartRequired.join(", ") }),
      };
    default:
      return { label: t("apply.unknown"), hint: t("applyView.unknownHint") };
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
