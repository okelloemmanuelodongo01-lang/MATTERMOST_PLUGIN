import {fetchWithRetry} from './fetch_retry.js';
import {toSpeechBcp47} from './speech_bcp47.js';

const GOOGLE_TTS_API_KEY =
  process.env.GOOGLE_TTS_API_KEY?.trim() ||
  process.env.GOOGLE_TRANSLATE_API_KEY?.trim() ||
  '';

type VoiceGender = 'MALE' | 'FEMALE' | 'NEUTRAL';

type GoogleVoice = {
  languageCodes?: string[];
  name?: string;
  ssmlGender?: string;
};

type VoiceCache = {
  loadedAt: number;
  voices: GoogleVoice[];
};

type SynthesizeVoiceConfig = {
  languageCode: string;
  name?: string;
  ssmlGender: VoiceGender;
};

/** Extra locales to try when a language has no dedicated named voice (best-effort, no user error). */
const REGIONAL_FALLBACK_BCP47: Record<string, string[]> = {
  lg: ['lg-UG', 'sw-KE', 'en-KE'],
  ln: ['ln-CD', 'fr-CD', 'sw-KE', 'en-KE'],
  sw: ['sw-KE', 'sw-TZ', 'en-KE'],
  ha: ['ha-NG', 'en-NG'],
  yo: ['yo-NG', 'en-NG'],
  am: ['am-ET', 'en-GB'],
  zu: ['zu-ZA', 'en-ZA'],
  xh: ['xh-ZA', 'en-ZA'],
  st: ['st-ZA', 'en-ZA'],
  ny: ['ny-MW', 'sw-KE'],
  sn: ['sn-ZW', 'en-ZA'],
  rw: ['rw-RW', 'fr-FR', 'sw-KE'],
};

const VOICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AUDIO_CACHE_MAX = 300;
let voiceCache: VoiceCache | null = null;
let preferredLocaleByBase: Record<string, string> = {};
const audioCache = new Map<string, Buffer>();

function rebuildPreferredLocales(voices: GoogleVoice[]): void {
  const next: Record<string, {locale: string; score: number}> = {};
  for (const voice of voices) {
    if (!voice.name) {
      continue;
    }
    const score = voiceQualityRank(voice.name);
    for (const code of voice.languageCodes || []) {
      const base = languageBase(code);
      const current = next[base];
      if (!current || score > current.score) {
        next[base] = {locale: code, score};
      }
    }
  }
  preferredLocaleByBase = Object.fromEntries(
    Object.entries(next).map(([base, entry]) => [base, entry.locale]),
  );
}

export function resolveSpeechLocale(languageCode: string): string {
  const base = languageBase(languageCode);
  return preferredLocaleByBase[base] || toSpeechBcp47(languageCode) || languageCode;
}

export function listSupportedTTSLanguageBases(): string[] {
  return Object.keys(preferredLocaleByBase).sort();
}

function audioCacheKey(text: string, languageCode: string, gender: VoiceGender): string {
  return `${languageBase(languageCode)}|${gender}|${text}`;
}

function getCachedAudio(key: string): Buffer | undefined {
  const hit = audioCache.get(key);
  if (!hit) {
    return undefined;
  }
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

function setCachedAudio(key: string, buffer: Buffer): void {
  if (audioCache.has(key)) {
    audioCache.delete(key);
  }
  audioCache.set(key, buffer);
  while (audioCache.size > AUDIO_CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    if (!oldest) {
      break;
    }
    audioCache.delete(oldest);
  }
}

export function getCachedAudioEntryCount(): number {
  return audioCache.size;
}

export function isGoogleTTSEnabled(): boolean {
  return GOOGLE_TTS_API_KEY.length > 0;
}

function googleTTSErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {error?: {message?: string}};
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // ignore
  }
  return body || `Google Text-to-Speech API error: HTTP ${status}`;
}

function normalizeGoogleVoiceGender(value?: string): VoiceGender {
  switch ((value || '').trim().toUpperCase()) {
  case 'MALE':
    return 'MALE';
  case 'FEMALE':
    return 'FEMALE';
  default:
    return 'NEUTRAL';
  }
}

function voiceQualityRank(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('chirp')) {
    return 100;
  }
  if (n.includes('neural2')) {
    return 90;
  }
  if (n.includes('wavenet')) {
    return 80;
  }
  if (n.includes('standard')) {
    return 60;
  }
  if (n.includes('polyglot')) {
    return 50;
  }
  return 40;
}

function languageBase(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0];
}

function voiceMatchesLanguage(voice: GoogleVoice, bcp47: string): boolean {
  const target = bcp47.toLowerCase();
  const base = languageBase(bcp47);
  return (voice.languageCodes || []).some((code) => {
    const lc = code.toLowerCase();
    return lc === target || lc.startsWith(`${base}-`) || languageBase(lc) === base;
  });
}

function voiceMatchesGender(voice: GoogleVoice, gender: VoiceGender): boolean {
  const voiceGender = (voice.ssmlGender || '').toUpperCase();
  if (gender === 'NEUTRAL') {
    return true;
  }
  return voiceGender === gender || voiceGender === 'NEUTRAL';
}

function genderPreferenceScore(voice: GoogleVoice, gender: VoiceGender): number {
  const voiceGender = (voice.ssmlGender || '').toUpperCase();
  if (gender === 'NEUTRAL') {
    return voiceGender === 'NEUTRAL' ? 3 : 1;
  }
  if (voiceGender === gender) {
    return 3;
  }
  if (voiceGender === 'NEUTRAL') {
    return 2;
  }
  return 0;
}

export async function loadGoogleVoices(force = false): Promise<GoogleVoice[]> {
  if (!isGoogleTTSEnabled()) {
    return [];
  }

  const now = Date.now();
  if (!force && voiceCache && now - voiceCache.loadedAt < VOICE_CACHE_TTL_MS) {
    return voiceCache.voices;
  }

  const response = await fetchWithRetry(
    `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`,
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(googleTTSErrorMessage(response.status, body));
  }

  const data = JSON.parse(body) as {voices?: GoogleVoice[]};
  const voices = data.voices || [];
  voiceCache = {loadedAt: now, voices};
  rebuildPreferredLocales(voices);
  return voices;
}

export function pickGoogleVoice(
  voices: GoogleVoice[],
  languageCode: string,
  voiceGender?: string,
): GoogleVoice | undefined {
  const bcp47 = toSpeechBcp47(languageCode) || languageCode;
  const gender = normalizeGoogleVoiceGender(voiceGender);
  const candidates = voices
    .filter((voice) => voice.name && voiceMatchesLanguage(voice, bcp47))
    .filter((voice) => voiceMatchesGender(voice, gender))
    .map((voice) => ({
      voice,
      score:
        voiceQualityRank(voice.name || '') * 10 +
        genderPreferenceScore(voice, gender) * 5 +
        (voice.languageCodes?.some((code) => code.toLowerCase() === bcp47.toLowerCase()) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    return candidates[0].voice;
  }

  const relaxed = voices
    .filter((voice) => voice.name && voiceMatchesLanguage(voice, bcp47))
    .map((voice) => ({
      voice,
      score: voiceQualityRank(voice.name || ''),
    }))
    .sort((a, b) => b.score - a.score);

  return relaxed[0]?.voice;
}

function voiceConfigKey(config: SynthesizeVoiceConfig): string {
  return `${config.languageCode}|${config.name || ''}|${config.ssmlGender}`;
}

function buildSynthesizeAttempts(
  languageCode: string,
  voiceGender: VoiceGender,
  voices: GoogleVoice[],
): SynthesizeVoiceConfig[] {
  const bcp47 = resolveSpeechLocale(languageCode);
  const base = languageBase(languageCode);
  const attempts: SynthesizeVoiceConfig[] = [];
  const seen = new Set<string>();

  const push = (config: SynthesizeVoiceConfig) => {
    const key = voiceConfigKey(config);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    attempts.push(config);
  };

  const selected = pickGoogleVoice(voices, languageCode, voiceGender);
  if (selected?.name) {
    const voiceLanguage = selected.languageCodes?.find((code) => (
      code.toLowerCase() === bcp47.toLowerCase() ||
      languageBase(code) === base
    )) || selected.languageCodes?.[0] || bcp47;
    push({
      languageCode: voiceLanguage,
      name: selected.name,
      ssmlGender: (selected.ssmlGender as VoiceGender) || voiceGender,
    });
  }

  push({languageCode: bcp47, ssmlGender: voiceGender});

  for (const locale of REGIONAL_FALLBACK_BCP47[base] || []) {
    const named = pickGoogleVoice(voices, locale, voiceGender);
    if (named?.name) {
      push({
        languageCode: named.languageCodes?.[0] || locale,
        name: named.name,
        ssmlGender: (named.ssmlGender as VoiceGender) || voiceGender,
      });
    }
    push({languageCode: locale, ssmlGender: voiceGender});
  }

  for (const voice of voices) {
    if (!voice.name || !voiceMatchesLanguage(voice, bcp47)) {
      continue;
    }
    push({
      languageCode: voice.languageCodes?.[0] || bcp47,
      name: voice.name,
      ssmlGender: (voice.ssmlGender as VoiceGender) || voiceGender,
    });
  }

  return attempts;
}

async function callGoogleSynthesize(text: string, voice: SynthesizeVoiceConfig): Promise<Buffer> {
  const payload = {
    input: {text},
    voice: {
      languageCode: voice.languageCode,
      ...(voice.name ? {name: voice.name} : {}),
      ssmlGender: voice.ssmlGender,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1,
      pitch: 0,
    },
  };

  const response = await fetchWithRetry(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(googleTTSErrorMessage(response.status, body));
  }

  const data = JSON.parse(body) as {audioContent?: string};
  if (!data.audioContent) {
    throw new Error('Google Text-to-Speech returned no audio.');
  }

  return Buffer.from(data.audioContent, 'base64');
}

export async function synthesizeSpeech(
  text: string,
  languageCode: string,
  voiceGender?: string,
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('text is required');
  }
  if (!isGoogleTTSEnabled()) {
    throw new Error('Google Text-to-Speech is not configured. Set GOOGLE_TRANSLATE_API_KEY or GOOGLE_TTS_API_KEY.');
  }

  const gender = normalizeGoogleVoiceGender(voiceGender);
  const cacheKey = audioCacheKey(trimmed, languageCode, gender);
  const cached = getCachedAudio(cacheKey);
  if (cached) {
    return cached;
  }

  const voices = await loadGoogleVoices();
  const attempts = buildSynthesizeAttempts(languageCode, gender, voices);
  let lastError: Error | undefined;

  for (const attempt of attempts) {
    try {
      const audio = await callGoogleSynthesize(trimmed, attempt);
      setCachedAudio(cacheKey, audio);
      return audio;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Read-aloud is temporarily unavailable. Try again in a moment.');
}

export function getCachedGoogleVoiceCount(): number {
  return voiceCache?.voices.length ?? 0;
}
