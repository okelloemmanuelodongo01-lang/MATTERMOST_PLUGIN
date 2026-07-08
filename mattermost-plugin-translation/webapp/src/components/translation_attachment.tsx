import React from 'react';

import {connect} from 'react-redux';

import type {Post} from '@mattermost/types/posts';

import type {GlobalState} from '@mattermost/types/store';

import {
    getMyReceiveLanguage,
    getPluginState,
    isSameLanguageCode,
    isTranslationRecordCurrent,
    shouldShowTranslationBar,
    shouldShowTranslationDetailsPanel,
    type AuthorDeliverySummary,
    type TranslationRecord,
} from '../reducer';

import TranslationAuthorDelivery from './translation_author_delivery';
import TranslationOriginalDiff from './translation_original_diff';
import TranslationQualityBadge from './translation_quality_badge';
import {getLanguageLabel} from '../language_options';

type OwnProps = {
    post?: Post;
};

type StateProps = {
    record?: TranslationRecord;
    authorSummary?: AuthorDeliverySummary;
    showDetails: boolean;
    showDetailsPanel: boolean;
    isAuthor: boolean;
    showBar: boolean;
    receiveLanguage: string;
};

function extractPost(props: OwnProps & Partial<Post>): Post | null {
    if (props.post?.id) {
        return props.post;
    }
    if (props.id) {
        return props as Post;
    }
    return null;
}

function hasValidBacktranslation(reversed: string, translated: string): boolean {
    const back = reversed.trim();
    const forward = translated.trim();
    if (!back || !forward) {
        return false;
    }
    return back.toLowerCase() !== forward.toLowerCase();
}

function TranslationAttachment({
    post: postProp,
    record,
    authorSummary,
    showDetails,
    showDetailsPanel,
    isAuthor,
    showBar,
    receiveLanguage,
    ...rest
}: OwnProps & StateProps & Partial<Post>) {
    const post = extractPost({post: postProp, ...rest});
    if (!post || !showBar) {
        return null;
    }

    if (!showDetails || !showDetailsPanel) {
        return null;
    }

    if (isAuthor) {
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
                    <span className='translation-panel__meta'>Could not load delivery details. Close and reopen the panel to retry.</span>
                </div>
            );
        }

        const translatedDeliveries = authorSummary.languages.filter((entry) => !entry.sameLanguage);
        if (translatedDeliveries.length === 0) {
            const labels = authorSummary.languages
                .map((entry) => getLanguageLabel(entry.language))
                .filter(Boolean)
                .join(', ');
            return (
                <div className='translation-panel translation-attachment translation-attachment--author'>
                    <span className='translation-panel__meta'>
                        {authorSummary.languageCount > 1
                            ? `Readers use ${labels}. Everyone received the message in the same language it was written — no translation was needed.`
                            : `All readers use ${labels || 'the same receive language'} — no translation delivery was needed.`}
                    </span>
                </div>
            );
        }

        return (
            <TranslationAuthorDelivery
                summary={authorSummary}
                showDetails={showDetails}
            />
        );
    }

    if (!record || (record.loading && !record.translated?.trim())) {
        return (
            <div className='translation-panel translation-attachment'>
                <span className='translation-panel__meta'>Translating…</span>
            </div>
        );
    }

    if (record.error) {
        return (
            <div className='translation-panel translation-attachment translation-panel--error'>
                <div className='translation-panel__error'>{record.error}</div>
                <div className='translation-panel__meta'>Tap the chevron again to retry.</div>
            </div>
        );
    }

    const detected = record.detectedFrom || record.from;
    const receiveLabel = getLanguageLabel(receiveLanguage);
    const languagesMatch = isSameLanguageCode(detected, receiveLanguage);
    const targetMatches = isTranslationRecordCurrent(record, receiveLanguage);

    if (record.sameLanguage && languagesMatch && targetMatches) {
        const detectedLabel = detected ? getLanguageLabel(detected) : 'your language';

        return (
            <div className='translation-panel translation-attachment'>
                <div className='translation-panel__meta'>
                    Same language — no translation needed. Message is in {detectedLabel} and your receive language is {receiveLabel}.
                </div>
                <div className='translation-panel__block'>
                    <div className='translation-panel__original-label'>Original</div>
                    <div className='translation-panel__text'>{post.message}</div>
                </div>
            </div>
        );
    }

    if (!record.translated?.trim() || !targetMatches) {
        return (
            <div className='translation-panel translation-attachment'>
                <span className='translation-panel__meta'>
                    Translating to {receiveLabel}…
                </span>
            </div>
        );
    }

    const sourceText = (record.origin || post.message || '').trim();
    const translatedText = record.translated;
    const reversedText = record.reversed || '';
    const hasEvaluation = hasValidBacktranslation(reversedText, translatedText);
    const showEvaluating = record.evaluatingQuality && !hasEvaluation;

    return (
        <div className='translation-panel translation-attachment'>
            {hasEvaluation && (
                <div className='translation-panel__header'>
                    <TranslationQualityBadge record={record} />
                </div>
            )}
            {showEvaluating && (
                <div className='translation-panel__meta'>Evaluating translation quality…</div>
            )}
            <div className='translation-panel__details'>
                <TranslationOriginalDiff
                    original={sourceText}
                    reversed={reversedText}
                    showDiff={hasEvaluation}
                />
            </div>
        </div>
    );
}

function mapStateToProps(state: GlobalState, ownProps: OwnProps & Partial<Post>): StateProps {
    const post = extractPost(ownProps);
    const pluginState = getPluginState(state as Record<string, unknown>);
    const currentUserId = state.entities?.users?.currentUserId || '';

    if (!post) {
        return {
            showDetails: false,
            showDetailsPanel: false,
            isAuthor: false,
            showBar: false,
            receiveLanguage: 'en',
        };
    }

    const isAuthor = Boolean(currentUserId && post.user_id === currentUserId);

    return {
        record: pluginState.byPostId[post.id],
        authorSummary: pluginState.authorSummaryByPostId[post.id],
        showDetails: Boolean(pluginState.showOriginalByPostId[post.id]),
        showDetailsPanel: shouldShowTranslationDetailsPanel(post, pluginState, isAuthor),
        isAuthor,
        showBar: shouldShowTranslationBar(post, pluginState, currentUserId, isAuthor),
        receiveLanguage: getMyReceiveLanguage(pluginState, currentUserId),
    };
}

export default connect(mapStateToProps)(TranslationAttachment);
