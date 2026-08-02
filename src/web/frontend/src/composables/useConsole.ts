import { ref, computed, onUnmounted } from "vue";
import { apiGet, apiSend } from "../api";
import { errorMessage } from "../utils/errorMessage";
import {
  isBlockedConsoleCommand,
  MAX_CONSOLE_COMMAND_LENGTH,
} from "@mcbot/schema/consoleCommands.js";

/**
 * DSH-01 — the live console: a relayed log stream plus a command input.
 *
 * Per-view state, not module-level: two people could reasonably watch two
 * servers, and a shared singleton would make the second one hijack the first.
 * (Contrast useGuilds, which caches a fetch every view wants the same answer
 * from.)
 */

/** What the backend writes on the stream. Mirrors ConsoleEvent. */
type ConsoleEvent =
  | { type: "line"; line: string }
  | { type: "state"; connected: boolean; detail?: string };

/**
 * How many lines the pane keeps.
 *
 * A busy modded server writes thousands of lines an hour, and every one of
 * them is a DOM node if nothing caps it — leave the tab open over lunch and
 * the page is unusable. Oldest out, and the server's log file is still the
 * place to go for history.
 */
const MAX_LINES = 2000;

export interface ConsoleLine {
  /** Monotonic, so v-for has a stable key even for two identical lines. */
  id: number;
  text: string;
}

export function useConsole() {
  const lines = ref<ConsoleLine[]>([]);
  const connected = ref(false);
  const statusDetail = ref("");
  const error = ref("");
  const sending = ref(false);
  const command = ref("");
  const blockedCommands = ref<string[]>([]);
  /**
   * Sticky auto-scroll: follows the tail until the reader scrolls up, then
   * stays where they left it. Carried over from the old manager's log pane,
   * where it was the difference between a usable console and one that yanks
   * the line you are reading off the screen.
   */
  const autoScroll = ref(true);

  let source: EventSource | null = null;
  let serverId = "";
  let nextId = 0;

  function push(text: string): void {
    lines.value.push({ id: nextId++, text });
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  }

  /** Would the backend refuse this? Checked with the backend's own rule. */
  const commandBlocked = computed(
    () =>
      command.value.trim().length > 0 &&
      isBlockedConsoleCommand(command.value, blockedCommands.value),
  );

  const canSend = computed(
    () =>
      !sending.value &&
      command.value.trim().length > 0 &&
      command.value.length <= MAX_CONSOLE_COMMAND_LENGTH &&
      !commandBlocked.value,
  );

  async function open(id: string): Promise<void> {
    close();
    serverId = id;
    lines.value = [];
    error.value = "";

    try {
      const policy = await apiGet<{ blockedCommands: string[] }>(
        `/api/servers/${encodeURIComponent(id)}/console/policy`,
      );
      blockedCommands.value = policy.blockedCommands;
    } catch {
      // A missing policy must not stop the stream: the backend enforces the
      // list regardless, so the only loss is the greyed-out hint.
      blockedCommands.value = [];
    }

    // No token in the URL: EventSource sends the session cookie on a
    // same-origin request, which is why this needs no ticket endpoint.
    source = new EventSource(
      `/api/servers/${encodeURIComponent(id)}/console/stream`,
    );

    source.onmessage = (ev: MessageEvent<string>) => {
      let event: ConsoleEvent;
      try {
        event = JSON.parse(ev.data) as ConsoleEvent;
      } catch {
        return;
      }
      if (event.type === "line") {
        push(event.line);
      } else {
        connected.value = event.connected;
        statusDetail.value = event.detail ?? "";
      }
    };

    source.onerror = () => {
      // EventSource reconnects on its own; say so rather than looking dead.
      connected.value = false;
      statusDetail.value = "Reconnecting…";
    };
  }

  function close(): void {
    source?.close();
    source = null;
    connected.value = false;
    statusDetail.value = "";
  }

  async function send(): Promise<void> {
    if (!canSend.value) return;
    const text = command.value.trim();
    sending.value = true;
    error.value = "";
    try {
      const res = await apiSend<{ output: string }>(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}/command`,
        { command: text },
      );
      // Echo locally so the input feels like a terminal. The log stream will
      // carry the server's own record of it a moment later; a command with no
      // RCON output would otherwise vanish without a trace.
      push(`> ${text}`);
      if (res.output) push(res.output);
      command.value = "";
    } catch (err) {
      error.value = errorMessage(err);
    } finally {
      sending.value = false;
    }
  }

  onUnmounted(close);

  return {
    lines,
    connected,
    statusDetail,
    error,
    sending,
    command,
    autoScroll,
    blockedCommands,
    commandBlocked,
    canSend,
    maxLength: MAX_CONSOLE_COMMAND_LENGTH,
    open,
    close,
    send,
  };
}
