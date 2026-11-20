/** Longest name proposed for a favorite (the field accepts up to 100 characters). */
export const FAVORITE_NAME_LENGTH = 60;

/** Words and signs that make no sense at the end of a name ("… 40 g e", "… con"), in Italian, English and Dutch. */
const TRAILING = new Set(["e", "ed", "con", "di", "da", "a", "al", "allo", "alla", "ai", "agli", "alle", "in", "su", "per", "o", "senza", "and", "with", "of", "or", "en", "met", "van", "zonder", "+", "&", "·", "-", "–", "—", "/"]);

/**
 * Name proposed in "Salva come preferito": the meal description without a "Colazione:" style prefix, cut at a whole word
 * when longer than 60 characters, without a connector or sign left hanging at the end.
 * "Colazione: Caffellatte + yogurt greco 150 g con fiocchi d'avena 40 g e banana" → "Caffellatte + yogurt greco 150 g con fiocchi d'avena 40 g".
 */
export function favoriteNameFrom(description: string): string {
  const text = description.replace(/^[^:]{1,20}:\s*/, "").replace(/\s+/g, " ").trim();
  if (text.length <= FAVORITE_NAME_LENGTH) return text;
  const words = text.slice(0, FAVORITE_NAME_LENGTH + 1).split(" ");
  // The last piece is cut in the middle unless the text continues with a space right after it
  if (text[FAVORITE_NAME_LENGTH] !== " ") words.pop();
  while (words.length > 1) {
    const last = words[words.length - 1]!.replace(/[,;:.]+$/, "");
    if (last === "" || TRAILING.has(last.toLowerCase())) words.pop();
    else {
      words[words.length - 1] = last;
      break;
    }
  }
  return words.join(" ") || text.slice(0, FAVORITE_NAME_LENGTH);
}
