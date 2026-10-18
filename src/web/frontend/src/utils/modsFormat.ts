export function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function modrinthUrl(slug: string): string {
  return `https://modrinth.com/mod/${encodeURIComponent(slug)}`;
}

/** First page, last page and a window around the current one, with `"gap"` where pages are skipped. */
export function pageWindow(page: number, last: number): Array<number | "gap"> {
  const wanted = new Set([1, last]);
  for (let n = page - 1; n <= page + 1; n++) if (n > 1 && n < last) wanted.add(n);
  const items: Array<number | "gap"> = [];
  let prev = 0;
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (n - prev === 2) items.push(prev + 1);
    else if (n - prev > 2) items.push("gap");
    items.push(n);
    prev = n;
  }
  return items;
}
