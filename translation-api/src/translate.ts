import {
  detectLanguageWithGoogle,
  isGoogleTranslateEnabled,
  listGoogleLanguages,
  translateBatchWithGoogle,
  translateWithGoogle,
  type LanguageOption,
} from './google.js';
import {expandChatSlang} from './chat_slang.js';
import {normalizeCommandPhrases} from './command_phrases.js';
import {levenshteinScore} from './levenshtein.js';
import {
  compositeQualityScore,
  embeddingSimilarity,
  isSemanticEmbeddingEnabled,
} from './semantic_embeddings.js';
import {detectLanguage as detectLanguageMyMemory, translateWithMyMemory} from './mymemory.js';
import {
  hasMarkdownMarkup,
  markupStructurePreserved,
  repairTranslatedMarkup,
  stripMarkdownForScoring,
  translatePreservingMarkup,
  translatePreservingMarkupBatch,
} from './markdown_translate.js';

export type TranslateRequest = {
  text: string;
  to: string;
  from?: string;
  hint_language?: string;
  /** Fast path for voice/video: one Google translate call, no back-translation or embeddings. */
  fast?: boolean;
  /** deliver = forward only; evaluate = quality from existing translation; full = both (default). */
  phase?: 'deliver' | 'evaluate' | 'full';
  /** Required for phase=evaluate */
  origin?: string;
  translated?: string;
  detected_from?: string;
  engine?: string;
};

export type EvaluateRequest = {
  origin: string;
  translated: string;
  to: string;
  from?: string;
  detected_from?: string;
  engine?: string;
};

export type TranslateResponse = {
  origin: string;
  to: string;
  from: string;
  detected_from: string;
  translated: string;
  engine: string;
  reversed: string;
  score: number;
  semantic_score: number;
  embedding_score: number;
  quality_score: number;
  slang_expanded?: boolean;
  normalized_text?: string;
};

const FALLBACK_LANGUAGES: LanguageOption[] = [
  {code: 'en', name: 'English'},
  {code: 'ja', name: 'Japanese'},
  {code: 'lg', name: 'Luganda'},
  {code: 'fr', name: 'French'},
  {code: 'sw', name: 'Swahili'},
  {code: 'ln', name: 'Lingala'},
];

const SHORT_TEXT_MAX = 40;

export async function listLanguages(): Promise<LanguageOption[]> {
  if (isGoogleTranslateEnabled()) {
    return listGoogleLanguages('en');
  }
  return FALLBACK_LANGUAGES;
}

export function getTranslationEngine(): string {
  return isGoogleTranslateEnabled() ? 'google-translate' : 'mymemory';
}

async function detectLanguage(text: string): Promise<string> {
  if (isGoogleTranslateEnabled()) {
    return detectLanguageWithGoogle(text);
  }
  return detectLanguageMyMemory(text);
}

async function translateForward(
  text: string,
  from: string,
  to: string,
): Promise<{translated: string; engine: string; detectedFrom?: string}> {
  if (isGoogleTranslateEnabled()) {
    return translateWithGoogle(text, from, to);
  }
  return translateWithMyMemory(text, from, to);
}

async function translateForwardPreservingMarkup(
  text: string,
  from: string,
  to: string,
): Promise<{translated: string; engine: string; detectedFrom?: string}> {
  if (!hasMarkdownMarkup(text)) {
    return translateForward(text, from, to);
  }

  // Google-first: one API call for the full message (same strategy as translate.google.com).
  // Google v2 truncates around 5k chars per q — use markup batch for longer posts.
  if (isGoogleTranslateEnabled() && text.length <= 4800) {
    const whole = await translateForward(text, from, to);
    const repaired = repairTranslatedMarkup(whole.translated);
    if (markupStructurePreserved(text, repaired)) {
      return {
        translated: repaired,
        engine: `${whole.engine}:whole`,
        detectedFrom: whole.detectedFrom,
      };
    }
  }

  let engine = getTranslationEngine();
  let detectedFrom = from;

  if (isGoogleTranslateEnabled()) {
    const translated = await translatePreservingMarkupBatch(text, async (chunks) => {
      const results = await translateBatchWithGoogle(chunks, from, to);
      engine = results[0]?.engine || engine;
      if (!detectedFrom && results[0]?.detectedFrom) {
        detectedFrom = results[0].detectedFrom;
      }
      return results.map((entry) => entry.translated);
    });
    return {translated, engine: `${engine}:markup-batch`, detectedFrom};
  }

  const translated = await translatePreservingMarkup(text, async (segment) => {
    const result = await translateForward(segment, from, to);
    engine = result.engine;
    if (result.detectedFrom) {
      detectedFrom = result.detectedFrom;
    }
    return result.translated;
  });

  return {translated, engine: `${engine}:markup`, detectedFrom};
}

function simpleSemanticScore(original: string, backTranslated: string): number {
  const origWords = new Set(
    original.toLowerCase().split(/\W+/).filter(Boolean),
  );
  const backWords = backTranslated.toLowerCase().split(/\W+/).filter(Boolean);
  if (origWords.size === 0 || backWords.length === 0) return 0;

  let overlap = 0;
  for (const word of backWords) {
    if (origWords.has(word)) overlap++;
  }

  const recall = overlap / origWords.size;
  const precision = overlap / backWords.length;
  if (recall + precision === 0) return 0;
  return (2 * recall * precision) / (recall + precision);
}

function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0];
}

function isSameLanguage(a: string, b: string): boolean {
  return normalizeLanguageCode(a) === normalizeLanguageCode(b);
}

type ScoredCandidate = {
  from: string;
  detectedFrom: string;
  translated: string;
  engine: string;
  reversed: string;
  score: number;
  semantic_score: number;
  embedding_score: number;
  quality_score: number;
};

async function scoreTranslation(
  scoreOrigin: string,
  to: string,
  from: string,
  detectedFrom: string,
  translated: string,
  engine: string,
): Promise<ScoredCandidate> {
  if (isSameLanguage(from, to) || isSameLanguage(detectedFrom, to)) {
    return {
      from,
      detectedFrom,
      translated,
      engine,
      reversed: translated,
      score: 1,
      semantic_score: 1,
      embedding_score: 1,
      quality_score: 1,
    };
  }

  const plainOrigin = stripMarkdownForScoring(scoreOrigin);
  const plainTranslated = stripMarkdownForScoring(translated);
  const backward = await translateForward(plainTranslated || translated, to, from);
  const score = levenshteinScore(plainOrigin || scoreOrigin, backward.translated);
  const semantic_score = simpleSemanticScore(plainOrigin || scoreOrigin, backward.translated);
  const embedding_score = isSemanticEmbeddingEnabled()
    ? await embeddingSimilarity(plainOrigin || scoreOrigin, backward.translated)
    : 0;
  const quality_score = compositeQualityScore(score, semantic_score, embedding_score);

  return {
    from,
    detectedFrom,
    translated,
    engine,
    reversed: backward.translated,
    score: Math.round(score * 100) / 100,
    semantic_score: Math.round(semantic_score * 100) / 100,
    embedding_score: Math.round(embedding_score * 100) / 100,
    quality_score,
  };
}

async function buildCandidate(
  scoreOrigin: string,
  sourceText: string,
  to: string,
  from: string,
): Promise<ScoredCandidate> {
  const forward = hasMarkdownMarkup(sourceText)
    ? await translateForwardPreservingMarkup(sourceText, from, to)
    : await translateForward(sourceText, from, to);
  const detectedFrom = forward.detectedFrom || from || await detectLanguage(sourceText);
  const resolvedFrom = from || detectedFrom;

  if (isSameLanguage(detectedFrom, to) || isSameLanguage(resolvedFrom, to)) {
    return {
      from: resolvedFrom,
      detectedFrom,
      translated: forward.translated,
      engine: forward.engine,
      reversed: forward.translated,
      score: 1,
      semantic_score: 1,
      embedding_score: 1,
      quality_score: 1,
    };
  }

  return scoreTranslation(
    scoreOrigin,
    to,
    resolvedFrom,
    detectedFrom,
    forward.translated,
    forward.engine,
  );
}

async function pickBestCandidate(candidates: ScoredCandidate[]): Promise<ScoredCandidate> {
  return candidates.reduce((best, current) => (
    current.quality_score > best.quality_score ? current : best
  ));
}

/** Forward translation only — for instant message delivery. */
export async function deliverText(req: TranslateRequest, rawOrigin?: string): Promise<TranslateResponse> {
  const text = req.text?.trim();
  if (!text) {
    throw new Error('text is required');
  }
  const origin = rawOrigin?.trim() || req.origin?.trim() || text;
  const to = req.to;
  let from = req.from?.trim() || '';

  if (!from) {
    const detectionText = hasMarkdownMarkup(text) ? stripMarkdownForScoring(text) : text;
    from = await detectLanguage(detectionText || text);
  }

  if (isSameLanguage(from, to)) {
    return {
      origin,
      to,
      from,
      detected_from: from,
      translated: text,
      engine: 'none',
      reversed: '',
      score: 0,
      semantic_score: 0,
      embedding_score: 0,
      quality_score: 0,
    };
  }

  const forward = hasMarkdownMarkup(text)
    ? await translateForwardPreservingMarkup(text, from, to)
    : await translateForward(text, from, to);
  const detectedFrom = forward.detectedFrom || from;

  return {
    origin,
    to,
    from: detectedFrom,
    detected_from: detectedFrom,
    translated: forward.translated,
    engine: `${forward.engine}:deliver`,
    reversed: '',
    score: 0,
    semantic_score: 0,
    embedding_score: 0,
    quality_score: 0,
  };
}

/** Quality evaluation from an existing forward translation. */
export async function evaluateText(req: EvaluateRequest): Promise<TranslateResponse> {
  const origin = req.origin?.trim();
  const translated = req.translated?.trim();
  if (!origin || !translated) {
    throw new Error('origin and translated are required');
  }
  if (!req.to) {
    throw new Error('to is required');
  }

  const to = req.to;
  const from = req.from?.trim() || req.detected_from?.trim() || '';
  const detectedFrom = req.detected_from?.trim() || from;
  const engine = req.engine?.trim() || getTranslationEngine();

  if (!from && !detectedFrom) {
    const detectionText = hasMarkdownMarkup(origin) ? stripMarkdownForScoring(origin) : origin;
    const detected = await detectLanguage(detectionText || origin);
    return evaluateText({...req, from: detected, detected_from: detected});
  }

  const resolvedFrom = from || detectedFrom;
  const scored = await scoreTranslation(
    origin,
    to,
    resolvedFrom,
    detectedFrom || resolvedFrom,
    translated,
    engine,
  );

  return {
    origin,
    to,
    from: scored.from,
    detected_from: scored.detectedFrom,
    translated: scored.translated,
    engine: `${scored.engine}:evaluate`,
    reversed: scored.reversed,
    score: scored.score,
    semantic_score: scored.semantic_score,
    embedding_score: scored.embedding_score,
    quality_score: scored.quality_score,
  };
}

async function translateTextFast(req: TranslateRequest, rawOrigin?: string): Promise<TranslateResponse> {
  const text = req.text?.trim();
  if (!text) {
    throw new Error('text is required');
  }
  const origin = rawOrigin?.trim() || text;

  const to = req.to;
  let from = req.from?.trim() || '';

  if (!from) {
    const detectionText = hasMarkdownMarkup(text) ? stripMarkdownForScoring(text) : text;
    from = await detectLanguage(detectionText || text);
  }

  if (isSameLanguage(from, to)) {
    return {
      origin,
      to,
      from,
      detected_from: from,
      translated: text,
      engine: 'none',
      reversed: text,
      score: 1,
      semantic_score: 1,
      embedding_score: 0,
      quality_score: 1,
    };
  }

  const forward = hasMarkdownMarkup(text)
    ? await translateForwardPreservingMarkup(text, from, to)
    : await translateForward(text, from, to);
  const detectedFrom = forward.detectedFrom || from;

  // Media path: STT already detected source — skip back-translation round-trip.
  if (req.from?.trim()) {
    return {
      origin,
      to,
      from: detectedFrom,
      detected_from: detectedFrom,
      translated: forward.translated,
      engine: `${forward.engine}:fast`,
      reversed: forward.translated,
      score: 1,
      semantic_score: 1,
      embedding_score: 0,
      quality_score: 1,
    };
  }

  const plainOrigin = stripMarkdownForScoring(origin);
  const plainTranslated = stripMarkdownForScoring(forward.translated);
  const backward = await translateForward(plainTranslated || forward.translated, to, detectedFrom);
  const score = levenshteinScore(plainOrigin || origin, backward.translated);

  return {
    origin,
    to,
    from: detectedFrom,
    detected_from: detectedFrom,
    translated: forward.translated,
    engine: `${forward.engine}:fast`,
    reversed: backward.translated,
    score: Math.round(score * 100) / 100,
    semantic_score: Math.round(score * 100) / 100,
    embedding_score: 0,
    quality_score: Math.round(score * 100) / 100,
  };
}

export async function translateText(req: TranslateRequest): Promise<TranslateResponse> {
  const rawText = req.text?.trim();
  if (!rawText) {
    throw new Error('text is required');
  }
  if (!req.to) {
    throw new Error('to is required');
  }

  const text = normalizeCommandPhrases(rawText);

  if (req.phase === 'deliver') {
    return deliverText({...req, text}, rawText);
  }

  if (req.phase === 'evaluate') {
    const origin = req.origin?.trim() || rawText;
    const translated = req.translated?.trim();
    if (!translated) {
      throw new Error('translated is required for evaluate phase');
    }
    return evaluateText({
      origin,
      translated,
      to: req.to,
      from: req.from,
      detected_from: req.detected_from,
      engine: req.engine,
    });
  }

  if (req.fast) {
    return translateTextFast({...req, text}, rawText);
  }

  const to = req.to;
  const hintLanguage = req.hint_language?.trim() || '';
  let from = req.from?.trim() || '';

  const slang = expandChatSlang(text, hintLanguage || undefined);
  const workingText = slang.text;

  if (!from) {
    const detectionText = hasMarkdownMarkup(workingText)
      ? stripMarkdownForScoring(workingText)
      : workingText;
    const detectedFrom = await detectLanguage(detectionText || workingText);

    if (isSameLanguage(detectedFrom, to)) {
      return {
        origin: rawText,
        to,
        from: detectedFrom,
        detected_from: detectedFrom,
        translated: rawText,
        engine: 'none',
        reversed: text,
        score: 1,
        semantic_score: 1,
        embedding_score: 1,
        quality_score: 1,
        slang_expanded: slang.expanded || undefined,
        normalized_text: slang.expanded ? workingText : undefined,
      };
    }

    const candidates: ScoredCandidate[] = [];

    if (slang.expanded) {
      candidates.push(await buildCandidate(rawText, workingText, to, ''));
      if (slang.slangLanguage) {
        candidates.push(await buildCandidate(rawText, workingText, to, slang.slangLanguage));
      }
    } else {
      candidates.push(await buildCandidate(rawText, text, to, ''));
    }

    if (text.length <= SHORT_TEXT_MAX && hintLanguage && !isSameLanguage(hintLanguage, detectedFrom)) {
      candidates.push(await buildCandidate(rawText, workingText, to, hintLanguage));
    }

    const best = await pickBestCandidate(candidates);
    return {
      origin: rawText,
      to,
      from: best.from,
      detected_from: best.detectedFrom,
      translated: best.translated,
      engine: best.engine,
      reversed: best.reversed,
      score: best.score,
      semantic_score: best.semantic_score,
      embedding_score: best.embedding_score,
      quality_score: best.quality_score,
      slang_expanded: slang.expanded || undefined,
      normalized_text: slang.expanded ? workingText : undefined,
    };
  }

  if (isSameLanguage(from, to)) {
    return {
      origin: rawText,
      to,
      from,
      detected_from: from,
      translated: rawText,
      engine: 'none',
      reversed: rawText,
      score: 1,
      semantic_score: 1,
      embedding_score: 1,
      quality_score: 1,
      slang_expanded: slang.expanded || undefined,
      normalized_text: slang.expanded ? workingText : undefined,
    };
  }

  const best = await buildCandidate(
    rawText,
    slang.expanded ? workingText : text,
    to,
    from,
  );

  return {
    origin: rawText,
    to,
    from: best.from,
    detected_from: best.detectedFrom,
    translated: best.translated,
    engine: best.engine,
    reversed: best.reversed,
    score: best.score,
    semantic_score: best.semantic_score,
    embedding_score: best.embedding_score,
    quality_score: best.quality_score,
    slang_expanded: slang.expanded || undefined,
    normalized_text: slang.expanded ? workingText : undefined,
  };
}
