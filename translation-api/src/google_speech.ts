import {float32ToWav} from './audio_wav.js';
import {GOOGLE_SPEECH_SYNC_MAX_SECONDS, normalizeSpeechLanguageCode, toSpeechBcp47} from './speech_bcp47.js';
import {fetchWithRetry} from './fetch_retry.js';

const GOOGLE_SPEECH_API_KEY =
  process.env.GOOGLE_SPEECH_API_KEY?.trim() ||
  process.env.GOOGLE_TRANSLATE_API_KEY?.trim() ||
  '';

/** Fallback when no channel context — rotated in multi-pass auto-detect. */
const AUTO_DETECT_ROTATIONS: string[][] = [
  ['en-US', 'fr-FR', 'ja-JP', 'ar-SA'],
  ['sw-KE', 'de-DE', 'es-ES', 'pt-BR'],
  ['hi-IN', 'it-IT', 'ru-RU', 'zh-CN'],
  ['lg-UG', 'ha-NG', 'ko-KR', 'nl-NL'],
];

const CHUNK_SECONDS = 50;

export function isGoogleSpeechEnabled(): boolean {
  return GOOGLE_SPEECH_API_KEY.length > 0;
}

function googleSpeechErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: {message?: string};
    };
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // ignore
  }
  return body || `Google Speech API error: HTTP ${status}`;
}

function uniqueBcp47(codes: string[]): string[] {
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

export function buildLanguageConfig(languageHint?: string, languageCandidates?: string[]): {
  languageCode: string;
  alternativeLanguageCodes: string[];
} {
  const explicit = toSpeechBcp47(languageHint);
  if (explicit) {
    return {
      languageCode: explicit,
      alternativeLanguageCodes: [],
    };
  }

  const fromChannel = uniqueBcp47(languageCandidates || []);
  if (fromChannel.length > 0) {
    return {
      languageCode: fromChannel[0],
      alternativeLanguageCodes: fromChannel.slice(1, 4),
    };
  }

  const rotation = AUTO_DETECT_ROTATIONS[0];
  return {
    languageCode: rotation[0],
    alternativeLanguageCodes: rotation.slice(1, 4),
  };
}

function speechModel(durationSeconds?: number, explicitLanguage?: boolean): string {
  if (durationSeconds && durationSeconds > 12) {
    return 'latest_long';
  }
  if (explicitLanguage) {
    return 'latest_short';
  }
  return 'latest_long';
}

export function speechEncoding(mimeType: string, fileName: string): string {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (mime.includes('wav') || name.endsWith('.wav')) {
    return 'LINEAR16';
  }
  if (mime.includes('webm') || name.endsWith('.webm')) {
    return 'WEBM_OPUS';
  }
  if (mime.includes('ogg') || name.endsWith('.ogg')) {
    return 'OGG_OPUS';
  }
  if (mime.includes('mp4') || mime.includes('m4a') || name.endsWith('.m4a') || name.endsWith('.mp4')) {
    return 'MP4';
  }
  if (mime.includes('mpeg') || mime.includes('mp3') || name.endsWith('.mp3')) {
    return 'MP3';
  }
  if (mime.includes('flac') || name.endsWith('.flac')) {
    return 'FLAC';
  }

  return 'WEBM_OPUS';
}

type RecognizeResult = {
  text: string;
  detected_language: string;
  confidence: number;
};

async function recognizeChunk(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  languageHint?: string,
  durationSeconds?: number,
  languageCandidates?: string[],
): Promise<RecognizeResult> {
  const encoding = speechEncoding(mimeType, fileName);
  const languageConfig = buildLanguageConfig(languageHint, languageCandidates);
  const explicitLanguage = Boolean(toSpeechBcp47(languageHint));
  const model = speechModel(durationSeconds, explicitLanguage);

  const baseConfig: Record<string, unknown> = {
    encoding,
    languageCode: languageConfig.languageCode,
    ...(languageConfig.alternativeLanguageCodes.length > 0
      ? {alternativeLanguageCodes: languageConfig.alternativeLanguageCodes}
      : {}),
    enableAutomaticPunctuation: true,
    model,
  };

  if (encoding === 'LINEAR16') {
    baseConfig.sampleRateHertz = 16000;
  }

  const tryRecognize = async (useEnhanced: boolean): Promise<RecognizeResult> => {
    const payload = {
      config: {
        ...baseConfig,
        ...(useEnhanced && explicitLanguage ? {useEnhanced: true} : {}),
      },
      audio: {
        content: buffer.toString('base64'),
      },
    };

    const response = await fetchWithRetry(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(GOOGLE_SPEECH_API_KEY)}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      },
    );

    const body = await response.text();
    if (!response.ok) {
      throw new Error(googleSpeechErrorMessage(response.status, body));
    }

    const data = JSON.parse(body) as {
      results?: Array<{
        alternatives?: Array<{transcript?: string; confidence?: number}>;
        languageCode?: string;
      }>;
    };

    const transcripts: string[] = [];
    let detectedLanguage = languageConfig.languageCode;
    let confidence = 0;

    for (const result of data.results || []) {
      const alt = result.alternatives?.[0];
      const piece = alt?.transcript?.trim();
      if (piece) {
        transcripts.push(piece);
      }
      if (typeof alt?.confidence === 'number') {
        confidence = Math.max(confidence, alt.confidence);
      }
      if (result.languageCode) {
        detectedLanguage = result.languageCode;
      }
    }

    return {
      text: transcripts.join(' ').trim(),
      detected_language: normalizeSpeechLanguageCode(detectedLanguage) || normalizeSpeechLanguageCode(languageConfig.languageCode),
      confidence,
    };
  };

  try {
    return await tryRecognize(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('enhanced')) {
      return tryRecognize(false);
    }
    throw error;
  }
}

function scoreGoogleResult(result: RecognizeResult): number {
  return result.text.length + result.confidence * 50;
}

async function recognizeAutoMultiPass(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  durationSeconds: number,
  languageCandidates?: string[],
): Promise<RecognizeResult> {
  const attempts: RecognizeResult[] = [];

  if ((languageCandidates || []).length > 0) {
    const channelResult = await recognizeChunk(buffer, mimeType, fileName, '', durationSeconds, languageCandidates);
    if (channelResult.text) {
      attempts.push(channelResult);
    }
  }

  for (const rotation of AUTO_DETECT_ROTATIONS) {
    const primary = rotation[0];
    const alternatives = rotation.slice(1, 4);
    const config = {languageCode: primary, alternativeLanguageCodes: alternatives};
    const encoding = speechEncoding(mimeType, fileName);
    const payload = {
      config: {
        encoding,
        languageCode: config.languageCode,
        alternativeLanguageCodes: config.alternativeLanguageCodes,
        enableAutomaticPunctuation: true,
        model: speechModel(durationSeconds, false),
        ...(encoding === 'LINEAR16' ? {sampleRateHertz: 16000} : {}),
      },
      audio: {content: buffer.toString('base64')},
    };

    const response = await fetchWithRetry(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(GOOGLE_SPEECH_API_KEY)}`,
      {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)},
    );
    const body = await response.text();
    if (!response.ok) {
      continue;
    }

    const data = JSON.parse(body) as {
      results?: Array<{
        alternatives?: Array<{transcript?: string; confidence?: number}>;
        languageCode?: string;
      }>;
    };

    const transcripts: string[] = [];
    let detectedLanguage = primary;
    let confidence = 0;
    for (const result of data.results || []) {
      const alt = result.alternatives?.[0];
      const piece = alt?.transcript?.trim();
      if (piece) {
        transcripts.push(piece);
      }
      if (typeof alt?.confidence === 'number') {
        confidence = Math.max(confidence, alt.confidence);
      }
      if (result.languageCode) {
        detectedLanguage = result.languageCode;
      }
    }

    const text = transcripts.join(' ').trim();
    if (text) {
      attempts.push({
        text,
        detected_language: normalizeSpeechLanguageCode(detectedLanguage) || normalizeSpeechLanguageCode(primary),
        confidence,
      });
    }
  }

  if (attempts.length === 0) {
    return {text: '', detected_language: '', confidence: 0};
  }

  attempts.sort((a, b) => scoreGoogleResult(b) - scoreGoogleResult(a));
  return attempts[0];
}

export async function transcribeWithGoogleSpeech(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  languageHint?: string,
  durationSeconds?: number,
  pcmSamples?: Float32Array,
  languageCandidates?: string[],
): Promise<{text: string; detected_language: string; engine: string; confidence: number}> {
  const duration = durationSeconds || 0;
  const explicit = Boolean(toSpeechBcp47(languageHint));

  if (duration > GOOGLE_SPEECH_SYNC_MAX_SECONDS && pcmSamples && pcmSamples.length > 0) {
    const chunkSize = CHUNK_SECONDS * 16000;
    const parts: string[] = [];
    let detectedLanguage = '';
    let totalConfidence = 0;
    let chunkCount = 0;

    for (let offset = 0; offset < pcmSamples.length; offset += chunkSize) {
      const slice = pcmSamples.subarray(offset, Math.min(offset + chunkSize, pcmSamples.length));
      const wav = float32ToWav(slice, 16000);
      const chunkDuration = slice.length / 16000;
      const piece = await recognizeChunk(wav, 'audio/wav', 'chunk.wav', languageHint, chunkDuration, languageCandidates);
      if (piece.text) {
        parts.push(piece.text);
      }
      if (piece.detected_language) {
        detectedLanguage = piece.detected_language;
      }
      totalConfidence += piece.confidence;
      chunkCount += 1;
    }

    const text = parts.join(' ').trim();
    if (!text) {
      throw new Error('No speech detected in the recording.');
    }

    return {
      text,
      detected_language: detectedLanguage,
      engine: 'google-speech-chunked',
      confidence: chunkCount > 0 ? totalConfidence / chunkCount : 0,
    };
  }

  if (duration > GOOGLE_SPEECH_SYNC_MAX_SECONDS) {
    throw new Error(
      `Audio is ${Math.round(duration)}s; Google sync STT supports up to ${GOOGLE_SPEECH_SYNC_MAX_SECONDS}s without PCM decode.`,
    );
  }

  const result = explicit
    ? await recognizeChunk(buffer, mimeType, fileName, languageHint, duration, languageCandidates)
    : await recognizeAutoMultiPass(buffer, mimeType, fileName, duration, languageCandidates);

  if (!result.text) {
    throw new Error('No speech detected in the recording.');
  }

  return {
    text: result.text,
    detected_language: result.detected_language,
    engine: explicit ? 'google-speech' : 'google-speech-auto',
    confidence: result.confidence,
  };
}
