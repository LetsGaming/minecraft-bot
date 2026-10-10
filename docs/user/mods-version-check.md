# Checking mods against another Minecraft version

The dashboard's Mods tab can tell you which of the installed mods already have
a release for a Minecraft version you are thinking of moving to. It only
checks and reports. Moving a server to a new version is a manual operation
that this feature does not perform.

You need the `mods:read` capability on the server (see
[admin/capabilities.md](../admin/capabilities.md)). The control is hidden when
the server's API wrapper is too old to run the check; the normal "Check for
updates" button keeps working in that case.

## How to use it

1. Open the Mods tab and find the **Check another Minecraft version** panel.
2. Pick a version. The version the server runs now comes first, followed by
   released Minecraft versions. If the list could not be loaded, or you want a
   snapshot or an unusual version, choose **Type a version** and enter it (for
   example `1.21.5`; letters, digits, `.`, `_` and `-`, up to 20 characters).
3. Press **Check**. The panel shows progress such as "Checking 14 of 62" while
   the server's wrapper asks Modrinth about each installed mod. You can leave
   the tab; the page stops polling while hidden and picks up when you return.

## Reading the result

The stats row gains a line such as "48 ready, 9 missing, 5 unknown", and the
installed list gains a column for the version you checked.

| Badge | Meaning |
|---|---|
| ready | Modrinth has a release for that Minecraft version and your loader. |
| missing | Modrinth has no release for that version and loader. This mod blocks the move. |
| unknown | The check could not decide, for example Modrinth was unreachable or the mod's entry is invalid. The reason is shown. Try **Check again**. |

Click a badge to see details: the release that would be used (name, date and a
download link) for a ready mod, or the reason for the others.

**Only blockers** hides every mod that is ready, so you see what stands in
the way. Results are remembered for about six hours; **Check again** asks
Modrinth again. Installing, removing, updating or toggling a mod marks the
result as out of date and clears the saved answer on the wrapper.

## When something looks wrong

- An error toast appears when a check cannot start, fails, or expires (finished
  checks are kept for about 15 minutes on the wrapper).
- A toast saying you already have a check running (409) or that the server, your guild or the dashboard is at its limit (429) comes from the limits in [`compatGuard.ts`](../../src/web/backend/routes/compatGuard.ts) apply: one check per person and server at a time, a few at once per guild and per server, and a refresh for a server at most every 30 seconds. Wait for the running check to finish, or until the 30 seconds have passed. These limits are held in the dashboard process, so a dashboard restart clears them.
- "unknown" for many mods at once usually means Modrinth is rate limiting or
  unreachable from the Minecraft host. Wait a minute and check again.
