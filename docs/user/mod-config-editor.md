# Editing mod settings in the dashboard

Open **Mod Config**, pick a server, and find the file in the list on the left. Files are grouped by mod and then by folder. Click a mod to collapse or open it. Hover a file name to see its full path.

- **Filter** the list by file name or mod, and the open file by setting name. It does not search inside files you have not opened.
- **Settings** appear in sections. Large files start collapsed, and only the first 200 settings are drawn until you press **Show more**.
- **View source** shows the file's text, read-only.
- Files with no editor (for example waypoint lists) and files that could not be read cleanly open as read-only text. Files over 1 MB are listed as "too large".
- If a warning says some files are missing, the server has more than 2000 config files. Use the filter.

Press **Save** to write your changes. Most mods only read their config when the server starts, so restart for them to apply. **History** lists the last saves of a file and can put one back.

If a save is refused, the message says why. The usual reason is that the file changed while you had it open: reload and make the change again.

Details on formats and limits: [admin/mod-configs.md](../admin/mod-configs.md).
