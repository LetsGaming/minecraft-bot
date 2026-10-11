import { ref } from "vue";
import { useToast } from "primevue/usetoast";
import {
  isDisruptiveServerAction,
  isIrreversibleServerAction,
  type ServerOperatorAction,
} from "@mcbot/schema/serverActions.js";
import { apiSend } from "../api";
import type { ServerStatus } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { t } from "../i18n";
import { useConfirmAction, type ConfirmActionOptions } from "./useConfirmAction";

export interface ServerActionJob {
  action: ServerOperatorAction;
  state: "running" | "failed";
  startedAt: number;
  exitCode: number | null | undefined;
  output: string;
  note: string;
}

interface ScriptResponse {
  ok: boolean;
  exitCode: number | null;
  output?: string;
  stderr?: string;
}

function scriptOutput(res: ScriptResponse): string {
  return [res.output ?? "", res.stderr ?? ""]
    .filter((part) => part.trim() !== "")
    .join("\n")
    .replace(/\r\n?/g, "\n");
}

/** What the confirm says for an action, or null when it runs without one. */
export function confirmOptions(
  server: ServerStatus,
  action: ServerOperatorAction,
): ConfirmActionOptions | null {
  const id = server.id;
  if (isIrreversibleServerAction(action)) {
    return {
      level: "irreversible",
      tone: "danger",
      header: t("servers.confirm.rollbackHeader", { server: id }),
      message: t("servers.confirm.rollbackMessage", { server: id }),
      acceptLabel: t("servers.confirm.rollbackAccept", { server: id }),
      expected: id,
      facts: [
        { term: t("servers.confirm.factApplies"), detail: t("servers.confirm.rollbackApplies", { server: id }) },
        { term: t("servers.confirm.factRecover"), detail: t("servers.confirm.rollbackRecover") },
      ],
    };
  }
  if (!isDisruptiveServerAction(action) || (action !== "stop" && action !== "restart")) return null;
  const players = server.players;
  const message = !players
    ? t(`servers.confirm.${action}Unknown`)
    : players.online === 0
      ? t(`servers.confirm.${action}Empty`)
      : t(`servers.confirm.${action}Players`, { count: players.online });
  return {
    level: "disruptive",
    tone: action === "stop" ? "danger" : "warn",
    header: t(`servers.confirm.${action}Header`, { server: id }),
    message,
    acceptLabel: t(`servers.confirm.${action}Accept`, { server: id }),
    facts: [
      { term: t("servers.confirm.factApplies"), detail: t("servers.confirm.applyNow") },
      { term: t("servers.confirm.factRecover"), detail: t(`servers.confirm.${action}Recover`, { server: id }) },
    ],
  };
}

/**
 * Server operations for the Servers view: confirm at the level the action
 * needs, run it, and keep a job per server while the script runs or after it
 * failed. A finished action is a toast; a failed one stays on the card with
 * its exit code and output until it is dismissed or retried.
 */
export function useServerActions(afterAction: () => Promise<unknown>) {
  const toast = useToast();
  const confirmAction = useConfirmAction();
  const jobs = ref<Record<string, ServerActionJob>>({});

  function isRunning(serverId: string): boolean {
    return jobs.value[serverId]?.state === "running";
  }

  function dismiss(serverId: string): void {
    const next = { ...jobs.value };
    delete next[serverId];
    jobs.value = next;
  }

  function setJob(serverId: string, job: ServerActionJob): void {
    jobs.value = { ...jobs.value, [serverId]: job };
  }

  async function runAction(server: ServerStatus, action: ServerOperatorAction): Promise<void> {
    const id = server.id;
    if (isRunning(id)) return;
    const options = confirmOptions(server, action);
    if (options && (await confirmAction(options)) !== "confirm") return;

    const startedAt = Date.now();
    setJob(id, {
      action,
      state: "running",
      startedAt,
      exitCode: undefined,
      output: "",
      note: t("servers.job.runningNote"),
    });
    try {
      const res = await apiSend<ScriptResponse>(
        "POST",
        `/api/servers/${encodeURIComponent(id)}/${action}`,
      );
      if (res.ok) {
        dismiss(id);
        toast.add({
          severity: "success",
          summary: t(`servers.done.${action}`, { server: id }),
          detail: t(`servers.doneDetail.${action}`, { server: id }),
          life: 5000,
        });
      } else {
        setJob(id, {
          action,
          state: "failed",
          startedAt,
          exitCode: res.exitCode,
          output: scriptOutput(res),
          note: t("servers.job.failedNote"),
        });
      }
    } catch (err) {
      setJob(id, {
        action,
        state: "failed",
        startedAt,
        exitCode: undefined,
        output: "",
        note: t("servers.job.requestFailed", { message: errorMessage(err) }),
      });
    }
    await afterAction();
  }

  return { jobs, isRunning, runAction, dismiss };
}
