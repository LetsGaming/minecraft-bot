import { computed, reactive } from "vue";

/** The slugs ticked in the installed list. `pageSlugs` is what the current page shows. */
export function useModSelection(pageSlugs: () => string[]) {
  const selected = reactive(new Set<string>());

  const allPageSelected = computed(() => {
    const slugs = pageSlugs();
    return slugs.length > 0 && slugs.every((slug) => selected.has(slug));
  });

  function toggle(slug: string): void {
    if (selected.has(slug)) selected.delete(slug);
    else selected.add(slug);
  }

  function togglePage(): void {
    const select = !allPageSelected.value;
    for (const slug of pageSlugs()) {
      if (select) selected.add(slug);
      else selected.delete(slug);
    }
  }

  /** Drop selected slugs that are no longer in `slugs` (a mod was removed or the server changed). */
  function keepOnly(slugs: Iterable<string>): void {
    const keep = new Set(slugs);
    for (const slug of [...selected]) if (!keep.has(slug)) selected.delete(slug);
  }

  function remove(slug: string): void {
    selected.delete(slug);
  }

  function clear(): void {
    selected.clear();
  }

  return { selected, allPageSelected, toggle, togglePage, keepOnly, remove, clear };
}
