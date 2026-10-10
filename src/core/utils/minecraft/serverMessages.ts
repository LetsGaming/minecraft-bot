/**
 * The single way the bot talks to players through the console. Each helper
 * returns whether the message is believed to have reached the server, so a
 * caller that records "tip sent" or "cooldown used" can skip that step when
 * the server was not reached. The failure itself is already logged by
 * ServerInstance.send; callers that only want to speak can ignore the result.
 */
import { wasAccepted } from "@mcbot/schema/commandOutcome.js";
import type { ServerInstance } from "../server/server.js";

type Sender = Pick<ServerInstance, "send">;

async function dispatch(server: Sender, command: string): Promise<boolean> {
  return wasAccepted(await server.send(command));
}

/** Private message to one player (`/msg`). */
export function whisper(
  server: Sender,
  player: string,
  text: string,
): Promise<boolean> {
  return dispatch(server, `/msg ${player} ${text}`);
}

/** Public chat line from the server (`/say`). */
export function announce(server: Sender, text: string): Promise<boolean> {
  return dispatch(server, `/say ${text}`);
}

/** A JSON text component to a selector or player name (`/tellraw`). */
export function tellraw(
  server: Sender,
  target: string,
  component: unknown,
): Promise<boolean> {
  return dispatch(server, `/tellraw ${target} ${JSON.stringify(component)}`);
}
