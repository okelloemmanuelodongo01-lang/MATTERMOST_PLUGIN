import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import {scheduleInlineTranslationToggleSync} from './inline_translation_toggle';

/**
 * Live translation display is handled by registerMessageWillFormatHook + receivedPost refresh.
 * Direct DOM edits to .post-message__text caused duplicate paragraphs when Mattermost
 * already rendered multiple <p> nodes from the original markdown.
 */
export function syncTranslatedPostMessage(store: Store<GlobalState>, postId: string) {
    if (!postId) {
        return;
    }
    scheduleInlineTranslationToggleSync(store, postId);
}

export function syncTranslatedPostMessages(store: Store<GlobalState>, postIds: string[]) {
    for (const postId of postIds) {
        syncTranslatedPostMessage(store, postId);
    }
}
