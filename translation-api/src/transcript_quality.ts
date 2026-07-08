/** Reject obvious STT hallucinations before translation. */
export function isPlausibleTranscript(text: string, confidence = 0): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }

  const letters = trimmed.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length < 2) {
    return false;
  }

  // Real speech in Latin/Cyrillic/Arabic scripts etc. usually has vowels.
  if (!/[aeiouyàâäéèêëïîôùûüæœáíóúñąćęłńóśźżäöüßаеёиоуыэюяءآأإئؤةى]/iu.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  for (const word of words) {
    const core = word.replace(/[\p{P}\p{S}]/gu, '');
    if (core.length > 16) {
      return false;
    }
    if (/[b-df-hj-np-tv-z]{6,}/iu.test(core)) {
      return false;
    }
  }

  // Whisper often returns one long nonsense token on short clips.
  if (trimmed.length > 28 && words.length === 1) {
    return false;
  }

  // Very low Google confidence on a long token is usually wrong.
  if (confidence > 0 && confidence < 0.35 && trimmed.length > 12 && words.length === 1) {
    return false;
  }

  return true;
}

export function filterPlausibleResults<T extends {text: string; confidence?: number}>(results: T[]): T[] {
  return results.filter((entry) => isPlausibleTranscript(entry.text, entry.confidence ?? 0));
}

/** Higher = more trustworthy transcript for ranking engines. */
export function transcriptQualityScore(text: string, confidence = 0): number {
  const trimmed = text.trim();
  if (!trimmed || !isPlausibleTranscript(trimmed, confidence)) {
    return 0;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  let score = trimmed.length + confidence * 50;
  if (words.length >= 2) {
    score += 12;
  }
  if (/[.!?…]$/.test(trimmed)) {
    score += 4;
  }
  if (confidence >= 0.85) {
    score += 20;
  }
  return score;
}
