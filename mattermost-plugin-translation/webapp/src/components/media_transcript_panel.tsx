import React, {useCallback} from 'react';
import {connect, useStore} from 'react-redux';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {getPluginState, type TranslationRecord} from '../reducer';
import {requestPostTranslation} from '../translation_client';
import {getVoiceTranscript, isMediaNotePost} from '../voice_post_utils';
import {getVideoTranscript} from '../video_post_utils';
import {mediaProgressLabel, type MediaTranslationStage} from '../media_progress';
import MediaTranslationFooter from './media_translation_footer';
import TranslationQualityBadge from './translation_quality_badge';
import TranslationOriginalDiff from './translation_original_diff';

type OwnProps = {
    post?: Post;
};

type StateProps = {
    record?: TranslationRecord;
    isReader: boolean;
    showDetails: boolean;
};

const MEDIA_PROGRESS_STEPS: MediaTranslationStage[] = ['transcribing', 'detecting', 'translating'];

function extractPost(props: OwnProps & Partial<Post>): Post | null {
    if (props.post?.id) {
        return props.post;
    }
    if (props.id) {
        return props as Post;
    }
    return null;
}

function getMediaTranscript(post: Post): string {
    if (post.type === 'custom_video_note' || post.props?.video_note) {
        return getVideoTranscript(post);
    }
    return getVoiceTranscript(post);
}

function MediaProgressSteps({stage}: {stage?: string}) {
    const activeStage = (stage || 'transcribing') as MediaTranslationStage;
    const activeIndex = Math.max(0, MEDIA_PROGRESS_STEPS.indexOf(activeStage));

    return (
        <div
            className='translation-voice-panel__progress'
            aria-live='polite'
        >
            {MEDIA_PROGRESS_STEPS.map((step, index) => {
                const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
                return (
                    <div
                        key={step}
                        className={`translation-voice-panel__progress-step translation-voice-panel__progress-step--${state}`}
                    >
                        <span className='translation-voice-panel__progress-dot' />
                        <span className='translation-voice-panel__progress-label'>
                            {mediaProgressLabel(step).replace('…', '')}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function MediaTranscriptPanelInner({
    post: postProp,
    record,
    isReader,
    showDetails,
    ...rest
}: OwnProps & StateProps & Partial<Post>) {
    const store = useStore<GlobalState>();
    const post = extractPost({post: postProp, ...rest});

    const handleTranslate = useCallback(() => {
        if (!post) {
            return;
        }
        void requestPostTranslation(store.dispatch, post.id, getMediaTranscript(post), false);
    }, [post, store]);

    if (!post || !isMediaNotePost(post) || !isReader) {
        return null;
    }

    const hasTranslation = Boolean(record?.translated?.trim());
    const transcript = getMediaTranscript(post);
    const isManualLoading = Boolean(record?.loading && !record.auto);
    const reversedText = record?.reversed || '';
    const hasEvaluation = Boolean(
        reversedText.trim() &&
        (record?.qualityScore > 0 || record?.score > 0),
    );
    const showEvaluating = Boolean(record?.evaluatingQuality && !hasEvaluation);

    if (record?.sameLanguage && hasTranslation) {
        const text = record.translated || record.origin || transcript;
        if (text) {
            const footerRecord = {
                ...record,
                origin: record.origin || transcript || text,
            };
            return (
                <div className='translation-panel translation-voice-panel'>
                    <div className='translation-panel__meta'>Already in your language</div>
                    <div className='translation-panel__text'>{text}</div>
                    <MediaTranslationFooter record={footerRecord} />
                </div>
            );
        }
    }

    if (isManualLoading) {
        return (
            <div className='translation-panel translation-voice-panel translation-voice-panel--loading'>
                <MediaProgressSteps stage={record?.mediaStage} />
                <span className='translation-panel__meta'>{mediaProgressLabel(record?.mediaStage)}</span>
            </div>
        );
    }

    if (record?.error) {
        return (
            <div className='translation-panel translation-voice-panel translation-panel--error'>
                <div className='translation-panel__error'>{record.error}</div>
                <button
                    type='button'
                    className='translation-panel__action translation-panel__action--media translation-panel__action--retry'
                    onClick={handleTranslate}
                >
                    Retry translation
                </button>
            </div>
        );
    }

    if (!hasTranslation) {
        return (
            <div className='translation-panel translation-voice-panel translation-voice-panel--idle'>
                <button
                    type='button'
                    className='translation-panel__action translation-panel__action--media'
                    onClick={handleTranslate}
                >
                    Translate to text
                </button>
            </div>
        );
    }

    const sourceText = (record?.origin || transcript).trim();
    const footerRecord = record ? {
        ...record,
        origin: record.origin || sourceText || transcript,
    } : record;

    return (
        <div className='translation-panel translation-voice-panel'>
            <div className='translation-panel__text'>{record?.translated}</div>
            {footerRecord && <MediaTranslationFooter record={footerRecord} />}
            {showDetails && (
                <div className='translation-voice-panel__details'>
                    {showEvaluating && (
                        <div className='translation-panel__meta translation-voice-panel__evaluating'>
                            Evaluating translation quality…
                        </div>
                    )}
                    {hasEvaluation && record && (
                        <div className='translation-voice-panel__quality'>
                            <TranslationQualityBadge record={record} />
                        </div>
                    )}
                    {sourceText && (
                        <TranslationOriginalDiff
                            original={sourceText}
                            reversed={reversedText}
                            showDiff={hasEvaluation}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function mapStateToProps(state: GlobalState, ownProps: OwnProps & Partial<Post>): StateProps {
    const post = extractPost(ownProps);
    const pluginState = getPluginState(state as Record<string, unknown>);
    const currentUserId = state.entities?.users?.currentUserId || '';

    if (!post) {
        return {isReader: false, showDetails: false};
    }

    return {
        record: pluginState.byPostId[post.id],
        isReader: Boolean(currentUserId && post.user_id !== currentUserId),
        showDetails: Boolean(pluginState.showOriginalByPostId[post.id]),
    };
}

export default connect(mapStateToProps)(MediaTranscriptPanelInner);
