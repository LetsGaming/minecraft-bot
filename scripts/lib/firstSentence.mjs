const ABBREVIATIONS = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl)$/i;
const CLOSERS = new Set(['"', "'", ")", "]", "*", "`"]);

/**
 * The first full sentence of a changelog entry.
 *
 * A period only ends the sentence when it is followed by whitespace (or the end
 * of the text), sits outside backticks and brackets, and does not close an
 * abbreviation such as "e.g.". File names, versions and numbers ("config.json",
 * "v8.1.0", "1.400") therefore never cut the sentence short. Text with no
 * sentence end is returned whole rather than trimmed.
 */
export function firstSentence(text) {
  const s = text.trim();
  let inCode = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "`") inCode = !inCode;
    if (inCode) continue;
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    if (depth > 0 || !".!?".includes(c)) continue;
    if (c === "." && ABBREVIATIONS.test(s.slice(0, i))) continue;
    let end = i + 1;
    while (end < s.length && (".!?".includes(s[end]) || CLOSERS.has(s[end]))) end++;
    if (end === s.length || /\s/.test(s[end])) return s.slice(0, end).trim();
  }
  return s;
}
