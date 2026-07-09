/**
 * Maps Google Translate-style language codes to Google Speech-to-Text BCP-47 tags.
 * When a user picks any language from the full translation dropdown, we use it here for STT.
 */
const SPEECH_BCP47: Record<string, string> = {
    af: 'af-ZA',
    am: 'am-ET',
    ar: 'ar-SA',
    az: 'az-AZ',
    be: 'be-BY',
    bg: 'bg-BG',
    bn: 'bn-BD',
    bs: 'bs-BA',
    ca: 'ca-ES',
    ceb: 'ceb-PH',
    cs: 'cs-CZ',
    cy: 'cy-GB',
    da: 'da-DK',
    de: 'de-DE',
    el: 'el-GR',
    en: 'en-US',
    eo: 'eo-EO',
    es: 'es-ES',
    et: 'et-EE',
    eu: 'eu-ES',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fil: 'fil-PH',
    fr: 'fr-FR',
    ga: 'ga-IE',
    gl: 'gl-ES',
    gu: 'gu-IN',
    ha: 'ha-NG',
    he: 'he-IL',
    hi: 'hi-IN',
    hr: 'hr-HR',
    ht: 'ht-HT',
    hu: 'hu-HU',
    hy: 'hy-AM',
    id: 'id-ID',
    ig: 'ig-NG',
    is: 'is-IS',
    it: 'it-IT',
    ja: 'ja-JP',
    jv: 'jv-ID',
    ka: 'ka-GE',
    kk: 'kk-KZ',
    km: 'km-KH',
    kn: 'kn-IN',
    ko: 'ko-KR',
    lo: 'lo-LA',
    lt: 'lt-LT',
    lv: 'lv-LV',
    mg: 'mg-MG',
    mi: 'mi-NZ',
    mk: 'mk-MK',
    ml: 'ml-IN',
    mn: 'mn-MN',
    mr: 'mr-IN',
    ms: 'ms-MY',
    mt: 'mt-MT',
    my: 'my-MM',
    ne: 'ne-NP',
    nl: 'nl-NL',
    no: 'nb-NO',
    ny: 'ny-MW',
    pa: 'pa-IN',
    pl: 'pl-PL',
    ps: 'ps-AF',
    pt: 'pt-BR',
    ro: 'ro-RO',
    ru: 'ru-RU',
    sd: 'sd-PK',
    si: 'si-LK',
    sk: 'sk-SK',
    sl: 'sl-SI',
    sm: 'sm-WS',
    sn: 'sn-ZW',
    so: 'so-SO',
    sq: 'sq-AL',
    sr: 'sr-RS',
    st: 'st-ZA',
    su: 'su-ID',
    sv: 'sv-SE',
    sw: 'sw-KE',
    ta: 'ta-IN',
    te: 'te-IN',
    tg: 'tg-TJ',
    th: 'th-TH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    ur: 'ur-PK',
    uz: 'uz-UZ',
    vi: 'vi-VN',
    xh: 'xh-ZA',
    yi: 'yi-DE',
    yo: 'yo-NG',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
    zu: 'zu-ZA',
    lg: 'lg-UG',
};

/**
 * Languages Google Translate supports but Google Speech V1 (latest_long/latest_short) does not.
 * These use Whisper for STT instead. Luganda is V2/chirp_2 only on Google.
 */
export const WHISPER_PREFERRED_STT_BASES = new Set([
    'lg', // Luganda
    'ln', // Lingala
    'ha', // Hausa
    'yo', // Yoruba
    'ig', // Igbo
    'sn', // Shona
    'ny', // Chichewa
    'mg', // Malagasy
    'ceb', // Cebuano
    'haw', // Hawaiian
    'mi', // Maori
    'sm', // Samoan
]);

export function isWhisperPreferredStt(languageCode?: string): boolean {
    const base = normalizeSpeechLanguageCode(languageCode);
    return base !== '' && WHISPER_PREFERRED_STT_BASES.has(base);
}

export function filterGoogleSpeechCandidates(codes: string[]): string[] {
    return codes.filter((code) => !isWhisperPreferredStt(code));
}

export function toSpeechBcp47(languageCode?: string): string | undefined {
    const raw = (languageCode || '').trim().toLowerCase();
    if (!raw) {
        return undefined;
    }

    if (SPEECH_BCP47[raw]) {
        return SPEECH_BCP47[raw];
    }

    if (raw.includes('-')) {
        const [lang, region] = raw.split('-');
        if (SPEECH_BCP47[lang]) {
            return SPEECH_BCP47[lang];
        }
        return `${lang}-${region.toUpperCase()}`;
    }

    const base = raw.slice(0, 2);
    if (SPEECH_BCP47[base]) {
        return SPEECH_BCP47[base];
    }

    return undefined;
}

/** ISO 639-1 code for Whisper forced-language mode. */
export function toWhisperLanguage(languageCode?: string): string | undefined {
    const raw = (languageCode || '').trim().toLowerCase();
    if (!raw) {
        return undefined;
    }
    if (raw.includes('-')) {
        return raw.split('-')[0];
    }
    return raw.slice(0, 2);
}

export const GOOGLE_SPEECH_SYNC_MAX_SECONDS = 58;

export function normalizeSpeechLanguageCode(code?: string): string {
  const raw = (code || '').trim().toLowerCase();
  if (!raw || raw === 'auto') {
    return '';
  }
  return raw.split(/[-_]/)[0];
}
