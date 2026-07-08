import {pipeline} from '@xenova/transformers';
import decode, {type AudioData} from 'audio-decode';

import {isGoogleSpeechEnabled, transcribeWithGoogleSpeech} from './google_speech.js';
import {detectLanguageWithGoogle, isGoogleTranslateEnabled} from './google.js';
import {normalizeSpeechLanguageCode, toWhisperLanguage} from './speech_bcp47.js';
import {preprocessForStt} from './audio_preprocess.js';
import {scriptLanguageHint} from './spoken_language_hints.js';

type Transcriber = Awaited<ReturnType<typeof pipeline>>;

export type TranscriptionResult = {
  text: string;
  detected_language: string;
  engine: string;
  confidence?: number;
};

const WHISPER_MODEL = process.env.WHISPER_MODEL?.trim() || 'Xenova/whisper-small';

let transcriberPromise: Promise<Transcriber> | null = null;

async function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', WHISPER_MODEL);
  }
  return transcriberPromise;
}

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) {
    return input;
  }

  const ratio = inputRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }

  return output;
}

function toMonoFloat32(audioData: AudioData): Float32Array {
  const {channelData} = audioData;
  if (!channelData.length || !channelData[0]?.length) {
    throw new Error('No audio samples in the recording.');
  }

  if (channelData.length === 1) {
    return new Float32Array(channelData[0]);
  }

  const channel0 = channelData[0];
  const channel1 = channelData[1];
  const merged = new Float32Array(channel0.length);
  const scale = Math.sqrt(2);

  for (let i = 0; i < channel0.length; i++) {
    merged[i] = (scale * (channel0[i] + channel1[i])) / 2;
  }

  return merged;
}

export async function decodeAudioBuffer(buffer: Buffer): Promise<{samples: Float32Array; sampleRate: number; durationSeconds: number}> {
  const audioData = await decode(new Uint8Array(buffer));
  const mono = toMonoFloat32(audioData);
  const resampled = resampleTo16k(mono, audioData.sampleRate);
  const samples = preprocessForStt(resampled);
  const durationSeconds = samples.length / 16000;
  return {samples, sampleRate: 16000, durationSeconds};
}

function whisperChunkParams(durationSeconds: number): {chunk_length_s: number; stride_length_s: number} {
  if (durationSeconds <= 12) {
    return {
      chunk_length_s: Math.max(6, Math.ceil(durationSeconds) + 2),
      stride_length_s: 1,
    };
  }
  if (durationSeconds <= 45) {
    return {chunk_length_s: 20, stride_length_s: 3};
  }
  return {chunk_length_s: 30, stride_length_s: 5};
}

async function transcribeWithWhisper(
  samples: Float32Array,
  languageHint?: string,
  durationSeconds = 0,
): Promise<TranscriptionResult> {
  const whisperLanguage = toWhisperLanguage(languageHint);
  const duration = durationSeconds || samples.length / 16000;
  const chunkParams = whisperChunkParams(duration);

  const transcriber = await getTranscriber();
  const output = await transcriber(samples, {
    ...chunkParams,
    ...(whisperLanguage ? {language: whisperLanguage, task: 'transcribe'} : {task: 'transcribe'}),
  }) as {text?: string};

  const text = String(output?.text || '').trim();
  if (!text) {
    throw new Error('No speech detected in the recording.');
  }

  let detectedLanguage = whisperLanguage || '';
  if (!detectedLanguage && isGoogleTranslateEnabled()) {
    try {
      detectedLanguage = await detectLanguageWithGoogle(text);
    } catch {
      detectedLanguage = '';
    }
  }

  return {
    text,
    detected_language: normalizeSpeechLanguageCode(detectedLanguage) || '',
    engine: whisperLanguage ? `whisper:${WHISPER_MODEL}` : `whisper-auto:${WHISPER_MODEL}`,
    confidence: whisperLanguage ? 0.82 : 0.74,
  };
}

async function finalizeDetectedLanguage(text: string, fallback: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return normalizeSpeechLanguageCode(fallback);
  }

  const scriptHint = scriptLanguageHint(trimmed);

  if (isGoogleTranslateEnabled()) {
    try {
      const detected = normalizeSpeechLanguageCode(await detectLanguageWithGoogle(trimmed));
      if (detected) {
        if (scriptHint && (detected === 'en' || detected === scriptHint)) {
          return scriptHint;
        }
        return detected;
      }
    } catch {
      // use fallback
    }
  }

  return normalizeSpeechLanguageCode(fallback) || scriptHint;
}

function languageMatchesHint(detected: string, hint: string): boolean {
  const d = normalizeSpeechLanguageCode(detected);
  const h = normalizeSpeechLanguageCode(hint);
  if (!d || !h) {
    return false;
  }
  return d === h;
}

function scoreTranscription(result: TranscriptionResult, preferredLang?: string): number {
  const text = result.text.trim();
  if (!text) {
    return 0;
  }

  let score = text.length;
  if (result.engine.startsWith('google')) {
    score += 14;
  }
  if (result.engine.includes('whisper-auto')) {
    score += 6;
  }
  if (typeof result.confidence === 'number') {
    score += result.confidence * 40;
  }
  if (preferredLang && languageMatchesHint(result.detected_language, preferredLang)) {
    score += 24;
  }
  return score;
}

function pickBestTranscription(results: TranscriptionResult[], preferredLang?: string): TranscriptionResult {
  const usable = results.filter((entry) => entry.text.trim().length > 0);
  if (usable.length === 0) {
    throw new Error('No speech detected in the recording.');
  }

  usable.sort((a, b) => scoreTranscription(b, preferredLang) - scoreTranscription(a, preferredLang));
  return usable[0];
}

export function getSpeechEngine(): string {
  if (isGoogleSpeechEnabled()) {
    return `google-speech-auto+whisper:${WHISPER_MODEL}`;
  }
  return `whisper:${WHISPER_MODEL}`;
}

export async function transcribeAudioBuffer(
  buffer: Buffer,
  fileName: string,
  options?: {languageHint?: string; mimeType?: string; languageCandidates?: string[]},
): Promise<TranscriptionResult> {
  const mimeType = options?.mimeType || '';
  const languageHint = options?.languageHint?.trim() || '';
  const languageCandidates = (options?.languageCandidates || [])
    .map((code) => code.trim())
    .filter(Boolean);

  let samples: Float32Array | undefined;
  let durationSeconds = 0;
  try {
    const decoded = await decodeAudioBuffer(buffer);
    samples = decoded.samples;
    durationSeconds = decoded.durationSeconds;
  } catch {
    samples = undefined;
    durationSeconds = 0;
  }

  const results: TranscriptionResult[] = [];
  const googleEnabled = isGoogleSpeechEnabled();

  // Phase 1 — Whisper auto-detect (fallback acoustic engine).
  let whisperDetected = '';
  if (samples && samples.length > 0) {
    try {
      const whisperAuto = await transcribeWithWhisper(samples, undefined, durationSeconds);
      results.push(whisperAuto);
      whisperDetected = whisperAuto.detected_language;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Whisper auto-detect failed';
      console.warn(message);
    }
  }

  const googleHint = languageHint || whisperDetected || '';

  // Phase 2 — Google Speech (channel candidates + auto rotations).
  if (googleEnabled && durationSeconds > 0) {
    try {
      results.push(await transcribeWithGoogleSpeech(
        buffer,
        mimeType,
        fileName,
        googleHint,
        durationSeconds,
        samples,
        languageCandidates,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google Speech failed';
      console.warn(`Google Speech failed: ${message}`);
    }

    // Phase 3 — Polish with explicit locale once spoken language is known.
    const refineLang = googleHint || results.find((entry) => entry.detected_language)?.detected_language || '';
    if (refineLang && results.length > 0) {
      const bestSoFar = pickBestTranscription(results, refineLang);
      if (bestSoFar.text.length < 12 || !languageMatchesHint(bestSoFar.detected_language, refineLang)) {
        try {
          results.push(await transcribeWithGoogleSpeech(
            buffer,
            mimeType,
            fileName,
            refineLang,
            durationSeconds,
            samples,
            languageCandidates,
          ));
        } catch {
          // ignore polish failure
        }
      }
    }
  }

  if (results.length === 0) {
    throw new Error('Transcription failed for this recording.');
  }

  const preferredLang = googleHint || whisperDetected || languageCandidates[0] || '';
  const best = results.length === 1 ? results[0] : pickBestTranscription(results, preferredLang);

  const detected = await finalizeDetectedLanguage(best.text, best.detected_language || whisperDetected);
  return {
    ...best,
    detected_language: detected || best.detected_language || whisperDetected,
    engine: best.engine.includes('+google-lid') ? best.engine : `${best.engine}+google-lid`,
  };
}
