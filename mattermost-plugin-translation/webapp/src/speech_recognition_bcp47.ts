/** BCP-47 tags for browser SpeechRecognition (live preview only — server STT is authoritative). */
const SPEECH_RECOGNITION_BCP47: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    ja: 'ja-JP',
    ar: 'ar-SA',
    sw: 'sw-KE',
    de: 'de-DE',
    es: 'es-ES',
    pt: 'pt-BR',
    it: 'it-IT',
    nl: 'nl-NL',
    pl: 'pl-PL',
    ru: 'ru-RU',
    tr: 'tr-TR',
    vi: 'vi-VN',
    id: 'id-ID',
    hi: 'hi-IN',
    ko: 'ko-KR',
    zh: 'zh-CN',
    lg: 'lg-UG',
    ha: 'ha-NG',
    yo: 'yo-NG',
    am: 'am-ET',
};

export function toSpeechRecognitionLang(languageCode?: string): string {
    const raw = (languageCode || '').trim().toLowerCase();
    if (!raw) {
        return typeof navigator !== 'undefined' ? (navigator.language || 'en-US') : 'en-US';
    }
    if (SPEECH_RECOGNITION_BCP47[raw]) {
        return SPEECH_RECOGNITION_BCP47[raw];
    }
    if (raw.includes('-')) {
        const [lang, region] = raw.split('-');
        return `${lang}-${region.toUpperCase()}`;
    }
    return `${raw}-${raw.toUpperCase()}`;
}

export const SPEAKING_LANGUAGE_STORAGE_KEY = 'translation_speaking_language';

export function loadSpeakingLanguage(fallback = 'en'): string {
    if (typeof window === 'undefined') {
        return fallback;
    }
    try {
        const saved = window.localStorage.getItem(SPEAKING_LANGUAGE_STORAGE_KEY);
        if (saved?.trim()) {
            return saved.trim().toLowerCase();
        }
    } catch {
        // ignore
    }
    return fallback;
}

export function saveSpeakingLanguage(code: string): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(SPEAKING_LANGUAGE_STORAGE_KEY, code.trim().toLowerCase());
    } catch {
        // ignore
    }
}
