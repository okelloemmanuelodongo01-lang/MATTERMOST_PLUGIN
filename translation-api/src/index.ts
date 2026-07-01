import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {detectLanguageWithGoogle, isGoogleTranslateEnabled} from './google.js';
import {detectLanguage as detectLanguageMyMemory} from './mymemory.js';
import {getSpeechEngine, transcribeAudioBuffer} from './transcribe.js';
import {isGoogleSpeechEnabled} from './google_speech.js';
import {getCachedAudioEntryCount, getCachedGoogleVoiceCount, isGoogleTTSEnabled, listSupportedTTSLanguageBases, loadGoogleVoices, synthesizeSpeech} from './google_tts.js';
import {getUsage, QuotaExceededError, trackUsage} from './usage.js';
import {getSemanticModelName, isSemanticEmbeddingEnabled} from './semantic_embeddings.js';
import {getTranslationEngine, listLanguages, translateText} from './translate.js';

const PORT = Number(process.env.PORT) || 5000;
const API_KEY = process.env.API_KEY || 'dev-transchecker-key-change-in-production';
const MONTHLY_CHAR_LIMIT = Number(process.env.MONTHLY_CHAR_LIMIT) || 500000;
const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 25 * 1024 * 1024}});

const app = express();
app.use(cors());
app.use(express.json({limit: '1mb'}));

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const key = req.header('X-API-Key');
  if (!key || key !== API_KEY) {
    res.status(401).json({error: 'Invalid or missing API key'});
    return;
  }
  (req as express.Request & {apiKey: string}).apiKey = key;
  next();
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'transchecker-translation-api',
    translation_engine: getTranslationEngine(),
    speech_engine: getSpeechEngine(),
    google_translate_configured: isGoogleTranslateEnabled(),
    google_speech_configured: isGoogleSpeechEnabled(),
    google_tts_configured: isGoogleTTSEnabled(),
    google_tts_voices_cached: getCachedGoogleVoiceCount(),
    google_tts_audio_cache_entries: getCachedAudioEntryCount(),
    google_tts_language_bases_supported: listSupportedTTSLanguageBases().length,
    semantic_embeddings_enabled: isSemanticEmbeddingEnabled(),
    semantic_model: isSemanticEmbeddingEnabled() ? getSemanticModelName() : null,
  });
});

app.get('/languages', requireApiKey, async (_req, res) => {
  try {
    const languages = await listLanguages();
    res.json({languages, engine: getTranslationEngine()});
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load languages';
    res.status(502).json({error: message});
  }
});

app.get('/usage', requireApiKey, (req, res) => {
  const apiKey = (req as express.Request & {apiKey: string}).apiKey;
  res.json(getUsage(apiKey, MONTHLY_CHAR_LIMIT));
});

app.post('/detect', requireApiKey, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) {
      res.status(400).json({error: 'text is required'});
      return;
    }

    const apiKey = (req as express.Request & {apiKey: string}).apiKey;
    trackUsage(apiKey, text.length, MONTHLY_CHAR_LIMIT);

    const detected = isGoogleTranslateEnabled()
      ? await detectLanguageWithGoogle(text)
      : await detectLanguageMyMemory(text);
    res.json({detected_language: detected, confidence: 0.85});
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(429).json({
        error: 'Monthly character quota exceeded',
        ...getUsage((req as express.Request & {apiKey: string}).apiKey, MONTHLY_CHAR_LIMIT),
      });
      return;
    }
    res.status(500).json({error: 'Language detection failed'});
  }
});

app.post('/translate', requireApiKey, async (req, res) => {
  try {
    const {text, to, from, hint_language, fast} = req.body as {
      text?: string;
      to?: string;
      from?: string;
      hint_language?: string;
      fast?: boolean;
    };
    if (!text || !to) {
      res.status(400).json({error: 'text and to are required'});
      return;
    }

    const apiKey = (req as express.Request & {apiKey: string}).apiKey;
    trackUsage(apiKey, text.length, MONTHLY_CHAR_LIMIT);

    const result = await translateText({text, to, from, hint_language, fast: Boolean(fast)});
    trackUsage(apiKey, result.translated.length, MONTHLY_CHAR_LIMIT);

    res.json(result);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(429).json({
        error: 'Monthly character quota exceeded',
        ...getUsage((req as express.Request & {apiKey: string}).apiKey, MONTHLY_CHAR_LIMIT),
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Translation failed';
    if (message.includes('quota')) {
      res.status(429).json({error: message});
      return;
    }

    res.status(502).json({error: message});
  }
});

app.post('/transcribe', requireApiKey, upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer?.length) {
      res.status(400).json({error: 'audio file is required'});
      return;
    }

    const languageHint = String(req.body?.language_hint || req.body?.language || '').trim();
    const mimeType = String(req.body?.mime_type || file.mimetype || '').trim();
    const rawCandidates = String(req.body?.language_candidates || '').trim();
    const languageCandidates = rawCandidates
      ? rawCandidates.split(/[,;]+/).map((code) => code.trim()).filter(Boolean)
      : [];

    const result = await transcribeAudioBuffer(file.buffer, file.originalname || 'audio.webm', {
      languageHint: languageHint || undefined,
      mimeType: mimeType || undefined,
      languageCandidates,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed';
    console.error('Transcription error:', message);
    res.status(502).json({error: message});
  }
});

app.post('/synthesize', requireApiKey, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const language = String(req.body?.language || req.body?.lang || '').trim();
    const voiceGender = String(req.body?.voice_gender || req.body?.gender || '').trim();
    if (!text) {
      res.status(400).json({error: 'text is required'});
      return;
    }
    if (!language) {
      res.status(400).json({error: 'language is required'});
      return;
    }

    const apiKey = (req as express.Request & {apiKey: string}).apiKey;
    trackUsage(apiKey, text.length, MONTHLY_CHAR_LIMIT);

    const audio = await synthesizeSpeech(text, language, voiceGender);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Speech synthesis failed';
    console.error('Synthesis error:', message);
    res.status(502).json({error: message});
  }
});

app.listen(PORT, () => {
  console.log(`TransChecker Translation API running on http://localhost:${PORT}`);
  console.log(`  Translate:  ${getTranslationEngine()}`);
  console.log(`  Speech:     ${getSpeechEngine()}`);
  console.log(`  Health:     http://localhost:${PORT}/health`);
  console.log(`  Languages:  GET  http://localhost:${PORT}/languages`);
  console.log(`  Translate:  POST http://localhost:${PORT}/translate`);
  console.log(`  Transcribe: POST http://localhost:${PORT}/transcribe`);
  console.log(`  Synthesize: POST http://localhost:${PORT}/synthesize`);

  if (isGoogleTTSEnabled()) {
    void loadGoogleVoices().then((voices) => {
      console.log(`  TTS voices: ${voices.length} Google voices preloaded for read-aloud`);
    }).catch((err) => {
      console.warn('  TTS voices: preload skipped —', err instanceof Error ? err.message : err);
    });
  }
});
