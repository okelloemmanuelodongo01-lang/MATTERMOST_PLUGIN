/**
 * Mattermost / Slack-style markup preservation for translation.
 * TransChecker-style idea: separate structure from translatable text,
 * translate text segments via Google Translate, then reassemble markup.
 */

export type MarkdownSegment =
  | {kind: 'text'; value: string}
  | {kind: 'literal'; value: string}
  | {kind: 'link'; text: string; url: string; image: boolean}
  | {kind: 'formatted'; open: string; close: string; inner: string};

const SPECIAL_CHARS = /[`*_[\]!@#:~]/;

type TokenMatch = {
  length: number;
  segment: MarkdownSegment;
};

function tryMatchToken(input: string): TokenMatch | null {
  const patterns: Array<{regex: RegExp; build: (m: RegExpMatchArray) => MarkdownSegment}> = [
    {
      regex: /^```[\s\S]*?```/,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
    {
      regex: /^`[^`\n]+`/,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
    {
      regex: /^!\[([^\]]*)\]\(([^)]+)\)/,
      build: (m) => ({kind: 'link', text: m[1], url: m[2], image: true}),
    },
    {
      regex: /^\[([^\]]+)\]\(([^)]+)\)/,
      build: (m) => ({kind: 'link', text: m[1], url: m[2], image: false}),
    },
    {
      regex: /^\*\*([^*\n]+)\*\*/,
      build: (m) => ({kind: 'formatted', open: '**', close: '**', inner: m[1]}),
    },
    {
      regex: /^__([^_\n]+)__/,
      build: (m) => ({kind: 'formatted', open: '__', close: '__', inner: m[1]}),
    },
    {
      regex: /^~~([^~\n]+)~~/,
      build: (m) => ({kind: 'formatted', open: '~~', close: '~~', inner: m[1]}),
    },
    {
      regex: /^(?<!\*)\*([^*\n]+)\*(?!\*)/,
      build: (m) => ({kind: 'formatted', open: '*', close: '*', inner: m[1]}),
    },
    {
      regex: /^(?<!_)_([^_\n]+)_(?!_)/,
      build: (m) => ({kind: 'formatted', open: '_', close: '_', inner: m[1]}),
    },
    {
      regex: /^#{1,6}\s+[^\n]+/,
      build: (m) => {
        const match = m[0].match(/^(#{1,6}\s+)(.+)$/);
        return {
          kind: 'formatted',
          open: match?.[1] || '',
          close: '',
          inner: match?.[2] || m[0],
        };
      },
    },
    {
      regex: /^>\s+[^\n]+/,
      build: (m) => {
        const match = m[0].match(/^(>\s+)(.+)$/);
        return {
          kind: 'formatted',
          open: match?.[1] || '> ',
          close: '',
          inner: match?.[2] || m[0],
        };
      },
    },
    {
      regex: /^@[\w.-]+/,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
    {
      regex: /^~[\w.-]+/,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
    {
      regex: /^#[\w.-]+/,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
    {
      regex: /^:[a-z0-9_+-]+:/i,
      build: (m) => ({kind: 'literal', value: m[0]}),
    },
  ];

  for (const {regex, build} of patterns) {
    const match = input.match(regex);
    if (match) {
      return {length: match[0].length, segment: build(match)};
    }
  }

  return null;
}

function nextSpecialIndex(input: string): number {
  const match = input.search(SPECIAL_CHARS);
  return match === -1 ? input.length : match;
}

export function hasMarkdownMarkup(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  let pos = 0;
  while (pos < text.length) {
    const token = tryMatchToken(text.slice(pos));
    if (token) {
      return true;
    }
    const jump = nextSpecialIndex(text.slice(pos));
    pos += jump > 0 ? jump : 1;
  }
  return false;
}

export function splitMarkdownSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let pos = 0;

  while (pos < text.length) {
    const rest = text.slice(pos);
    const token = tryMatchToken(rest);
    if (token) {
      segments.push(token.segment);
      pos += token.length;
      continue;
    }

    const jump = nextSpecialIndex(rest);
    if (jump === 0) {
      const nextToken = tryMatchToken(rest.slice(1));
      if (!nextToken) {
        const existing = segments[segments.length - 1];
        if (existing?.kind === 'text') {
          existing.value += rest[0];
        } else {
          segments.push({kind: 'text', value: rest[0]});
        }
        pos += 1;
        continue;
      }
    }

    const chunk = rest.slice(0, jump || rest.length);
    if (chunk) {
      const existing = segments[segments.length - 1];
      if (existing?.kind === 'text') {
        existing.value += chunk;
      } else {
        segments.push({kind: 'text', value: chunk});
      }
    }
    pos += jump || rest.length;
  }

  if (segments.length === 0) {
    segments.push({kind: 'text', value: text});
  }

  return segments;
}

export function joinMarkdownSegments(segments: MarkdownSegment[]): string {
  let result = '';

  for (const segment of segments) {
    const piece = renderMarkdownSegment(segment);
    if (!piece) {
      continue;
    }
    if (result && shouldInsertSpaceBetween(result, piece)) {
      result += ' ';
    }
    result += piece;
  }

  return result;
}

/** Re-parse translated markup and re-join with spacing rules (fixes glued bold/link text). */
export function repairTranslatedMarkup(text: string): string {
  if (!hasMarkdownMarkup(text)) {
    return text;
  }
  return joinMarkdownSegments(splitMarkdownSegments(text));
}

/** Messages with only plain text + inline code — best translated as one Google call. */
export function isInlineCodeOnlyMessage(text: string): boolean {
  const segments = splitMarkdownSegments(text);
  const hasInlineCode = segments.some(
    (segment) => segment.kind === 'literal' && segment.value.startsWith('`') && !segment.value.startsWith('```'),
  );
  if (!hasInlineCode) {
    return false;
  }
  return segments.every((segment) => segment.kind === 'text' || segment.kind === 'literal');
}

function extractLinkUrls(text: string): string[] {
  return splitMarkdownSegments(text)
    .filter((segment): segment is Extract<MarkdownSegment, {kind: 'link'}> => segment.kind === 'link')
    .map((segment) => segment.url);
}

function extractLiteralTokens(text: string): string[] {
  return splitMarkdownSegments(text)
    .filter((segment) => segment.kind === 'literal')
    .map((segment) => segment.value);
}

/** Verify Google whole-message output still contains URLs, code tokens, and bold markers. */
export function markupStructurePreserved(source: string, translated: string): boolean {
  for (const url of extractLinkUrls(source)) {
    if (!translated.includes(url)) {
      return false;
    }
  }

  for (const literal of extractLiteralTokens(source)) {
    if (!translated.includes(literal)) {
      return false;
    }
  }

  const sourceBoldMarkers = (source.match(/\*\*/g) || []).length;
  const translatedBoldMarkers = (translated.match(/\*\*/g) || []).length;
  if (sourceBoldMarkers > 0 && sourceBoldMarkers !== translatedBoldMarkers) {
    return false;
  }

  return true;
}

function renderMarkdownSegment(segment: MarkdownSegment): string {
  if (segment.kind === 'text' || segment.kind === 'literal') {
    return segment.value;
  }
  if (segment.kind === 'link') {
    const prefix = segment.image ? '!' : '';
    return `${prefix}[${segment.text}](${segment.url})`;
  }
  return `${segment.open}${segment.inner}${segment.close}`;
}

function shouldInsertSpaceBetween(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }

  const last = left[left.length - 1];
  const first = right[0];
  if (/\s/.test(last) || /\s/.test(first)) {
    return false;
  }

  if (/[.,!?;:'"')\]}>]/.test(first)) {
    return false;
  }

  const wordChar = /[\p{L}\p{N}'’]/u;
  const opensMarkup = /[*[\(`_~]/.test(first);

  if (wordChar.test(last) && opensMarkup) {
    return true;
  }

  if (last === '*' && wordChar.test(first)) {
    return true;
  }

  if (last === '`' && wordChar.test(first)) {
    return true;
  }

  if (wordChar.test(last) && first === '`') {
    return true;
  }

  if (last === ']' && first === '(') {
    return false;
  }

  return false;
}

function segmentPlainText(segment: MarkdownSegment): string {
  if (segment.kind === 'text' || segment.kind === 'literal') {
    return segment.kind === 'text' ? segment.value : '';
  }
  if (segment.kind === 'link') {
    return segment.text;
  }
  return segment.inner;
}

export function stripMarkdownForScoring(text: string): string {
  return splitMarkdownSegments(text)
    .map(segmentPlainText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function collectTranslatableStrings(segments: MarkdownSegment[]): string[] {
  const values: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text' && segment.value) {
      values.push(segment.value);
    } else if (segment.kind === 'link' && segment.text.trim()) {
      values.push(segment.text);
    } else if (segment.kind === 'formatted' && segment.inner.trim()) {
      values.push(segment.inner);
    }
  }
  return values;
}

function splitTranslatableChunk(text: string): {prefix: string; core: string; suffix: string} {
  const prefixMatch = text.match(/^\s*/);
  const suffixMatch = text.match(/\s*$/);
  const prefix = prefixMatch?.[0] ?? '';
  const suffix = suffixMatch?.[0] ?? '';
  const core = text.slice(prefix.length, Math.max(prefix.length, text.length - suffix.length));
  return {prefix, core, suffix};
}

function reassembleChunk(prefix: string, translatedCore: string, suffix: string): string {
  return `${prefix}${translatedCore}${suffix}`;
}

type ChunkJob = {
  segmentIndex: number;
  chunkIndex: number;
  prefix: string;
  suffix: string;
  whitespaceOnly: boolean;
  original: string;
};

function chunkFromRaw(segmentIndex: number, raw: string, jobs: ChunkJob[], chunks: string[]): void {
  const {prefix, core, suffix} = splitTranslatableChunk(raw);
  if (!core) {
    jobs.push({
      segmentIndex,
      chunkIndex: -1,
      prefix,
      suffix,
      whitespaceOnly: true,
      original: raw,
    });
    return;
  }

  jobs.push({
    segmentIndex,
    chunkIndex: chunks.length,
    prefix,
    suffix,
    whitespaceOnly: false,
    original: raw,
  });
  chunks.push(core);
}

function applyChunkTranslation(
  segment: MarkdownSegment,
  translatedCore: string,
  prefix: string,
  suffix: string,
): void {
  const value = reassembleChunk(prefix, translatedCore, suffix);
  if (segment.kind === 'text') {
    segment.value = value;
  } else if (segment.kind === 'link') {
    segment.text = value;
  } else if (segment.kind === 'formatted') {
    segment.inner = value;
  }
}

type TranslateSegmentFn = (core: string) => Promise<string>;

async function translateChunkCore(
  raw: string,
  translateSegment: TranslateSegmentFn,
): Promise<string> {
  const {prefix, core, suffix} = splitTranslatableChunk(raw);
  if (!core) {
    return raw;
  }
  const translatedCore = await translateSegment(core);
  return reassembleChunk(prefix, translatedCore, suffix);
}

export async function translatePreservingMarkup(
  text: string,
  translateSegment: TranslateSegmentFn,
): Promise<string> {
  const segments = splitMarkdownSegments(text);
  const translated: MarkdownSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === 'literal') {
      translated.push(segment);
      continue;
    }

    if (segment.kind === 'link') {
      if (!segment.text) {
        translated.push(segment);
        continue;
      }
      translated.push({
        ...segment,
        text: await translateChunkCore(segment.text, translateSegment),
      });
      continue;
    }

    if (segment.kind === 'formatted') {
      if (!segment.inner) {
        translated.push(segment);
        continue;
      }
      translated.push({
        ...segment,
        inner: await translateChunkCore(segment.inner, translateSegment),
      });
      continue;
    }

    if (!segment.value) {
      translated.push(segment);
      continue;
    }

    translated.push({
      kind: 'text',
      value: await translateChunkCore(segment.value, translateSegment),
    });
  }

  return repairTranslatedMarkup(joinMarkdownSegments(translated));
}

export async function translatePreservingMarkupBatch(
  text: string,
  translateBatch: (chunks: string[]) => Promise<string[]>,
): Promise<string> {
  const segments = splitMarkdownSegments(text);
  const jobs: ChunkJob[] = [];
  const chunks: string[] = [];

  segments.forEach((segment, segmentIndex) => {
    if (segment.kind === 'text' && segment.value) {
      chunkFromRaw(segmentIndex, segment.value, jobs, chunks);
      return;
    }
    if (segment.kind === 'link' && segment.text) {
      chunkFromRaw(segmentIndex, segment.text, jobs, chunks);
      return;
    }
    if (segment.kind === 'formatted' && segment.inner) {
      chunkFromRaw(segmentIndex, segment.inner, jobs, chunks);
    }
  });

  if (chunks.length === 0) {
    return text;
  }

  const translatedChunks = await translateBatch(chunks);
  const output = segments.map((segment) => ({...segment}));

  for (const job of jobs) {
    const segment = output[job.segmentIndex];
    if (job.whitespaceOnly) {
      continue;
    }

    const translatedCore = translatedChunks[job.chunkIndex] ?? '';
    applyChunkTranslation(segment, translatedCore, job.prefix, job.suffix);
  }

  return repairTranslatedMarkup(joinMarkdownSegments(output));
}
