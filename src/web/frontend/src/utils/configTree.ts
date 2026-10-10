/**
 * Pure helpers for laying out the mod config editor: where a file sits under
 * its mod, and how a file's fields split into sections.
 */

/** Roots the wrapper lists files under; the segment(s) after one are the mod's own. */
const ROOTS = ["world/serverconfig", "defaultconfigs", "config", "plugins"];

export interface FileLike {
  id: string;
  relPath: string;
  modId: string;
}

export interface FolderGroup<F extends FileLike> {
  /** Folder below the mod, `""` for files directly in the mod's folder or root. */
  folder: string;
  entries: F[];
}

export interface ModGroup<F extends FileLike> {
  modId: string;
  folders: FolderGroup<F>[];
  count: number;
}

/** The path segments between the config root (and the mod's own folder) and the file name. */
export function locate(relPath: string, modId: string): { folder: string; name: string } {
  const root = ROOTS.find((r) => relPath.startsWith(`${r}/`));
  const rest = (root ? relPath.slice(root.length + 1) : relPath).split("/");
  const name = rest.pop() ?? relPath;
  if (rest.length > 0 && rest[0] === modId) rest.shift();
  return { folder: rest.join("/"), name };
}

/** The path as shown in the list: relative to the mod it is grouped under. */
export function displayPath(relPath: string, modId: string): string {
  const { folder, name } = locate(relPath, modId);
  return folder ? `${folder}/${name}` : name;
}

/** Group files by mod, then by folder, keeping the order the wrapper sent. */
export function groupFiles<F extends FileLike>(files: readonly F[]): ModGroup<F>[] {
  const mods = new Map<string, Map<string, F[]>>();
  for (const file of files) {
    const folders = mods.get(file.modId) ?? new Map<string, F[]>();
    const { folder } = locate(file.relPath, file.modId);
    const list = folders.get(folder) ?? [];
    list.push(file);
    folders.set(folder, list);
    mods.set(file.modId, folders);
  }
  return [...mods.entries()].map(([modId, folders]) => {
    const list = [...folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, entries]) => ({ folder, entries }));
    return { modId, folders: list, count: list.reduce((n, f) => n + f.entries.length, 0) };
  });
}

export interface FieldLike {
  path: string[];
}

export interface FieldSection<T extends FieldLike> {
  id: string;
  title: string;
  fields: T[];
}

/** Stable identity of a field's path; a joined string would collide on `a.b` + `c` versus `a` + `b.c`. */
export const pathKey = (path: string[]): string => JSON.stringify(path);

/** Split fields into sections by their parent path, in file order. */
export function sectionsOf<T extends FieldLike>(fields: readonly T[]): FieldSection<T>[] {
  const out = new Map<string, FieldSection<T>>();
  for (const field of fields) {
    const parent = field.path.slice(0, -1);
    const id = pathKey(parent);
    const section = out.get(id) ?? {
      id,
      title: parent.length === 0 ? "General" : parent.join(" › "),
      fields: [],
    };
    section.fields.push(field);
    out.set(id, section);
  }
  return [...out.values()];
}

/** Keep at most `limit` fields across the sections, in order. */
export function limitSections<T extends FieldLike>(
  sections: readonly FieldSection<T>[],
  limit: number,
): { sections: FieldSection<T>[]; hidden: number } {
  let left = limit;
  let hidden = 0;
  const kept: FieldSection<T>[] = [];
  for (const section of sections) {
    if (left <= 0) {
      hidden += section.fields.length;
      continue;
    }
    const fields = section.fields.slice(0, left);
    hidden += section.fields.length - fields.length;
    left -= fields.length;
    kept.push({ ...section, fields });
  }
  return { sections: kept, hidden };
}
