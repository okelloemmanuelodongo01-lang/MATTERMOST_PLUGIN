import React, {useEffect} from 'react';
import {connect} from 'react-redux';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {fetchAuthorSummary} from '../author_summary_client';
import {getPluginState, type AuthorDeliverySummary} from '../reducer';
import {getPostTranslationSourceText} from '../voice_post_utils';
import TranslationAuthorDelivery from './translation_author_delivery';

type Props = {
    post: Post;
    authorSummary?: AuthorDeliverySummary;
    isAuthor: boolean;
    showDetails: boolean;
};

function MediaAuthorPanelInner({post, authorSummary, isAuthor, showDetails}: Props) {
    const transcript = getPostTranslationSourceText(post);

    useEffect(() => {
        if (!isAuthor || !post.id || !showDetails) {
            return;
        }
        if (!transcript) {
            return;
        }
        if (!authorSummary || authorSummary.error || authorSummary.languages.length === 0) {
            void fetchAuthorSummary(post.id, {
                text: transcript,
                channelId: post.channel_id || '',
            });
        }
    }, [authorSummary, isAuthor, post.channel_id, post.id, showDetails, transcript]);

    if (!isAuthor || !showDetails) {
        return null;
    }

    if (!transcript) {
        return (
            <div className='translation-panel translation-attachment translation-attachment--author'>
                <span className='translation-panel__meta'>
                    Delivery details appear after readers translate your recording.
                </span>
            </div>
        );
    }

    if (!authorSummary || authorSummary.loading) {
        return (
            <div className='translation-panel translation-attachment translation-attachment--author'>
                <span className='translation-panel__meta'>Checking delivery to readers…</span>
            </div>
        );
    }

    if (authorSummary.error) {
        return (
            <div className='translation-panel translation-attachment translation-panel--error'>
                <div className='translation-panel__error'>{authorSummary.error}</div>
                <div className='translation-panel__meta'>Tap the chevron again to retry.</div>
            </div>
        );
    }

    if (authorSummary.languages.length === 0) {
        return (
            <div className='translation-panel translation-attachment translation-attachment--author'>
                <span className='translation-panel__meta'>Could not load delivery details. Tap the chevron again to retry.</span>
            </div>
        );
    }

    return (
        <div className='translation-panel translation-attachment translation-attachment--author'>
            <TranslationAuthorDelivery
                summary={{...authorSummary, origin: transcript}}
                showDetails={true}
            />
        </div>
    );
}

function mapStateToProps(state: GlobalState, ownProps: {post: Post}) {
    const pluginState = getPluginState(state as Record<string, unknown>);
    const currentUserId = state.entities?.users?.currentUserId || '';
    const post = ownProps.post;

    return {
        authorSummary: pluginState.authorSummaryByPostId[post.id],
        isAuthor: Boolean(currentUserId && post.user_id === currentUserId),
        showDetails: Boolean(pluginState.showOriginalByPostId[post.id]),
    };
}

export default connect(mapStateToProps)(MediaAuthorPanelInner);
