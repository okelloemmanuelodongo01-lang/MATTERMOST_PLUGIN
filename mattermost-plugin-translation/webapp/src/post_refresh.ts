import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import {receivedPost} from 'mattermost-redux/actions/posts';

import {getPost} from 'mattermost-redux/selectors/entities/posts';

import {isCollapsedThreadsEnabled} from 'mattermost-redux/selectors/entities/preferences';

import {getPluginState} from './reducer';
import {scheduleInlineTranslationToggleSync, toggleTranslationDetails} from './inline_translation_toggle';

let storeRef: Store<GlobalState> | null = null;
const lastRefreshedPostSignature = new Map<string, string>();

export function bindTranslationStore(store: Store<GlobalState>) {
    storeRef = store;
}

export function toggleShowOriginal(postId: string) {
    if (!storeRef || !postId) {
        return;
    }

    toggleTranslationDetails(storeRef, postId);
}

function translationRefreshSignature(store: Store<GlobalState>, postId: string): string {
    const pluginState = getPluginState(store.getState() as Record<string, unknown>);
    const record = pluginState.byPostId[postId];
    const summary = pluginState.authorSummaryByPostId[postId];
    const expanded = Boolean(pluginState.showOriginalByPostId[postId]);

    return [
        record?.loading ? '1' : '0',
        record?.error || '',
        record?.translated || '',
        record?.sameLanguage ? '1' : '0',
        summary?.loading ? '1' : '0',
        summary?.languages?.length || 0,
        expanded ? '1' : '0',
    ].join(':');
}

function postRefreshSignature(post: Post): string {
    return `${post.update_at || post.create_at || 0}:${post.message || ''}`;
}

function shouldRefreshPostMessage(store: Store<GlobalState>, post: Post): boolean {
    const currentUserId = store.getState().entities?.users?.currentUserId || '';
    if (currentUserId && post.user_id === currentUserId) {
        return false;
    }

    const pluginState = getPluginState(store.getState() as Record<string, unknown>);
    const record = pluginState.byPostId[post.id];
    return Boolean(record && (record.loading || record.translated || record.error));
}

function dispatchPostRefresh(store: Store<GlobalState>, post: Post, force = false) {
    const signature = `${postRefreshSignature(post)}:${translationRefreshSignature(store, post.id)}`;
    if (!force) {
        const previous = lastRefreshedPostSignature.get(post.id);
        if (previous === signature) {
            return;
        }
    }
    lastRefreshedPostSignature.set(post.id, signature);

    if (!shouldRefreshPostMessage(store, post)) {
        return;
    }

    const crtEnabled = isCollapsedThreadsEnabled(store.getState());
    const refreshPost: Post = {
        ...post,
        update_at: Math.max(post.update_at || 0, Date.now()),
    };
    store.dispatch(receivedPost(refreshPost, crtEnabled));
}

export function refreshPostsInUI(
    store: Store<GlobalState>,
    postIds: string[],
    knownPosts: Record<string, Post> = {},
    force = false,
) {
    const missing: string[] = [];

    for (const postId of postIds) {
        const state = store.getState();
        const post = getPost(state, postId) || knownPosts[postId];
        if (post) {
            dispatchPostRefresh(store, post, force);
        } else {
            missing.push(postId);
        }
    }

    if (missing.length > 0) {
        window.setTimeout(() => {
            for (const postId of missing) {
                const state = store.getState();
                const post = getPost(state, postId) || knownPosts[postId];
                if (post) {
                    dispatchPostRefresh(store, post, force);
                }
            }
        }, 300);
    }

    if (postIds.length === 1) {
        scheduleInlineTranslationToggleSync(store, postIds[0]);
    } else if (postIds.length > 0) {
        scheduleInlineTranslationToggleSync(store);
    }
}
