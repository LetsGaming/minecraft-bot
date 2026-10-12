# Checking mods against another Minecraft version

The dashboard's Mods page can tell you which of the installed mods already have
a release for a Minecraft version you are thinking of moving to. It only
checks and reports. Moving a server to a new version is a manual operation
that this feature does not perform.

You need the `mods:read` capability on the server (see
[admin/capabilities.md](../admin/capabilities.md)). The control is hidden when
the server's API wrapper is too old to run the check; the normal "Look for
updates" button keeps working in that case.

## How to use it

1. Open the Mods page. The check sits at the top of the **Installed** card.
2. Pick a **Target Minecraft version**. The version the server runs now comes
   first, followed by released Minecraft versions. If the list could not be
   loaded, or you want a snapshot or an unusual version, choose **Type a
   version** and enter it (for example `1.21.5`; letters, digits, `.`, `_` and
   `-`, up to 20 characters).
3. Press **Check N mods for &lt;version&gt;**. A progress block shows "Checking 14
   of 62" with a bar while the server's wrapper asks Modrinth about each
   installed mod, and the rows fill in as answers arrive. The check cannot be
   cancelled; it ends on its own. You can leave the page; the page stops polling
   while hidden and picks up when you return.

The address keeps the check and the filter
(`#/mods/<server>?check=1.21.5&filter=blockers`), so a link opens the same
result.

## Reading the result

A summary shows three counts (Ready, No build, Unknown), the icons of the mods
blocking the upgrade, and a verdict: "Do not upgrade yet" while anything blocks,
"Ready to upgrade" when nothing does. **Copy blocker list** copies the blocking
mods' names. The results table lists No build first, then Unknown, then Ready.

| Status | Meaning |
|---|---|
| Ready | Modrinth has a release for that Minecraft version and your loader. The detail names the build. |
| No build | Modrinth has no release for that version and loader. This mod blocks the move. **Open project** links to its Modrinth page. |
| Unknown | The check could not decide, for example Modrinth was unreachable or the file is not on Modrinth. The reason is shown. It counts as a blocker, because an unknown answer is not safe to upgrade on. |

The **Blockers** filter (No build plus Unknown) is on after a check; **All**
and **Ready** show the rest. Results are remembered for about six hours;
**Check again** asks Modrinth again. Installing, removing, updating or toggling
a mod marks the result as out of date and clears the saved answer on the
wrapper. **Back to the installed list** closes the result.

## When something looks wrong

- A failed check shows its error in the progress block with **Check again**,
  also when it cannot start or has expired (finished checks are kept for about
  15 minutes on the wrapper). Nothing on the server changes.
- An error saying you already have a check running (409) or that the server, your guild or the dashboard is at its limit (429) comes from the limits in [`compatGuard.ts`](../../src/web/backend/routes/compatGuard.ts) apply: one check per person and server at a time, a few at once per guild and per server, and a refresh for a server at most every 30 seconds. Wait for the running check to finish, or until the 30 seconds have passed. These limits are held in the dashboard process, so a dashboard restart clears them.
- "unknown" for many mods at once usually means Modrinth is rate limiting or
  unreachable from the Minecraft host. Wait a minute and check again.
