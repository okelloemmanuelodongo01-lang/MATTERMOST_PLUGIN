import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import {
    AUTHOR_SUMMARY_ERROR,
    AUTHOR_SUMMARY_LOADING,
    AUTHOR_SUMMARY_SUCCESS,
    type AuthorDeliverySummary,
    type TranslationState,
} from './reducer';
import {friendlyPluginError} from './translation_retry';
import {getPostTranslationSourceText} from './voice_post_utils';

const PLUGIN_ID = 'com.transchecker.translation';
const API_BASE = `/plugins/${PLUGIN_ID}/api/v1`;
const REQUEST_TIMEOUT_MS = 120000;
const STALE_LOADING_MS = 15000;

let storeRef: Store<GlobalState> | null = null;
const inFlight = new Set<string>();
const retryCounts = new Map<string, number>();
const loadingStartedAt = new Map<string, number>();
const MAX_RETRIES = 5;

export function bindAuthorSummaryStore(store: Store<GlobalState>) {
    storeRef = store;
}

export function isAuthorSummaryStale(postId: string): boolean {
    const started = loadingStartedAt.get(postId);
    if (!started) {
        return false;
    }
    return Date.now() - started >= STALE_LOADING_MS;
}

export function noteAuthorSummaryReceived(postId: string) {
    loadingStartedAt.delete(postId);
    retryCounts.delete(postId);
    inFlight.delete(postId);
}

export function recoverStaleAuthorSummaries(
    store: Store<GlobalState>,
    posts: Post[],
    pluginState: TranslationState,
) {
    const currentUserId = store.getState().entities?.users?.currentUserId || '';
    if (!currentUserId) {
        return;
    }

    for (const post of posts) {
        if (post.user_id !== currentUserId) {
            continue;
        }
        if (!pluginState.showOriginalByPostId[post.id]) {
            continue;
        }
        const summary = pluginState.authorSummaryByPostId[post.id];
        if (!summary?.loading || !isAuthorSummaryStale(post.id)) {
            continue;
        }
        void fetchAuthorSummary(post.id, {
            force: true,
            text: getPostTranslationSourceText(post) || post.message || '',
            channelId: post.channel_id || '',
        });
    }
}

function summaryFromPayload(data: Record<string, unknown>): AuthorDeliverySummary {
    const languagesRaw = (() => {
        if (Array.isArray(data.languages) && data.languages.length > 0) {
            return data.languages;
        }
        const rawJSON = data.languages_json;
        if (typeof rawJSON === 'string' && rawJSON.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(rawJSON);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    })();
    const languages = languagesRaw.map((entry) => {
        const lang = entry as Record<string, string | number | boolean>;
        return {
            language: String(lang.to || ''),
            translated: String(lang.translated || ''),
            reversed: String(lang.reversed || ''),
            from: String(lang.from || ''),
            detectedFrom: String(lang.detected_from || ''),
            engine: String(lang.engine || ''),
            score: Number(lang.score || 0),
            semanticScore: Number(lang.semantic_score || 0),
            embeddingScore: Number(lang.embedding_score || 0),
            qualityScore: Number(lang.quality_score || 0),
            cached: Boolean(lang.cached),
            sameLanguage: Boolean(lang.same_language),
            readerCount: Number(lang.reader_count || 0),
        };
    });

    return {
        postId: String(data.post_id || ''),
        origin: String(data.origin || ''),
        from: String(data.from || ''),
        detectedFrom: String(data.detected_from || ''),
        recipientCount: Number(data.recipient_count || 0),
        languageCount: Number(data.language_count || languages.length),
        languages,
        loading: false,
    };
}

async function parseSummaryResponse(response: Response): Promise<AuthorDeliverySummary> {
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    if (!response.ok) {
        if (raw.trim().startsWith('{')) {
            try {
                const json = JSON.parse(raw) as {error?: string};
                if (json.error) {
                    throw new Error(friendlyPluginError(json.error));
                }
            } catch (error) {
                if (error instanceof Error && error.message !== raw) {
                    throw error;
                }
            }
        }
        throw new Error(friendlyPluginError(raw || `Could not load delivery summary (${response.status})`));
    }

    if (!contentType.includes('application/json') && !raw.trim().startsWith('{')) {
        throw new Error(friendlyPluginError(raw || 'Invalid delivery summary response'));
    }

    const data = JSON.parse(raw) as Record<string, unknown>;
    return summaryFromPayload(data);
}

function scheduleAuthorSummaryRetry(postId: string) {
    const attempt = retryCounts.get(postId) || 0;
    if (attempt >= MAX_RETRIES) {
        return;
    }

    retryCounts.set(postId, attempt + 1);
    window.setTimeout(() => {
        void fetchAuthorSummary(postId);
    }, 2000 * (attempt + 1));
}

type FetchAuthorSummaryOptions = {
    force?: boolean;
    text?: string;
    channelId?: string;
};

async function fetchAuthorSummaryRequest(
    postId: string,
    signal: AbortSignal,
    options?: FetchAuthorSummaryOptions,
): Promise<AuthorDeliverySummary> {
    const response = await fetch(`${API_BASE}/author-summary`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            post_id: postId,
            text: options?.text || '',
            channel_id: options?.channelId || '',
        }),
        signal,
    });

    return parseSummaryResponse(response);
}

export async function fetchAuthorSummary(postId: string, options?: FetchAuthorSummaryOptions): Promise<void> {
    if (!storeRef || !postId) {
        return;
    }

    if (inFlight.has(postId) && !options?.force) {
        return;
    }

    inFlight.add(postId);
    loadingStartedAt.set(postId, Date.now());
    storeRef.dispatch({type: AUTHOR_SUMMARY_LOADING, postId});

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const summary = await fetchAuthorSummaryRequest(postId, controller.signal, options);
        if (summary.languages.length === 0) {
            throw new Error('No reader languages found for this channel');
        }

        retryCounts.delete(postId);
        loadingStartedAt.delete(postId);
        storeRef.dispatch({type: AUTHOR_SUMMARY_SUCCESS, summary});
    } catch (error) {
        const message = error instanceof Error
            ? (error.name === 'AbortError' ? 'Delivery summary timed out. Tap the chevron to retry.' : error.message)
            : 'Could not load delivery summary';
        const attempt = retryCounts.get(postId) || 0;

        if (attempt < MAX_RETRIES) {
            scheduleAuthorSummaryRetry(postId);
            return;
        }

        loadingStartedAt.delete(postId);
        storeRef.dispatch({type: AUTHOR_SUMMARY_ERROR, postId, error: message});
    } finally {
        clearTimeout(timeout);
        inFlight.delete(postId);
    }
}
