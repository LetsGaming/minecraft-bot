/**
 * Time formatting for the dashboard.
 *
 * The relative/absolute formatters were moved into `@mcbot/core` so the bot
 * and the UI can share one implementation — a Discord embed and a web card
 * must not describe the same instant differently. They are re-exported here so
 * the many view imports of `../utils/time` keep working unchanged.
 */
export {
  parseStamp,
  absoluteStamp,
  relativeAge,
  timestampTitle,
  type Timestamp,
} from "@mcbot/core/utils/relativeTime.js";
