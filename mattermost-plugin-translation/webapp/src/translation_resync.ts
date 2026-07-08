import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import {INVALIDATE_CHANNEL_TRANSLATIONS} from './reducer';

let storeRef: Store<GlobalState> | null = null;
let syncChannelFn: ((channelId: string) => Promise<void>) | null = null;

export function bindTranslationResync(
    store: Store<GlobalState>,
    syncChannel: (channelId: string) => Promise<void>,
) {
    storeRef = store;
    syncChannelFn = syncChannel;
}

export async function resyncCurrentChannelTranslations(channelId: string, postIds: string[]) {
    if (!storeRef || !channelId || !syncChannelFn) {
        return;
    }

    if (postIds.length > 0) {
        storeRef.dispatch({
            type: INVALIDATE_CHANNEL_TRANSLATIONS,
            postIds,
        });
    }

    await syncChannelFn(channelId);
}
