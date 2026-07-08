import {normalizeSpeechLanguageCode} from './speech_bcp47.js';

export const JAPANESE_ROMANIZED =
  /\b(arigat[oō]?|sayonara|konnichiwa|ohay[oō]|sumimasen|ogenki|itadakimasu|moshi\s+moshi|hai|iie|onegaishimasu|gomennasai)\b/iu;

export const KOREAN_ROMANIZED =
  /\b(annyeong|annyeonghaseyo|kamsahamnida|gamsahamnida|saranghae|mianhae)\b/iu;

export function scriptLanguageHint(text: string): string {
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) {
    return 'ja';
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'ko';
  }
  if (/[\u0400-\u04ff]/.test(text)) {
    return 'ru';
  }
  if (/[\u0600-\u06ff]/.test(text)) {
    return 'ar';
  }
  if (/[\u0900-\u097f]/.test(text)) {
    return 'hi';
  }
  if (/[\u0e00-\u0e7f]/.test(text)) {
    return 'th';
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh';
  }
  if (JAPANESE_ROMANIZED.test(text)) {
    return 'ja';
  }
  if (KOREAN_ROMANIZED.test(text)) {
    return 'ko';
  }
  return '';
}

/** Keep scanning when transcript hints a different language than STT reported (e.g. "Arigato." labeled English). */
export function shouldKeepScanningStt(text: string, detectedLanguage: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const hint = scriptLanguageHint(trimmed);
  const lang = normalizeSpeechLanguageCode(detectedLanguage);
  if (!hint || !lang) {
    return false;
  }

  return hint !== lang;
}

export function isMostlyLatinText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const letters = (trimmed.match(/\p{L}/gu) || []);
  if (letters.length < 3) {
    return false;
  }

  const latinLetters = letters.filter((ch) => /[A-Za-z]/.test(ch));
  return latinLetters.length / letters.length >= 0.8;
}
