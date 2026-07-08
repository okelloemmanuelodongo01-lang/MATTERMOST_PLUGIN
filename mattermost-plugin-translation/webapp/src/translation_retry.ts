import type {Post} from '@mattermost/types/posts';

const MAX_RETRIES = 6;
const retryCounts = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

type RetryHandler = (post: Post) => void;

let retryHandler: RetryHandler | null = null;

export function bindTranslationRetry(handler: RetryHandler) {
    retryHandler = handler;
}

export function clearTranslationRetry(postId: string) {
    retryCounts.delete(postId);
    const timer = retryTimers.get(postId);
    if (timer) {
        clearTimeout(timer);
        retryTimers.delete(postId);
    }
}

export function shouldGiveUpTranslationRetry(postId: string): boolean {
    return (retryCounts.get(postId) || 0) >= MAX_RETRIES;
}

export function schedulePostTranslationRetry(post: Post, delayMs = 2000) {
    if (!post?.id || !retryHandler) {
        return;
    }

    const attempt = retryCounts.get(post.id) || 0;
    if (attempt >= MAX_RETRIES) {
        return;
    }

    retryCounts.set(post.id, attempt + 1);

    const existing = retryTimers.get(post.id);
    if (existing) {
        clearTimeout(existing);
    }

    const waitMs = Math.min(delayMs * (attempt + 1), 12000);
    const timer = setTimeout(() => {
        retryTimers.delete(post.id);
        retryHandler?.(post);
    }, waitMs);

    retryTimers.set(post.id, timer);
}

export function friendlyPluginError(raw: string): string {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();

    if (!trimmed) {
        return 'Translation service is unavailable right now.';
    }
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('504')) {
        return 'Translation service timed out. Retrying automatically…';
    }
    if (lower.includes('unreachable') || lower.includes('network') || lower.includes('failed to fetch')) {
        return 'Could not reach the translation service. Check that translation-api is running.';
    }
    if (trimmed.length > 160) {
        return trimmed.slice(0, 160) + '…';
    }
    return trimmed;
}
