/** Normalize imperative CLI-style English before translation for better target-language output. */
export function normalizeCommandPhrases(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  const patterns: Array<{regex: RegExp; replace: string}> = [
    {regex: /^Run\s+(`[^`]+`)\s+first\.?$/i, replace: 'Execute $1 first'},
    {regex: /^Run\s+(`[^`]+`)\s*$/i, replace: 'Execute $1'},
    {regex: /^Run\s+(.+?)\s+first\.?$/i, replace: 'Execute $1 first'},
    {regex: /^Install\s+(`[^`]+`)\s+first\.?$/i, replace: 'Install $1 first'},
    {regex: /^Use\s+(`[^`]+`)\s+to\s+/i, replace: 'Use $1 to '},
  ];

  for (const {regex, replace} of patterns) {
    if (regex.test(trimmed)) {
      return trimmed.replace(regex, replace);
    }
  }

  return text;
}
