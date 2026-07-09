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

const MIN_FULL_LANGUAGE_COUNT = 20;
const FETCH_RETRY_DELAYS_MS = [0, 1500, 4000];

let cachedLanguageOptions: LanguageOption[] | null = null;
let fetchInFlight: Promise<LanguageOption[]> | null = null;

export function isPartialLanguageList(options: LanguageOption[]): boolean {
    return options.length > 0 && options.length < MIN_FULL_LANGUAGE_COUNT;
}

export function getCachedLanguageOptions(): LanguageOption[] | null {
    if (cachedLanguageOptions && isPartialLanguageList(cachedLanguageOptions)) {
        return null;
    }
    return cachedLanguageOptions;
}

export function clearCachedLanguageOptions(): void {
    cachedLanguageOptions = null;
    fetchInFlight = null;
}

export function getLanguageLabel(code: string): string {
    const normalized = code.trim().toLowerCase().split(/[-_]/)[0];
    const match = (getCachedLanguageOptions() || FALLBACK_LANGUAGE_OPTIONS).find(
        (option) => option.value.toLowerCase() === normalized,
    );
    return match?.label || code.toUpperCase();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function fetchLanguageOptionsOnce(): Promise<LanguageOption[]> {
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

    if (options.length === 0 || isPartialLanguageList(options)) {
        throw new Error('Incomplete language list');
    }

    return options;
}

export async function fetchLanguageOptions(options?: {force?: boolean}): Promise<LanguageOption[]> {
    if (!options?.force && cachedLanguageOptions && !isPartialLanguageList(cachedLanguageOptions)) {
        return cachedLanguageOptions;
    }

    if (!options?.force && fetchInFlight) {
        return fetchInFlight;
    }

    fetchInFlight = (async () => {
        let lastError: unknown;

        for (const delayMs of FETCH_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
                await sleep(delayMs);
            }

            try {
                const loaded = await fetchLanguageOptionsOnce();
                cachedLanguageOptions = loaded;
                return loaded;
            } catch (error) {
                lastError = error;
            }
        }

        if (cachedLanguageOptions && !isPartialLanguageList(cachedLanguageOptions)) {
            return cachedLanguageOptions;
        }

        throw lastError instanceof Error ? lastError : new Error('Could not load languages');
    })();

    try {
        return await fetchInFlight;
    } catch {
        return FALLBACK_LANGUAGE_OPTIONS;
    } finally {
        fetchInFlight = null;
    }
}
