import {fetchWithRetry} from './fetch_retry.js';

export type LanguageOption = {
  code: string;
  name: string;
};

const GOOGLE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim() || '';

export function isGoogleTranslateEnabled(): boolean {
  return GOOGLE_API_KEY.length > 0;
}

function googleErrorMessage(status: number, body: string): string {
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
  return body || `Google Translate API error: HTTP ${status}`;
}

let cachedLanguages: LanguageOption[] | null = null;

export async function listGoogleLanguages(target = 'en'): Promise<LanguageOption[]> {
  if (cachedLanguages) {
    return cachedLanguages;
  }

  const url =
    `https://translation.googleapis.com/language/translate/v2/languages` +
    `?target=${encodeURIComponent(target)}&key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const res = await fetchWithRetry(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(googleErrorMessage(res.status, body));
  }

  const data = JSON.parse(body) as {
    data?: {
      languages?: Array<{language: string; name: string}>;
    };
  };

  cachedLanguages = (data.data?.languages || [])
    .map((entry) => ({
      code: entry.language,
      name: entry.name || entry.language,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return cachedLanguages;
}

export async function detectLanguageWithGoogle(text: string): Promise<string> {
  const res = await fetchWithRetry(
    `https://translation.googleapis.com/language/translate/v2/detect?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({q: text}),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    throw new Error(googleErrorMessage(res.status, body));
  }

  const data = JSON.parse(body) as {
    data?: {
      detections?: Array<Array<{language: string; confidence?: number}>>;
    };
  };

  const detected = data.data?.detections?.[0]?.[0]?.language?.trim();
  if (!detected) {
    throw new Error('Google language detection returned no result');
  }

  return detected;
}

export async function translateWithGoogle(
  text: string,
  from: string,
  to: string,
): Promise<{translated: string; engine: string; detectedFrom?: string}> {
  const [result] = await translateBatchWithGoogle([text], from, to);
  return result;
}

export async function translateBatchWithGoogle(
  texts: string[],
  from: string,
  to: string,
): Promise<Array<{translated: string; engine: string; detectedFrom?: string}>> {
  const filtered = texts.map((text) => text ?? '');
  if (filtered.length === 0) {
    return [];
  }

  const payload: Record<string, unknown> = {
    q: filtered,
    target: to,
    format: 'text',
  };

  if (from && from !== 'auto') {
    payload.source = from;
  }

  const res = await fetchWithRetry(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    throw new Error(googleErrorMessage(res.status, body));
  }

  const data = JSON.parse(body) as {
    data?: {
      translations?: Array<{translatedText?: string; detectedSourceLanguage?: string}>;
    };
  };

  const translations = data.data?.translations || [];
  if (translations.length !== filtered.length) {
    throw new Error('Google Translate batch response size mismatch');
  }

  return translations.map((entry) => {
    const translated = entry.translatedText?.trim();
    if (!translated) {
      throw new Error('Google Translate returned an empty translation');
    }
    return {
      translated,
      engine: 'google-translate',
      detectedFrom: entry.detectedSourceLanguage,
    };
  });
}
