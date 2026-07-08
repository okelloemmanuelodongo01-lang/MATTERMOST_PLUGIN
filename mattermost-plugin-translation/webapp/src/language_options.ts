const API_BASE = '/plugins/com.transchecker.translation/api/v1';

export type LanguageOption = {
    value: string;
    label: string;
};

export const FALLBACK_LANGUAGE_OPTIONS: LanguageOption[] = [
    {value: 'en', label: 'English'},
    {value: 'fr', label: 'French'},
    {value: 'ja', label: 'Japanese'},
    {value: 'lg', label: 'Luganda'},
];

let cachedLanguageOptions: LanguageOption[] | null = null;

export function getLanguageLabel(code: string): string {
    const normalized = code.trim().toLowerCase().split(/[-_]/)[0];
    const match = (cachedLanguageOptions || FALLBACK_LANGUAGE_OPTIONS).find(
        (option) => option.value.toLowerCase() === normalized,
    );
    return match?.label || code.toUpperCase();
}

export async function fetchLanguageOptions(): Promise<LanguageOption[]> {
    if (cachedLanguageOptions) {
        return cachedLanguageOptions;
    }

    try {
        const response = await fetch(`${API_BASE}/languages`, {
            credentials: 'same-origin',
            headers: {'X-Requested-With': 'XMLHttpRequest'},
        });

        if (!response.ok) {
            throw new Error('Could not load languages');
        }

        const data = await response.json() as {
            languages: Array<{code: string; name: string}>;
        };

        const options = (data.languages || [])
            .map((language) => ({
                value: language.code,
                label: language.name || language.code,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        if (options.length > 0) {
            cachedLanguageOptions = options;
            return options;
        }
    } catch {
        // use fallback
    }

    cachedLanguageOptions = FALLBACK_LANGUAGE_OPTIONS;
    return FALLBACK_LANGUAGE_OPTIONS;
}
