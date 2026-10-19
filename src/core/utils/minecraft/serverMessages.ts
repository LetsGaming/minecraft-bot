/**
 * The single way the bot talks to players through the console. Each helper
 * returns whether the message is believed to have reached the server, so a
 * caller that records "tip sent" or "cooldown used" can skip that step when
 * the server was not reached. The failure itself is already logged by
 * ServerInstance.send; callers that only want to speak can ignore the result.
 *
 * Every command is assembled by `consoleCommand`, which validates player
 * names, ids and numbers and strips control characters from free text, so a
 * line break in user input can never become a second console command.
 */
import { wasAccepted } from "@mcbot/schema/commandOutcome.js";
import type { ServerInstance } from "../server/server.js";
import { splitItem } from "@mcbot/schema/dailyRewards.js";
import { isValidMcName, stripControlChars } from "../sanitize.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";

type Sender = Pick<ServerInstance, "send">;

/** One argument of a console command, tagged with how it is validated. */
export type ConsoleArg =
  /** A player name (Java or Floodgate). */
  | { player: string }
  /** A selector (`@a`, `@p[distance=..5]`) or a player name. */
  | { target: string }
  /** A whole number. */
  | { count: number }
  /** A resource id such as `minecraft:bread` or `create:brass_ingot`. */
  | { id: string }
  /** An item id with an optional `[components]` or `{nbt}` suffix, as `/give` takes it. */
  | { item: string }
  /** Free text; control characters are removed. */
  | { text: string };

export class ConsoleArgumentError extends Error {}

const VERB = /^\/?[a-z][a-z_]*$/;
const SELECTOR = /^@[aeprs](\[[^[\]\r\n]*\])?$/;
const RESOURCE_ID = /^[a-z0-9_.-]+(:[a-z0-9_./-]+)?$/i;

function renderArg(arg: ConsoleArg): string {
  if ("player" in arg) {
    if (!isValidMcName(arg.player)) {
      throw new ConsoleArgumentError(`Not a valid player name: ${JSON.stringify(arg.player)}`);
    }
    return arg.player;
  }
  if ("target" in arg) {
    if (!SELECTOR.test(arg.target) && !isValidMcName(arg.target)) {
      throw new ConsoleArgumentError(`Not a valid target: ${JSON.stringify(arg.target)}`);
    }
    return arg.target;
  }
  if ("count" in arg) {
    if (!Number.isSafeInteger(arg.count)) {
      throw new ConsoleArgumentError(`Not a whole number: ${String(arg.count)}`);
    }
    return String(arg.count);
  }
  if ("id" in arg) {
    if (!RESOURCE_ID.test(arg.id)) {
      throw new ConsoleArgumentError(`Not a valid id: ${JSON.stringify(arg.id)}`);
    }
    return arg.id;
  }
  if ("item" in arg) {
    const { id, suffix } = splitItem(arg.item);
    if (!RESOURCE_ID.test(id)) {
      throw new ConsoleArgumentError(`Not a valid item: ${JSON.stringify(arg.item)}`);
    }
    return `${id}${stripControlChars(suffix)}`;
  }
  return stripControlChars(arg.text);
}

/**
 * Build a console command from a verb and validated arguments.
 *
 * The verb is written as the caller wants it sent (`give`, `/msg`). Throws
 * ConsoleArgumentError when an argument fails its check, so a bad value
 * cannot reach the server.
 */
export function consoleCommand(verb: string, ...args: ConsoleArg[]): string {
  if (!VERB.test(verb)) throw new ConsoleArgumentError(`Not a valid command: ${verb}`);
  return [verb, ...args.map(renderArg)].join(" ");
}

async function dispatch(server: Sender, build: () => string): Promise<boolean> {
  let command: string;
  try {
    command = build();
  } catch (err) {
    log.warn("serverMessages", `Refused to send a console command: ${errMsg(err)}`);
    return false;
  }
  return wasAccepted(await server.send(command));
}

/** Private message to one player (`/msg`). */
export function whisper(
  server: Sender,
  player: string,
  text: string,
): Promise<boolean> {
  return dispatch(server, () => consoleCommand("/msg", { player }, { text }));
}

/** Public chat line from the server (`/say`). */
export function announce(server: Sender, text: string): Promise<boolean> {
  return dispatch(server, () => consoleCommand("/say", { text }));
}

/** A JSON text component to a selector or player name (`/tellraw`). */
export function tellraw(
  server: Sender,
  target: string,
  component: unknown,
): Promise<boolean> {
  return dispatch(server, () =>
    consoleCommand("/tellraw", { target }, { text: JSON.stringify(component) }),
  );
}
