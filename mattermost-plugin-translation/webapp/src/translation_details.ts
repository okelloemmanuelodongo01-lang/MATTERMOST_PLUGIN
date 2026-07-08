import type {Post} from '@mattermost/types/posts';

let ensureDetailsFn: ((post: Post) => void) | null = null;

export function bindTranslationDetailsLoader(fn: (post: Post) => void) {
    ensureDetailsFn = fn;
}

export function ensurePostTranslationDetails(post: Post) {
    if (!post?.id) {
        return;
    }

    ensureDetailsFn?.(post);
}
