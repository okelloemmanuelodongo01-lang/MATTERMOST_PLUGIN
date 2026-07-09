import {listGoogleLanguages} from './google.js';
import {filterGoogleSpeechCandidates, toSpeechBcp47} from './speech_bcp47.js';

let cachedSpeechBcp47: string[] | null = null;
let cachedRotations: string[][] | null = null;

export function uniqueSpeechBcp47(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    const bcp47 = toSpeechBcp47(code);
    if (!bcp47 || seen.has(bcp47)) {
      continue;
    }
    seen.add(bcp47);
    out.push(bcp47);
  }
  return out;
}

/** All Google Translate languages mapped to Speech BCP-47 tags (same list users pick in the UI). */
export async function getAllSpeechBcp47Codes(): Promise<string[]> {
  if (cachedSpeechBcp47) {
    return cachedSpeechBcp47;
  }

  try {
    const languages = await listGoogleLanguages();
    cachedSpeechBcp47 = uniqueSpeechBcp47(
      filterGoogleSpeechCandidates(languages.map((entry) => entry.code)),
    );
  } catch {
    cachedSpeechBcp47 = uniqueSpeechBcp47(Object.keys({
      en: 'en-US',
      ja: 'ja-JP',
      fr: 'fr-FR',
      es: 'es-ES',
      de: 'de-DE',
      zh: 'zh-CN',
      ko: 'ko-KR',
      ar: 'ar-SA',
      pt: 'pt-BR',
      ru: 'ru-RU',
      hi: 'hi-IN',
      it: 'it-IT',
      sw: 'sw-KE',
      lg: 'lg-UG',
    }));
  }

  return cachedSpeechBcp47;
}

/** Google Speech allows 1 primary + 3 alternative language codes per request. */
function padRotationToFour(slice: string[], pool: string[]): string[] {
  if (slice.length >= 4) {
    return slice.slice(0, 4);
  }

  const padded = [...slice];
  let index = 0;
  while (padded.length < 4 && pool.length > 0) {
    const candidate = pool[index % pool.length];
    index += 1;
    if (!padded.includes(candidate)) {
      padded.push(candidate);
    }
    if (index > pool.length * 4) {
      break;
    }
  }
  return padded.slice(0, 4);
}

export function batchIntoRotations(bcp47Codes: string[]): string[][] {
  const unique = uniqueSpeechBcp47(bcp47Codes);
  if (unique.length === 0) {
    return [];
  }

  const rotations: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 4) {
    const slice = unique.slice(offset, offset + 4);
    rotations.push(padRotationToFour(slice, unique));
  }
  return rotations;
}

export async function getGlobalSpeechRotations(): Promise<string[][]> {
  if (cachedRotations) {
    return cachedRotations;
  }
  const codes = await getAllSpeechBcp47Codes();
  cachedRotations = batchIntoRotations(codes);
  return cachedRotations;
}

export function buildChannelRotations(languageCandidates: string[]): string[][] {
  return batchIntoRotations(filterGoogleSpeechCandidates(languageCandidates));
}

export async function preloadSpeechLanguageCatalog(): Promise<number> {
  const rotations = await getGlobalSpeechRotations();
  return rotations.length;
}

/** Evenly sample rotation batches across the full catalog — broad coverage without scanning every batch. */
export async function getSampledSpeechRotations(targetCount = 12): Promise<string[][]> {
  const all = await getGlobalSpeechRotations();
  if (all.length === 0) {
    return [];
  }
  if (all.length <= targetCount) {
    return all;
  }

  const sampled: string[][] = [];
  const step = all.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    sampled.push(all[Math.floor(i * step)]);
  }
  return sampled;
}
