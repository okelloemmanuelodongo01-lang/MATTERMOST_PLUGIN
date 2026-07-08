import type {TranslationRecord} from '../reducer';

const GOOGLE_TRANSLATE_URL = 'https://translate.google.com/';

function normalizeLangCode(code: string): string {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed || trimmed === 'auto') {
        return 'auto';
    }
    return trimmed.split(/[-_]/)[0];
}

export function buildGoogleTranslateUrl(record: TranslationRecord): string {
    const source = normalizeLangCode(record.detectedFrom || record.from || 'auto');
    const target = normalizeLangCode(record.to || 'en');
    const sourceText = (record.origin || '').trim().slice(0, 1800);

    const params = new URLSearchParams({
        sl: source,
        tl: target,
        op: 'translate',
    });

    if (sourceText) {
        params.set('text', sourceText);
    }

    return `${GOOGLE_TRANSLATE_URL}?${params.toString()}`;
}

export function usesGoogleTranslate(record: TranslationRecord): boolean {
    const engine = record.engine.toLowerCase();
    return engine.includes('google') || engine.includes('google-translate');
}
