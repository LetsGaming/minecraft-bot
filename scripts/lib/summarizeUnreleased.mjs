import { firstSentence } from "./firstSentence.mjs";

/** Condenses an [Unreleased] body to one sentence per entry, grouped by its ### headings. */
export function summarizeUnreleasedBlock(rawUnreleasedText) {
  const categories = {};
  let currentCategory = "General";

  const lines = rawUnreleasedText.split("\n");
  let currentItemRaw = "";

  const processAndFlushItem = () => {
    if (!currentItemRaw.trim()) return;

    if (!categories[currentCategory]) {
      categories[currentCategory] = [];
    }

    // Normalisiert Leerzeichen und Umbrüche
    const cleanedText = currentItemRaw.replace(/\s+/g, " ").trim();

    // Extrahiert **Titel** und den folgenden Text
    const match = cleanedText.match(/^(\*\*[^*]+\*\*)\s*(.*)$/);

    if (match) {
      const [, title, description] = match;
      if (description) {
        categories[currentCategory].push(`${title} ${firstSentence(description)}`);
      } else {
        categories[currentCategory].push(title);
      }
    } else {
      // Falls kein **Titel** vorhanden ist, nimmt er den ersten Satz des Eintrags
      categories[currentCategory].push(firstSentence(cleanedText));
    }

    currentItemRaw = "";
  };

  for (const line of lines) {
    const categoryHeader = line.match(/^###\s+(.+)$/);
    if (categoryHeader) {
      processAndFlushItem();
      currentCategory = categoryHeader[1].trim();
      continue;
    }

    // Neuer Haupt-Stichpunkt
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      processAndFlushItem();
      currentItemRaw = bulletMatch[1].trim();
      continue;
    }

    // Unterpunkte überspringen
    if (/^\s+[-*]\s+/.test(line)) {
      continue;
    }

    // Folgezeilen des aktuellen Stichpunkts anhängen
    if (currentItemRaw && line.trim().length > 0) {
      currentItemRaw += " " + line.trim();
    }
  }

  processAndFlushItem();

  const outputLines = [];
  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    outputLines.push(`### ${category}\n`);
    for (const item of items) {
      outputLines.push(`- ${item}`);
    }
    outputLines.push("");
  }

  return outputLines.length > 0
    ? outputLines.join("\n").trim()
    : "- Internal updates and minor improvements.";
}
