import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import {INVALIDATE_CHANNEL_TRANSLATIONS} from './reducer';

let storeRef: Store<GlobalState> | null = null;
let syncChannelFn: ((channelId: string) => Promise<void>) | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResync: {channelId: string; postIds: string[]} | null = null;

export function bindTranslationResync(
    store: Store<GlobalState>,
    syncChannel: (channelId: string) => Promise<void>,
) {
    storeRef = store;
    syncChannelFn = syncChannel;
}

function flushPendingResync() {
    const pending = pendingResync;
    pendingResync = null;
    resyncTimer = null;

    if (!pending || !storeRef || !syncChannelFn) {
        return;
    }

    if (pending.postIds.length > 0) {
        storeRef.dispatch({
            type: INVALIDATE_CHANNEL_TRANSLATIONS,
            postIds: pending.postIds,
        });
    }

    void syncChannelFn(pending.channelId);
}

export function resyncCurrentChannelTranslations(channelId: string, postIds: string[]) {
    if (!storeRef || !channelId || !syncChannelFn) {
        return;
    }

    const mergedPostIds = pendingResync?.channelId === channelId
        ? [...new Set([...pendingResync.postIds, ...postIds])]
        : postIds;

    pendingResync = {channelId, postIds: mergedPostIds};

    if (resyncTimer) {
        clearTimeout(resyncTimer);
    }

    resyncTimer = setTimeout(flushPendingResync, 200);
}
