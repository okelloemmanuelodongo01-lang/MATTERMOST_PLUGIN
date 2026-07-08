import React from 'react';
import {createPortal, flushSync} from 'react-dom';
import manifest from 'manifest';
import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import type {PluginRegistry} from 'types/mattermost-webapp';

import reducer, {
    MERGE_USER_LANGUAGES,
    SET_PLUGIN_CONFIG,
    SET_TARGET_LANGUAGE,
    SET_TTS_VOICE_GENDER,
    SET_READ_ALOUD_MODE,
    SET_USER_PUBLIC_LANGUAGE,
    SYNC_TRANSLATIONS_SUCCESS,
    TRANSLATION_ERROR,
    TRANSLATION_LOADING,
    TRANSLATION_SUCCESS,
    TRANSLATION_DELIVERED,
    TRANSLATION_EVALUATED,
    TRANSLATION_MEDIA_PROGRESS,
    AUTHOR_SUMMARY_SUCCESS,
    getDisplayMessage,
    getMyReceiveLanguage,
    getPluginState,
    isTranslationRecordCurrent,
    normalizeLanguageCode,
    type AuthorDeliverySummary,
    type AuthorLanguageDelivery,
    type TranslationRecord,
} from './reducer';
import TranslationAttachmentWrapper from './components/translation_attachment_wrapper';
import ChannelHeaderTranslateMount from './components/channel_header_translate_mount';
import MemberLanguagesPanel from './components/member_languages_panel';
import ReceiveLanguageSetting from './components/receive_language_setting';
import ProfileLanguageAttribute from './components/profile_language_attribute';
import TranslatePreviewModal, {type PreviewData} from './components/translate_preview_modal';
import MediaNoteButtons from './components/media_note_buttons';
import MediaFilePreview, {shouldOverrideMediaPreview} from './components/media_file_preview';
import VoiceNotePost from './components/voice_note_post';
import VideoNotePost from './components/video_note_post';
import {bindTranslationStore, refreshPostsInUI} from './post_refresh';
import {bindTranslationResync, resyncCurrentChannelTranslations} from './translation_resync';
import {bindAuthorSummaryStore, fetchAuthorSummary, isAuthorSummaryStale, noteAuthorSummaryReceived, recoverStaleAuthorSummaries} from './author_summary_client';
import {
    bindTranslationRetry,
    clearTranslationRetry,
    schedulePostTranslationRetry,
    shouldGiveUpTranslationRetry,
} from './translation_retry';
import {bindTranslationDetailsLoader} from './translation_details';
import {bindInlineTranslationToggles, scheduleInlineTranslationToggleSync} from './inline_translation_toggle';
import {bindSpeakStore} from './speak_client';
import {FALLBACK_LANGUAGE_OPTIONS, fetchLanguageOptions} from './language_options';
import {getPostTranslationSourceText, isVoiceNotePost, shouldIncludePostInTranslationSync} from './voice_post_utils';
import {isVideoNotePost} from './video_post_utils';
import {WHATSAPP_CHAT_CSS} from './whatsapp_chat_styles';
import WhatsAppChatLayout from './whatsapp_chat_layout';

function registerStyles() {
    const styleId = `${PLUGIN_ID}-styles`;
    if (document.getElementById(styleId)) {
        return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .translation-panel {
            margin-top: 6px;
            padding: 6px 10px;
            border-left: 3px solid var(--button-bg, #166de0);
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.06);
            border-radius: 4px;
            font-size: 12px;
        }
        .translation-panel--error {
            border-left-color: var(--error-text, #d24b4e);
            background: rgba(var(--dnd-indicator-rgb, 210, 75, 78), 0.06);
        }
        .translation-panel__header {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            justify-content: space-between;
        }
        .translation-panel__toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin-left: auto;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            flex-shrink: 0;
        }
        .translation-panel__toggle:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-panel__original {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.12);
        }
        .translation-panel__original-label {
            font-size: 11px;
            font-weight: 600;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.55);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .translation-panel__details {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.12);
        }
        .translation-panel__block + .translation-panel__block,
        .translation-panel__block + .translation-panel__diff {
            margin-top: 8px;
        }
        .translation-panel__diff-label {
            font-size: 11px;
            font-weight: 600;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.55);
            margin-bottom: 4px;
        }
        .translation-panel__diff-body {
            line-height: 1.5;
            white-space: pre-wrap;
        }
        .translation-panel__diff--match {
            margin-top: 8px;
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.65);
            font-style: italic;
        }
        .translation-diff__same {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.85);
        }
        .translation-diff__removed {
            color: #c92a2a;
            text-decoration: line-through;
            background: rgba(201, 42, 42, 0.08);
            border-radius: 2px;
            padding: 0 1px;
        }
        .translation-diff__added {
            color: #1b7f3b;
            background: rgba(27, 127, 59, 0.1);
            border-radius: 2px;
            padding: 0 1px;
        }
        .translation-attachment--author {
            border-left-color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.35);
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.04);
        }
        .translation-panel__badge {
            font-weight: 600;
            color: var(--button-bg, #166de0);
        }
        .translation-panel__meta {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-panel__link,
        .translation-panel__action {
            border: none;
            background: transparent;
            color: var(--button-bg, #166de0);
            cursor: pointer;
            font-size: 12px;
            text-decoration: underline;
            padding: 0;
        }
        .translation-panel__action {
            text-decoration: none;
            font-weight: 600;
            background: var(--button-bg, #166de0);
            color: #fff;
            padding: 4px 10px;
            border-radius: 4px;
        }
        .translation-panel__action:hover {
            opacity: 0.9;
        }
        .translation-panel__text {
            margin-top: 6px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.85);
            line-height: 1.45;
            white-space: pre-wrap;
        }
        .translation-panel__error {
            margin-top: 4px;
            color: var(--error-text, #d24b4e);
            line-height: 1.4;
        }
        .translation-attachment {
            margin-top: 6px;
        }
        .translation-attachment--collapsed {
            display: none;
        }
        .translation-message-toggle {
            grid-column: 2;
            grid-row: 1;
            position: relative;
            z-index: 5;
            pointer-events: auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            margin: 0;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.58);
            cursor: pointer;
            line-height: 0;
            align-self: start;
            justify-self: end;
            flex-shrink: 0;
        }
        .translation-message-toggle:hover {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.92);
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.1);
        }
        .translation-message-toggle__icon {
            display: block;
            pointer-events: none;
        }
        #post-list .post .post__body.translation-has-toggle,
        #channel_view .post .post__body.translation-has-toggle,
        .post .post__body.translation-has-toggle {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 22px;
            column-gap: 2px;
            align-items: start;
            position: relative;
            overflow: visible !important;
        }
        #post-list .post .post__body.translation-has-toggle .post-message__text,
        #post-list .post .post__body.translation-has-toggle [data-testid="postMessageText"],
        #channel_view .post .post__body.translation-has-toggle .post-message__text,
        #channel_view .post .post__body.translation-has-toggle [data-testid="postMessageText"] {
            grid-column: 1;
            grid-row: 1;
            min-width: 0;
            padding-right: 0 !important;
        }
        #post-list .post .post__body.translation-has-toggle > *:not(.translation-message-toggle):not(.post-message__text):not([data-testid="postMessageText"]):not(.translation-voice-post):not(.translation-video-post),
        #channel_view .post .post__body.translation-has-toggle > *:not(.translation-message-toggle):not(.post-message__text):not([data-testid="postMessageText"]):not(.translation-voice-post):not(.translation-video-post) {
            grid-column: 1 / -1;
        }
        .post .post__body.translation-has-toggle .translation-voice-post,
        .post .post__body.translation-has-toggle .translation-video-post,
        #post-list .post .post__body.translation-has-toggle .translation-voice-post,
        #post-list .post .post__body.translation-has-toggle .translation-video-post,
        #channel_view .post .post__body.translation-has-toggle .translation-voice-post,
        #channel_view .post .post__body.translation-has-toggle .translation-video-post {
            grid-column: 1;
            grid-row: 1;
            min-width: 0;
        }
        .post .post__body.translation-has-toggle > .translation-message-toggle,
        #post-list .post .post__body.translation-has-toggle > .translation-message-toggle,
        #channel_view .post .post__body.translation-has-toggle > .translation-message-toggle {
            grid-column: 2;
            grid-row: 1;
            align-self: start;
            justify-self: end;
            position: relative;
            z-index: 6;
            flex-shrink: 0;
        }
        /* Long posts: Mattermost collapses message height — uncap when chevron panel is open */
        .post .post__body.translation-details-open,
        .post.translation-details-open .post__body,
        .ThreadViewer .post .post__body.translation-details-open {
            max-height: none !important;
            overflow: visible !important;
        }
        .post .post__body.translation-details-open .post-message__text,
        .post .post__body.translation-details-open [data-testid="postMessageText"] {
            max-height: none !important;
            overflow: visible !important;
        }
        .post .translation-panel {
            max-height: none !important;
            overflow: visible !important;
        }
        #post-list .post.translation-wa--received .translation-message-toggle,
        #post-list .post:not(.current--user):not(.translation-wa--sent) .translation-message-toggle {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.58);
        }
        #post-list .post.translation-wa--received .translation-message-toggle:hover,
        #post-list .post:not(.current--user):not(.translation-wa--sent) .translation-message-toggle:hover {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.92);
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.1);
        }
        #post-list .post.translation-wa--sent .translation-message-toggle,
        #post-list .post.current--user .translation-message-toggle {
            color: rgba(17, 27, 33, 0.55);
        }
        #post-list .post.translation-wa--sent .translation-message-toggle:hover,
        #post-list .post.current--user .translation-message-toggle:hover {
            color: rgba(17, 27, 33, 0.88);
            background: rgba(17, 27, 33, 0.06);
        }
        .theme--dark #post-list .post.translation-wa--sent .translation-message-toggle,
        .theme--dark #post-list .post.current--user .translation-message-toggle {
            color: rgba(233, 237, 239, 0.68);
        }
        .translation-author-delivery__hint {
            margin: 0;
            font-size: 11px;
            line-height: 1.45;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.68);
        }
        .translation-author-delivery__list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 8px;
        }
        .translation-author-lang {
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.05);
            overflow: hidden;
        }
        .translation-author-lang__header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            width: 100%;
            padding: 8px 10px;
            border: none;
            background: transparent;
            cursor: pointer;
            text-align: left;
            font: inherit;
            color: inherit;
        }
        .translation-author-lang__header:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.06);
        }
        .translation-author-lang__title {
            font-weight: 600;
            font-size: 12px;
        }
        .translation-author-lang__meta {
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.62);
        }
        .translation-author-lang__score {
            margin-left: auto;
            font-size: 11px;
            font-weight: 600;
        }
        .translation-author-lang__score--excellent,
        .translation-author-lang__score--good {
            color: #1b7f3b;
        }
        .translation-author-lang__score--soso {
            color: #b45309;
        }
        .translation-author-lang__score--poor {
            color: #c92a2a;
        }
        .translation-author-lang__body {
            padding: 10px 10px 12px;
            border-top: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-author-lang__body .translation-quality__google-link {
            margin-top: 8px;
        }
        .translation-quality {
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex: 1 1 auto;
            min-width: 0;
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.85);
        }
        .translation-quality__summary {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
        }
        .translation-quality__label {
            font-weight: 600;
        }
        .translation-quality__score {
            font-weight: 700;
            min-width: 2.5em;
        }
        .translation-quality__tier {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.62);
            font-size: 10px;
        }
        .translation-quality__certainty {
            font-size: 10px;
            font-weight: 600;
        }
        .translation-quality--excellent .translation-quality__score,
        .translation-quality--excellent .translation-quality__certainty {
            color: #1b7f3b;
        }
        .translation-quality--good .translation-quality__score,
        .translation-quality--good .translation-quality__certainty {
            color: #2f9e44;
        }
        .translation-quality--soso .translation-quality__score,
        .translation-quality--soso .translation-quality__certainty {
            color: #b45309;
        }
        .translation-quality--poor .translation-quality__score,
        .translation-quality--poor .translation-quality__certainty {
            color: #c92a2a;
        }
        .translation-quality--high .translation-quality__score {
            color: #1b7f3b;
        }
        .translation-quality--medium .translation-quality__score {
            color: #b45309;
        }
        .translation-quality--low .translation-quality__score {
            color: #c92a2a;
        }
        .translation-quality--cached {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.65);
        }
        .translation-quality__meta {
            font-style: italic;
        }
        .translation-quality__details {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .translation-quality__chip {
            display: inline-flex;
            align-items: center;
            padding: 2px 6px;
            border-radius: 999px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            font-size: 10px;
            line-height: 1.2;
        }
        .translation-quality__chip--engine {
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            color: var(--button-bg, #166de0);
            font-weight: 600;
        }
        .translation-quality__google-link {
            display: inline-flex;
            align-items: center;
            padding: 2px 6px;
            border-radius: 999px;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.1);
            color: var(--button-bg, #166de0);
            font-size: 10px;
            font-weight: 600;
            line-height: 1.2;
            text-decoration: none;
        }
        .translation-quality__google-link:hover {
            text-decoration: underline;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.16);
        }
        .translation-quality__bar {
            display: inline-block;
            width: 72px;
            height: 6px;
            border-radius: 999px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.12);
            overflow: hidden;
            vertical-align: middle;
        }
        .translation-quality__bar-fill {
            display: block;
            height: 100%;
            border-radius: 999px;
            background: var(--button-bg, #166de0);
        }
        .translation-quality--excellent .translation-quality__bar-fill {
            background: #1b7f3b;
        }
        .translation-quality--good .translation-quality__bar-fill {
            background: #2f9e44;
        }
        .translation-quality--soso .translation-quality__bar-fill {
            background: #b45309;
        }
        .translation-quality--poor .translation-quality__bar-fill {
            background: #c92a2a;
        }
        .translation-quality--high .translation-quality__bar-fill {
            background: #1b7f3b;
        }
        .translation-quality--medium .translation-quality__bar-fill {
            background: #b45309;
        }
        .translation-quality--low .translation-quality__bar-fill {
            background: #c92a2a;
        }
        .translation-channel-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 4px;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            color: var(--button-bg, #166de0);
            font-size: 12px;
            font-weight: 600;
            margin-right: 4px;
        }
        .plugin-translation-header-slot {
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
        }
        .plugin-translation-header-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            margin: 0 2px;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.64);
        }
        .plugin-translation-header-btn:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            color: var(--center-channel-color, #3f4350);
        }
        .translation-header-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: inherit;
        }
        .translation-member-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
            max-height: 100%;
            box-sizing: border-box;
            overflow: hidden;
            background:
                radial-gradient(120% 80% at 0% 0%, rgba(var(--button-bg-rgb, 22, 109, 224), 0.08), transparent 55%),
                var(--center-channel-bg, #fff);
        }
        .translation-member-panel__settings {
            flex-shrink: 0;
            padding: 18px 16px 16px;
            border-bottom: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            position: relative;
            z-index: 3;
        }
        .translation-member-panel__settings::before {
            content: '';
            position: absolute;
            left: 0;
            top: 18px;
            bottom: 16px;
            width: 3px;
            border-radius: 0 3px 3px 0;
            background: linear-gradient(180deg, var(--button-bg, #166de0), rgba(var(--button-bg-rgb, 22, 109, 224), 0.35));
        }
        .translation-member-panel__field {
            margin-bottom: 14px;
        }
        .translation-member-panel__field:last-of-type {
            margin-bottom: 10px;
        }
        .translation-member-panel__label {
            display: block;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.62);
            margin-bottom: 6px;
        }
        .translation-custom-select {
            position: relative;
            width: 100%;
            z-index: 4;
        }
        .translation-custom-select--open {
            z-index: 20;
        }
        .translation-custom-select__trigger {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            margin: 0;
            padding: 10px 12px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.14);
            border-radius: 8px;
            background: var(--center-channel-bg, #fff);
            color: var(--center-channel-color, #3f4350);
            font-size: 13px;
            line-height: 1.35;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            cursor: pointer;
            pointer-events: auto;
            text-align: left;
        }
        .translation-custom-select__trigger:hover:not(:disabled) {
            border-color: rgba(var(--button-bg-rgb, 22, 109, 224), 0.35);
        }
        .translation-custom-select__trigger:focus,
        .translation-custom-select--open .translation-custom-select__trigger {
            outline: none;
            border-color: var(--button-bg, #166de0);
            box-shadow: 0 0 0 3px rgba(var(--button-bg-rgb, 22, 109, 224), 0.14);
        }
        .translation-custom-select__trigger:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }
        .translation-custom-select__value {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .translation-custom-select__chevron {
            width: 12px;
            height: 12px;
            margin-left: 10px;
            flex-shrink: 0;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M7 10l5 5 5-5' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: center;
            transition: transform 0.15s ease;
        }
        .translation-custom-select--open .translation-custom-select__chevron {
            transform: rotate(180deg);
        }
        .translation-custom-select__menu {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            right: 0;
            max-height: 220px;
            overflow-y: auto;
            padding: 4px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.12);
            border-radius: 8px;
            background: var(--center-channel-bg, #fff);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
            z-index: 30;
        }
        .translation-custom-select__option {
            display: block;
            width: 100%;
            padding: 8px 10px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--center-channel-color, #3f4350);
            font-size: 13px;
            line-height: 1.35;
            text-align: left;
            cursor: pointer;
        }
        .translation-custom-select__option:hover,
        .translation-custom-select__option--active {
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            color: var(--button-bg, #166de0);
        }
        .translation-custom-select__option--selected {
            background: var(--button-bg, #166de0);
            color: #fff;
            font-weight: 600;
        }
        .translation-custom-select__option--selected:hover,
        .translation-custom-select__option--selected.translation-custom-select__option--active {
            background: var(--button-bg, #166de0);
            color: #fff;
        }
        .translation-member-panel__speak-hint {
            margin: 0;
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.05);
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.06);
            font-size: 11px;
            line-height: 1.45;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-member-panel__members {
            flex: 1 1 auto;
            min-height: 0;
            display: flex;
            flex-direction: column;
            padding: 14px 16px 16px;
        }
        .translation-member-panel__members-head {
            flex-shrink: 0;
            margin-bottom: 8px;
        }
        .translation-member-panel__title {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: -0.01em;
            margin-bottom: 4px;
            color: var(--center-channel-color, #3f4350);
        }
        .translation-member-panel__hint-block {
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.62);
            margin-bottom: 0;
            line-height: 1.45;
        }
        .translation-member-panel__list {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: 2px;
        }
        .translation-member-panel__row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 10px 10px;
            margin-bottom: 6px;
            border-radius: 10px;
            border: 1px solid transparent;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .translation-member-panel__row:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.04);
            border-color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.06);
        }
        .translation-member-panel__row--you {
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.07);
            border-color: rgba(var(--button-bg-rgb, 22, 109, 224), 0.14);
        }
        .translation-member-panel__person {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .translation-member-panel__avatar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 700;
            color: var(--button-bg, #166de0);
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
        }
        .translation-member-panel__name {
            font-size: 13px;
            font-weight: 500;
            color: var(--center-channel-color, #3f4350);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .translation-member-panel__you-tag {
            display: inline-block;
            margin-left: 6px;
            padding: 1px 6px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--button-bg, #166de0);
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            vertical-align: middle;
        }
        .translation-member-panel__badge {
            flex-shrink: 0;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.06em;
            padding: 4px 8px;
            border-radius: 999px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.88);
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-member-panel__row--you .translation-member-panel__badge {
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            color: var(--button-bg, #166de0);
            border-color: rgba(var(--button-bg-rgb, 22, 109, 224), 0.16);
        }
        .translation-member-panel__hint,
        .translation-member-panel__error {
            font-size: 12px;
            opacity: 0.8;
            padding: 8px 2px;
        }
        .translation-member-panel__error {
            color: var(--error-text, #d24b4e);
            opacity: 1;
        }
        .translation-language-select__loading {
            font-size: 12px;
            opacity: 0.72;
        }
        .translation-receive-language-setting {
            width: 100%;
        }
        .translation-message-tag {
            display: inline-block;
            margin-right: 6px;
            padding: 0 5px;
            border-radius: 3px;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.14);
            color: var(--button-bg, #166de0);
            font-size: 10px;
            font-weight: 700;
            vertical-align: middle;
        }
        .translation-author-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: -2px;
            margin-bottom: 4px;
        }
        .translation-author-badge__pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 28px;
            padding: 2px 8px;
            border-radius: 4px;
            background: var(--button-bg, #166de0);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.04em;
        }
        .translation-author-badge__label {
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.65);
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .translation-profile-attr {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 0;
            font-size: 13px;
        }
        .translation-profile-attr__label {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-profile-attr__value {
            font-weight: 600;
        }
        .translation-preview-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
        }
        .translation-preview-modal {
            width: min(520px, 92vw);
            background: var(--center-channel-bg, #fff);
            color: var(--center-channel-color, #3f4350);
            border-radius: 8px;
            padding: 20px 24px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        }
        .translation-preview-modal__title {
            margin: 0 0 8px;
            font-size: 18px;
        }
        .translation-preview-modal__hint {
            margin: 0 0 16px;
            font-size: 13px;
            opacity: 0.75;
        }
        .translation-preview-modal__block {
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.06);
        }
        .translation-preview-modal__block--muted {
            opacity: 0.85;
        }
        .translation-preview-modal__label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 4px;
            opacity: 0.7;
        }
        .translation-preview-modal__text {
            line-height: 1.45;
            white-space: pre-wrap;
        }
        .translation-preview-modal__actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }
        .translation-voice-note {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            position: relative;
        }
        .translation-voice-note__btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-voice-note__btn:hover:not(:disabled) {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-voice-note__btn--recording {
            animation: translation-voice-pulse 1.2s ease-in-out infinite;
        }
        .translation-voice-note__btn--sending {
            opacity: 0.55;
            cursor: wait;
        }
        .translation-voice-note__timer {
            font-size: 11px;
            font-weight: 600;
            color: var(--dnd-indicator, #d24b4e);
            min-width: 32px;
        }
        .translation-voice-note__error {
            position: absolute;
            left: 0;
            top: calc(100% + 4px);
            z-index: 5;
            max-width: 220px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--error-text, #d24b4e);
            color: #fff;
            font-size: 11px;
            line-height: 1.3;
            white-space: normal;
        }
        @keyframes translation-voice-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.06); }
        }
        .translation-voice-note--active {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 6px;
            background: rgba(var(--dnd-indicator-rgb, 210, 75, 78), 0.08);
        }
        .translation-voice-note__timer--paused {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-voice-note__control {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
        }
        .translation-voice-note__control:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16);
        }
        .translation-voice-note__control--delete:hover {
            background: rgba(var(--dnd-indicator-rgb, 210, 75, 78), 0.16);
        }
        .translation-voice-note__control--send {
            color: var(--button-bg, #166de0);
            font-weight: 700;
        }
        .translation-voice-panel {
            margin-top: 8px;
            padding: 8px 12px;
            border-left: 3px solid var(--button-bg, #166de0);
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.06);
            border-radius: 4px;
            font-size: 13px;
        }
        .translation-voice-panel--empty,
        .translation-voice-panel--error {
            border-left-color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.24);
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.04);
        }
        .translation-voice-panel__header {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            margin-bottom: 6px;
        }
        .translation-voice-panel__badge {
            font-weight: 700;
            color: var(--button-bg, #166de0);
            font-size: 12px;
        }
        .translation-voice-panel__meta {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
            font-size: 12px;
        }
        .translation-voice-panel__action {
            margin-left: auto;
            border: none;
            background: var(--button-bg, #166de0);
            color: #fff;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 4px;
        }
        .translation-voice-panel__action:hover {
            opacity: 0.9;
        }
        .translation-voice-panel__text {
            line-height: 1.45;
            white-space: pre-wrap;
            color: var(--center-channel-color, #3f4350);
        }
        .translation-voice-panel__label {
            font-weight: 600;
            margin-right: 6px;
            opacity: 0.7;
            font-size: 11px;
            text-transform: uppercase;
        }
        .translation-voice-panel__hint,
        .translation-voice-panel__error {
            font-size: 12px;
            line-height: 1.4;
            opacity: 0.8;
        }
        .translation-voice-panel__error {
            color: var(--error-text, #d24b4e);
        }
        .translation-voice-panel--idle {
            padding: 6px 0 0;
            border-left: none;
            background: transparent;
        }
        .translation-voice-panel__footer {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 8px 12px;
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.1);
        }
        .translation-voice-panel__detected {
            margin-right: auto;
            font-size: 11px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.68);
        }
        .translation-voice-panel__google-link {
            font-size: 11px;
            font-weight: 600;
            color: var(--link-color, var(--button-bg, #166de0));
            text-decoration: none;
        }
        .translation-voice-panel__google-link:hover {
            text-decoration: underline;
        }
        .translation-voice-panel__uncertain {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            margin-left: 4px;
            border-radius: 50%;
            font-size: 10px;
            font-weight: 700;
            line-height: 1;
            color: var(--away-indicator, #ffbc1f);
            border: 1px solid rgba(var(--away-indicator-rgb, 255, 188, 31), 0.5);
            cursor: help;
        }
        .translation-voice-panel--loading {
            gap: 8px;
        }
        .translation-voice-panel__progress {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-bottom: 4px;
        }
        .translation-voice-panel__progress-step {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            opacity: 0.45;
        }
        .translation-voice-panel__progress-step--active {
            opacity: 1;
            font-weight: 600;
        }
        .translation-voice-panel__progress-step--done {
            opacity: 0.75;
        }
        .translation-voice-panel__progress-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.25);
        }
        .translation-voice-panel__progress-step--active .translation-voice-panel__progress-dot {
            background: var(--button-bg, #166de0);
            box-shadow: 0 0 0 3px rgba(var(--button-bg-rgb, 22, 109, 224), 0.18);
        }
        .translation-voice-panel__progress-step--done .translation-voice-panel__progress-dot {
            background: var(--online-indicator, #3db887);
        }
        .translation-panel__action--retry {
            margin-top: 8px;
        }
        .translation-voice-panel__evaluating {
            margin-top: 6px;
        }
        .translation-voice-panel__summary-row {
            display: flex;
            align-items: flex-start;
            gap: 2px;
        }
        .translation-voice-panel__summary-row--author {
            align-items: center;
            margin-top: 6px;
        }
        .translation-voice-panel__summary-main {
            flex: 1;
            min-width: 0;
        }
        .translation-voice-panel__summary-text {
            flex: 1;
            min-width: 0;
        }
        .translation-voice-panel__toggle {
            position: relative;
            z-index: 2;
            margin-top: 1px;
        }
        .translation-voice-panel__details {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.1);
        }
        .translation-voice-panel__author-hint {
            flex: 1;
            font-size: 12px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-voice-panel__quality {
            margin-top: 8px;
        }
        .translation-voice-panel__quality .translation-quality {
            font-size: 12px;
        }
        .translation-voice-panel__author-delivery {
            margin-top: 4px;
        }
        .translation-voice-panel__author-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.7;
            margin-bottom: 8px;
        }
        .translation-voice-panel--author {
            margin-top: 8px;
        }
        .translation-panel__action--media {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 28px;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
        }
        .translation-voice-preview {
            margin: 4px 0 8px;
        }
        .translation-voice-player {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 240px;
            max-width: 380px;
            padding: 10px 12px;
            border-radius: 22px;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.1);
            border: 1px solid rgba(var(--button-bg-rgb, 22, 109, 224), 0.18);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .translation-voice-player__play {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 50%;
            background: var(--button-bg, #166de0);
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            flex-shrink: 0;
        }
        .translation-voice-player__play:hover {
            opacity: 0.92;
        }
        .translation-voice-player__waveform {
            flex: 1;
            min-width: 0;
        }
        .translation-voice-player__time {
            font-size: 11px;
            font-weight: 600;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
            min-width: 34px;
            text-align: right;
            flex-shrink: 0;
        }
        .translation-waveform {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 2px;
            height: 30px;
            width: 100%;
            cursor: pointer;
            user-select: none;
        }
        .translation-waveform:focus-visible {
            outline: 2px solid var(--button-bg, #166de0);
            outline-offset: 2px;
            border-radius: 4px;
        }
        .translation-waveform__bar {
            flex: 1 1 0;
            max-width: 4px;
            min-width: 2px;
            border-radius: 999px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.28);
            align-self: center;
            transition: background-color 0.12s ease;
        }
        .translation-waveform__bar--played {
            background: var(--button-bg, #166de0);
        }
        .translation-waveform__bar--loading {
            animation: translation-waveform-pulse 1s ease-in-out infinite alternate;
        }
        @keyframes translation-waveform-pulse {
            from { opacity: 0.45; }
            to { opacity: 0.95; }
        }
        .translation-voice-post {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 2px;
        }
        .post--root .translation-voice-post,
        .post .translation-voice-post {
            max-width: 420px;
        }
        .translation-media-note-buttons {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            position: relative;
        }
        .translation-media-note-buttons__lang-wrap {
            position: relative;
        }
        .translation-media-note-buttons__lang-toggle {
            min-width: 28px;
            height: 28px;
            padding: 0 6px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.2);
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.06);
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            color: var(--center-channel-color, #3f4350);
        }
        .translation-media-note-buttons__lang-panel {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            z-index: 20;
            width: 240px;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16);
            background: var(--center-channel-bg, #fff);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }
        .translation-media-note-buttons__lang-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.7;
            margin-bottom: 6px;
        }
        .translation-media-note-buttons__lang-hint {
            margin-top: 8px;
            font-size: 11px;
            line-height: 1.35;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.65);
        }
        .translation-voice-note__timer--warn,
        .translation-video-note__timer--warn {
            color: var(--away-indicator, #ffbc1f);
        }
        .translation-video-note {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            position: relative;
        }
        .translation-video-note__btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-video-note__btn:hover:not(:disabled) {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-video-note--active {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 6px;
            background: rgba(var(--dnd-indicator-rgb, 210, 75, 78), 0.08);
        }
        .translation-video-note__preview {
            width: 72px;
            height: 54px;
            object-fit: cover;
            border-radius: 6px;
            background: #000;
            flex-shrink: 0;
        }
        .translation-video-note__timer {
            font-size: 11px;
            font-weight: 600;
            color: var(--dnd-indicator, #d24b4e);
            min-width: 32px;
        }
        .translation-video-note__timer--paused {
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
        }
        .translation-video-note__control {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
        }
        .translation-video-note__control:hover {
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16);
        }
        .translation-video-note__control--delete:hover {
            background: rgba(var(--dnd-indicator-rgb, 210, 75, 78), 0.16);
        }
        .translation-video-note__control--send {
            color: var(--button-bg, #166de0);
            font-weight: 700;
        }
        .translation-video-note__error {
            position: absolute;
            left: 0;
            top: calc(100% + 4px);
            z-index: 5;
            max-width: 220px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--error-text, #d24b4e);
            color: #fff;
            font-size: 11px;
            line-height: 1.3;
            white-space: normal;
        }
        .translation-video-post {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 2px;
            max-width: 360px;
        }
        .translation-video-player {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .translation-video-player--bubble {
            padding: 8px;
            border-radius: 16px;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.08);
            border: 1px solid rgba(var(--button-bg-rgb, 22, 109, 224), 0.16);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }
        .translation-video-player__frame {
            position: relative;
            border-radius: 12px;
            overflow: hidden;
            background: #000;
            aspect-ratio: 4 / 3;
        }
        .translation-video-player__frame--playing {
            cursor: pointer;
        }
        .translation-video-player__video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            background: #000;
        }
        .translation-video-player__overlay-play {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: rgba(0, 0, 0, 0.28);
            cursor: pointer;
            padding: 0;
        }
        .translation-video-player__overlay-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.92);
            color: var(--button-bg, #166de0);
            font-size: 20px;
            padding-left: 3px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        .translation-video-player__duration-badge {
            position: absolute;
            right: 8px;
            bottom: 8px;
            padding: 2px 7px;
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.62);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
            pointer-events: none;
        }
        .translation-video-player__controls {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 2px 2px;
        }
        .translation-video-player__play {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 50%;
            background: var(--button-bg, #166de0);
            color: #fff;
            cursor: pointer;
            font-size: 12px;
            flex-shrink: 0;
        }
        .translation-video-player__waveform {
            flex: 1;
            min-width: 0;
            height: 26px;
        }
        .translation-video-player__time {
            font-size: 11px;
            font-weight: 600;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72);
            min-width: 34px;
            text-align: right;
            flex-shrink: 0;
        }
        .translation-video-preview {
            margin: 4px 0 8px;
        }
        .translation-speak-bar {
            display: flex;
            align-items: center;
            margin-top: 1px;
            min-height: 18px;
            grid-column: 1 / -1;
            width: 100%;
        }
        .translation-speak-button-wrap {
            position: relative;
            display: inline-flex;
            align-items: center;
        }
        .translation-speak-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: transparent;
            cursor: pointer;
            opacity: 0.72;
            transition: opacity 0.12s ease, background 0.12s ease;
        }
        .translation-speak-button:hover:not(:disabled) {
            opacity: 1;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-speak-button--playing {
            opacity: 1;
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
        }
        .translation-speak-button--loading {
            opacity: 0.45;
            cursor: wait;
        }
        .translation-speak-button__error {
            position: absolute;
            left: 0;
            top: calc(100% + 4px);
            z-index: 6;
            max-width: 240px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--error-text, #d24b4e);
            color: #fff;
            font-size: 11px;
            line-height: 1.3;
            white-space: normal;
        }
        .translation-speak-bar,
        .translation-speak-button-wrap,
        .translation-speak-button {
            position: relative;
            z-index: 4;
            pointer-events: auto;
        }
        ${WHATSAPP_CHAT_CSS}
    `;
    document.head.appendChild(style);
}

const PLUGIN_ID = manifest.id;
const API_BASE = `/plugins/${PLUGIN_ID}/api/v1`;

let storeRef: Store<GlobalState> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let memberLangSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedChannelId = '';
let lastChannelPostsKey = '';
const websocketFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightPostSyncIds = new Set<string>();
const loadingSinceByPostId = new Map<string, number>();

type PreviewResolver = {
    resolve: (send: boolean) => void;
};

let previewResolver: PreviewResolver | null = null;
let previewState: PreviewData | null = null;
let previewUpdate: (() => void) | null = null;

function setPreview(preview: PreviewData | null) {
    previewState = preview;
    previewUpdate?.();
}

function waitForPreviewDecision(preview: PreviewData): Promise<boolean> {
    flushSync(() => {
        setPreview(preview);
    });
    return new Promise((resolve) => {
        previewResolver = {resolve};
    });
}

function shouldShowPreSendPreview(preview: {
    same_language?: boolean;
    needs_preview?: boolean;
    origin?: string;
    translated?: string;
}): boolean {
    if (preview.needs_preview === true) {
        return true;
    }
    if (preview.needs_preview === false) {
        return false;
    }
    const origin = String(preview.origin || '').trim();
    const translated = String(preview.translated || '').trim();
    if (origin && translated && origin !== translated) {
        return true;
    }
    return !preview.same_language;
}

function confirmPreview() {
    previewResolver?.resolve(true);
    previewResolver = null;
    setPreview(null);
}

function cancelPreview() {
    previewResolver?.resolve(false);
    previewResolver = null;
    setPreview(null);
}

function PluginRoot() {
    return (
        <>
            <PreviewRoot />
            <WhatsAppChatLayout getStore={() => storeRef} />
        </>
    );
}

function PreviewRoot() {
    const [, forceUpdate] = React.useState(0);
    React.useEffect(() => {
        previewUpdate = () => forceUpdate((n) => n + 1);
        return () => {
            previewUpdate = null;
        };
    }, []);

    if (!previewState) {
        return null;
    }

    return createPortal(
        <TranslatePreviewModal
            preview={previewState}
            onConfirm={confirmPreview}
            onCancel={cancelPreview}
        />,
        document.body,
    );
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(options?.headers || {}),
        },
        ...options,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }

    return response.json() as Promise<T>;
}

function recordFromPayload(data: Record<string, string | number | boolean>): TranslationRecord {
    return {
        postId: String(data.post_id),
        origin: String(data.origin || ''),
        translated: String(data.translated || ''),
        from: String(data.from || ''),
        to: String(data.to || ''),
        detectedFrom: String(data.detected_from || ''),
        engine: String(data.engine || ''),
        reversed: String(data.reversed || ''),
        score: Number(data.score || 0),
        semanticScore: Number(data.semantic_score || 0),
        embeddingScore: Number(data.embedding_score || 0),
        qualityScore: Number(data.quality_score || 0),
        cached: Boolean(data.cached),
        sameLanguage: Boolean(data.same_language),
        auto: Boolean(data.auto),
        loading: false,
    };
}

function parseAuthorSummaryLanguages(data: Record<string, unknown>) {
    if (Array.isArray(data.languages) && data.languages.length > 0) {
        return data.languages;
    }

    const rawJSON = data.languages_json;
    if (typeof rawJSON === 'string' && rawJSON.trim().startsWith('[')) {
        try {
            const parsed = JSON.parse(rawJSON);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            return [];
        }
    }

    return [];
}

function authorSummaryFromPayload(data: Record<string, unknown>): AuthorDeliverySummary {
    const languagesRaw = parseAuthorSummaryLanguages(data);
    const languages: AuthorLanguageDelivery[] = languagesRaw.map((entry) => {
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

async function loadPluginConfig() {
    if (!storeRef) {
        return;
    }

    try {
        const data = await fetchJSON<{
            enable_auto_translate: boolean;
            enable_pre_translate_preview: boolean;
        }>(`${API_BASE}/config`);
        storeRef.dispatch({
            type: SET_PLUGIN_CONFIG,
            enableAutoTranslate: Boolean(data.enable_auto_translate),
            enablePreTranslatePreview: Boolean(data.enable_pre_translate_preview),
        });
    } catch {
        // defaults
    }
}

async function loadUserLanguage() {
    if (!storeRef) {
        return;
    }

    try {
        const data = await fetchJSON<{target_language: string; tts_voice_gender?: string; read_aloud_mode?: string}>(`${API_BASE}/language`);
        const userId = storeRef.getState().entities.users.currentUserId;
        storeRef.dispatch({
            type: SET_TARGET_LANGUAGE,
            language: data.target_language,
            userId,
        });
        const gender = (data.tts_voice_gender || 'neutral').toLowerCase();
        if (gender === 'male' || gender === 'female' || gender === 'neutral') {
            storeRef.dispatch({type: SET_TTS_VOICE_GENDER, gender});
        }
        const readMode = (data.read_aloud_mode || 'receive').toLowerCase();
        if (readMode === 'receive' || readMode === 'original') {
            storeRef.dispatch({type: SET_READ_ALOUD_MODE, mode: readMode});
        }
    } catch {
        // keep default
    }
}

async function syncChannelMemberLanguages(channelId: string) {
    if (!storeRef || !channelId) {
        return;
    }

    try {
        const data = await fetchJSON<{
            members: Array<{user_id: string; target_language: string}>;
        }>(`${API_BASE}/channel-languages?channel_id=${encodeURIComponent(channelId)}`);

        const languages: Record<string, string> = {};
        for (const member of data.members || []) {
            languages[member.user_id] = member.target_language;
        }

        storeRef.dispatch({type: MERGE_USER_LANGUAGES, languages});
        scheduleInlineTranslationToggleSync(storeRef);
    } catch {
        // ignore
    }
}

function scheduleChannelMemberLanguageSync(channelId: string) {
    if (memberLangSyncTimer) {
        clearTimeout(memberLangSyncTimer);
    }
    memberLangSyncTimer = setTimeout(() => {
        void syncChannelMemberLanguages(channelId);
    }, 300);
}

async function saveUserLanguage(language: string) {
    if (!storeRef) {
        return;
    }

    const userId = storeRef.getState().entities.users.currentUserId;

    await fetchJSON(`${API_BASE}/language`, {
        method: 'POST',
        body: JSON.stringify({target_language: language}),
    });
    storeRef.dispatch({
        type: SET_TARGET_LANGUAGE,
        language,
        userId,
    });
    if (userId) {
        storeRef.dispatch({type: SET_USER_PUBLIC_LANGUAGE, userId, language});
    }

    const channelId = getCurrentChannelId(storeRef.getState());
    if (channelId) {
        scheduleChannelMemberLanguageSync(channelId);
        scheduleInlineTranslationToggleSync(storeRef);
    }
}

function parsePostedWebSocketPost(data: Record<string, unknown>): Post | null {
    const raw = data.post;
    if (!raw) {
        return null;
    }

    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as Post;
        } catch {
            return null;
        }
    }

    if (typeof raw === 'object' && raw !== null && 'id' in raw) {
        return raw as Post;
    }

    return null;
}

function rememberKnownPosts(posts: Post[]): Record<string, Post> {
    const knownPosts: Record<string, Post> = {};
    for (const post of posts) {
        if (post?.id) {
            knownPosts[post.id] = post;
        }
    }
    return knownPosts;
}

function readerPostNeedsTranslation(
    post: Post,
    pluginState: ReturnType<typeof getPluginState>,
    currentUserId: string,
    options?: {retryErrors?: boolean},
): boolean {
    if (!post?.id || !currentUserId) {
        return false;
    }

    if (post.user_id === currentUserId) {
        return false;
    }

    if (!shouldIncludePostInTranslationSync(post)) {
        return false;
    }

    const existing = pluginState.byPostId[post.id];
    const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);

    if (
        existing?.translated?.trim() &&
        !existing.error &&
        isTranslationRecordCurrent(existing, targetLanguage)
    ) {
        return false;
    }

    if (existing?.error && !options?.retryErrors) {
        return false;
    }

    return true;
}

function postsNeedingSync(
    posts: Post[],
    pluginState: ReturnType<typeof getPluginState>,
    currentUserId: string,
    options?: {retryErrors?: boolean},
): Post[] {
    return posts.filter((post) => readerPostNeedsTranslation(post, pluginState, currentUserId, options));
}

function applySyncApiResponse(
    data: {
        translations?: Array<Record<string, string | number | boolean>>;
    },
    sourcePosts: Post[],
) {
    if (!storeRef) {
        return;
    }

    const knownPosts = rememberKnownPosts(sourcePosts);

    const records = (data.translations || []).map((entry) => recordFromPayload({
        post_id: entry.post_id,
        origin: entry.origin,
        translated: entry.translated,
        from: entry.from,
        to: entry.to,
        detected_from: entry.detected_from,
        engine: entry.engine,
        reversed: entry.reversed,
        score: entry.score,
        semantic_score: entry.semantic_score,
        embedding_score: entry.embedding_score,
        quality_score: entry.quality_score,
        cached: entry.cached,
        same_language: entry.same_language,
        auto: true,
    }));

    storeRef.dispatch({
        type: SYNC_TRANSLATIONS_SUCCESS,
        records,
    });

    const postIds = [
        ...new Set([
            ...records.map((record) => record.postId),
            ...sourcePosts.map((post) => post.id),
        ]),
    ];

    refreshPostsInUI(storeRef, postIds, knownPosts);

    for (const postId of postIds) {
        scheduleInlineTranslationToggleSync(storeRef, postId);
    }

    for (const post of sourcePosts) {
        const record = records.find((entry) => entry.postId === post.id);
        if (!record) {
            const pluginState = getPluginState(storeRef.getState() as Record<string, unknown>);
            if (pluginState.byPostId[post.id]?.loading) {
                schedulePostTranslationRetry(post, 3000);
            }
        } else {
            clearTranslationRetry(post.id);
            clearTranslationWebsocketFallback(post.id);
        }
    }
}

async function syncPostsTranslations(posts: Post[]) {
    if (!storeRef || posts.length === 0) {
        return;
    }

    const globalState = storeRef.getState();
    const pluginState = getPluginState(globalState as Record<string, unknown>);
    const currentUserId = globalState.entities?.users?.currentUserId || '';

    if (!pluginState.enableAutoTranslate) {
        return;
    }

    const missing = postsNeedingSync(posts, pluginState, currentUserId).filter((post) => !inFlightPostSyncIds.has(post.id));
    if (missing.length === 0) {
        return;
    }

    for (const post of missing) {
        inFlightPostSyncIds.add(post.id);
    }

    for (const post of missing) {
        const existing = pluginState.byPostId[post.id];
        const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);
        const hasCurrentTranslation = Boolean(
            existing?.translated?.trim() &&
            !existing.error &&
            isTranslationRecordCurrent(existing, targetLanguage),
        );
        if (!hasCurrentTranslation) {
            storeRef.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
        }
    }

    try {
        const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);
        const data = await fetchJSON<{
            translations: Array<Record<string, string | number | boolean>>;
        }>(`${API_BASE}/sync`, {
            method: 'POST',
            body: JSON.stringify({
                target_language: targetLanguage,
                posts: missing.map((post) => ({
                    id: post.id,
                    text: getPostTranslationSourceText(post),
                })),
            }),
        });

        applySyncApiResponse(data, missing);
        for (const post of missing) {
            const record = data.translations?.find((entry) => String(entry.post_id) === post.id);
            if (record) {
                clearTranslationRetry(post.id);
            }
        }
    } catch {
        for (const post of missing) {
            if (shouldGiveUpTranslationRetry(post.id)) {
                storeRef.dispatch({
                    type: TRANSLATION_ERROR,
                    postId: post.id,
                    error: 'Translation timed out. Tap the chevron to retry.',
                });
            } else {
                schedulePostTranslationRetry(post, 4000);
            }
        }
    } finally {
        for (const post of missing) {
            inFlightPostSyncIds.delete(post.id);
        }
    }
}

function clearTranslationWebsocketFallback(postId: string) {
    const timer = websocketFallbackTimers.get(postId);
    if (timer) {
        clearTimeout(timer);
        websocketFallbackTimers.delete(postId);
    }
}

function scheduleTranslationWebsocketFallback(store: Store<GlobalState>, post: Post) {
    if (!post?.id) {
        return;
    }

    clearTranslationWebsocketFallback(post.id);

    const timer = setTimeout(() => {
        websocketFallbackTimers.delete(post.id);
        if (!storeRef) {
            return;
        }

        const state = storeRef.getState();
        const pluginState = getPluginState(state as Record<string, unknown>);
        const currentUserId = state.entities?.users?.currentUserId || '';
        const record = pluginState.byPostId[post.id];
        const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);
        const hasTranslation = Boolean(
            record?.translated?.trim() &&
            !record.error &&
            isTranslationRecordCurrent(record, targetLanguage),
        );
        if (!hasTranslation && !record?.error) {
            void syncPostsTranslations([post]);
        }
    }, 5000);

    websocketFallbackTimers.set(post.id, timer);
}

function getChannelPostsKey(state: GlobalState, channelId: string): string {
    const posts = getChannelPosts(state, channelId);
    return `${channelId}:${posts.map((post) => post.id).join('|')}`;
}

function recoverStuckTranslations(store: Store<GlobalState>) {
    const state = store.getState();
    const channelId = getCurrentChannelId(state);
    if (!channelId) {
        return;
    }

    const pluginState = getPluginState(state as Record<string, unknown>);
    if (!pluginState.enableAutoTranslate) {
        return;
    }

    const currentUserId = state.entities?.users?.currentUserId || '';
    const posts = getChannelPosts(state, channelId);
    const now = Date.now();
    const stuck: Post[] = [];
    const errored: Post[] = [];

    for (const post of posts) {
        if (currentUserId && post.user_id === currentUserId) {
            continue;
        }

        if (isVoiceNotePost(post) || isVideoNotePost(post)) {
            loadingSinceByPostId.delete(post.id);
            continue;
        }

        const record = pluginState.byPostId[post.id];
        const isLoading = Boolean(record?.loading);

        if (record?.error && !inFlightPostSyncIds.has(post.id) && !shouldGiveUpTranslationRetry(post.id)) {
            errored.push(post);
        }

        if (!isLoading) {
            loadingSinceByPostId.delete(post.id);
            continue;
        }

        if (!loadingSinceByPostId.has(post.id)) {
            loadingSinceByPostId.set(post.id, now);
            continue;
        }

        const loadingForMs = now - (loadingSinceByPostId.get(post.id) || now);
        if (loadingForMs >= 8000 && !inFlightPostSyncIds.has(post.id)) {
            stuck.push(post);
        }

        if (
            record?.translated?.trim() &&
            !record.reversed?.trim() &&
            (record.evaluatingQuality || !record.qualityScore)
        ) {
            const evalKey = `eval:${post.id}`;
            const evalStarted = loadingSinceByPostId.get(evalKey);
            if (!evalStarted) {
                loadingSinceByPostId.set(evalKey, now);
            } else if (now - evalStarted >= 12000) {
                void requestTranslationEvaluation(post);
                loadingSinceByPostId.set(evalKey, now);
            }
        } else {
            loadingSinceByPostId.delete(`eval:${post.id}`);
        }
    }

    if (errored.length > 0) {
        for (const post of errored.slice(-5)) {
            store.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
            schedulePostTranslationRetry(post, 1500);
        }
    }

    if (stuck.length > 0) {
        void syncPostsTranslations(stuck.slice(-5));
    }

    recoverStaleAuthorSummaries(store, posts, pluginState);
}

function handleLivePostTranslation(store: Store<GlobalState>, post: Post) {
    const pluginState = getPluginState(store.getState() as Record<string, unknown>);
    if (!pluginState.enableAutoTranslate || !post?.id) {
        return;
    }

    const currentUserId = store.getState().entities?.users?.currentUserId;
    const isTextPost = shouldIncludePostInTranslationSync(post);
    const isIncomingText = Boolean(currentUserId && post.user_id !== currentUserId && isTextPost);

    if (!isIncomingText) {
        return;
    }

    const existingRecord = pluginState.byPostId[post.id];
    if (!existingRecord?.translated && !existingRecord?.loading && !existingRecord?.error) {
        store.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
        scheduleTranslationWebsocketFallback(store, post);
    }

    scheduleInlineTranslationToggleSync(store, post.id);
}

function bindLiveTranslationWatcher(store: Store<GlobalState>) {
    store.subscribe(() => {
        const state = store.getState();
        const channelId = getCurrentChannelId(state);
        if (!channelId) {
            return;
        }

        const postsKey = getChannelPostsKey(state, channelId);
        if (postsKey === lastChannelPostsKey) {
            return;
        }

        const previousKey = lastChannelPostsKey;
        lastChannelPostsKey = postsKey;

        if (!previousKey || !previousKey.startsWith(`${channelId}:`)) {
            return;
        }

        const previousIds = new Set(
            previousKey.slice(channelId.length + 1).split('|').filter(Boolean),
        );
        const posts = getChannelPosts(state, channelId);
        const newPosts = posts.filter((post) => !previousIds.has(post.id));

        for (const post of newPosts) {
            handleLivePostTranslation(store, post);
        }
    });

    window.setInterval(() => {
        recoverStuckTranslations(store);
    }, 10000);
}

async function translateMediaPost(post: Post) {
    if (!storeRef) {
        return;
    }

    const state = getPluginState(storeRef.getState() as Record<string, unknown>);
    storeRef.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});

    try {
        const response = await fetch(`${API_BASE}/translate`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({
                post_id: post.id,
                text: getPostTranslationSourceText(post),
                to: state.targetLanguage,
            }),
        });

        if (response.ok) {
            const payload = await response.json() as {status?: string; result?: Record<string, unknown>};
            if (payload.status === 'complete' && payload.result) {
                const record = recordFromPayload({
                    post_id: post.id,
                    origin: payload.result.Origin ?? payload.result.origin,
                    translated: payload.result.Translated ?? payload.result.translated,
                    from: payload.result.From ?? payload.result.from,
                    to: payload.result.To ?? payload.result.to,
                    detected_from: payload.result.DetectedFrom ?? payload.result.detected_from,
                    engine: payload.result.Engine ?? payload.result.engine,
                    reversed: payload.result.Reversed ?? payload.result.reversed,
                    score: payload.result.Score ?? payload.result.score,
                    semantic_score: payload.result.SemanticScore ?? payload.result.semantic_score,
                    embedding_score: payload.result.EmbeddingScore ?? payload.result.embedding_score,
                    quality_score: payload.result.QualityScore ?? payload.result.quality_score,
                    cached: payload.cached,
                    same_language: payload.same_language,
                    auto: true,
                });
                storeRef.dispatch({type: TRANSLATION_SUCCESS, record});
                refreshPostsInUI(storeRef, [post.id]);
                scheduleInlineTranslationToggleSync(storeRef, post.id);
                return;
            }
        }

        window.setTimeout(() => {
            void syncPostsTranslations([post]);
        }, 3000);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Translation request failed';
        storeRef.dispatch({type: TRANSLATION_ERROR, postId: post.id, error: message});
    }
}

async function translatePost(post: Post) {
    if (!post?.id) {
        return;
    }

    if (isVoiceNotePost(post) || isVideoNotePost(post)) {
        await translateMediaPost(post);
        return;
    }

    await syncPostsTranslations([post]);
}

function getCurrentChannelId(state: GlobalState): string {
    const channelId = state.entities?.channels?.currentChannelId;
    return typeof channelId === 'string' ? channelId : '';
}

function getChannelPosts(state: GlobalState, channelId: string): Post[] {
    if (!channelId) {
        return [];
    }

    const postsState = state.entities?.posts;
    if (!postsState) {
        return [];
    }

    const blocks = postsState.postsInChannel?.[channelId];
    if (!blocks?.length) {
        return [];
    }

    const recentBlock = blocks.find((block) => block.recent) || blocks[0];
    const postIds = recentBlock?.order || [];

    const posts: Post[] = [];
    for (const postId of postIds) {
        const post = postsState.posts?.[postId];
        if (post && shouldIncludePostInTranslationSync(post)) {
            posts.push(post);
        }
    }

    return posts.slice(-40);
}

async function syncChannelTranslations(channelId: string) {
    if (!storeRef || !channelId) {
        return;
    }

    const globalState = storeRef.getState();
    const pluginState = getPluginState(globalState as Record<string, unknown>);
    if (!pluginState.enableAutoTranslate) {
        return;
    }

    const currentUserId = globalState.entities?.users?.currentUserId || '';
    const posts = getChannelPosts(globalState, channelId).filter(
        (post) => !currentUserId || post.user_id !== currentUserId,
    );
    await syncPostsTranslations(posts);
}

function scheduleChannelSync(channelId: string) {
    if (syncTimer) {
        clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
        void syncChannelTranslations(channelId);
    }, 400);
}

function bindTranslationDisplayWatcher(store: Store<GlobalState>) {
    let lastTargetLanguage = '';

    store.subscribe(() => {
        const globalState = store.getState();
        const pluginState = getPluginState(globalState as Record<string, unknown>);
        const currentUserId = globalState.entities?.users?.currentUserId || '';
        const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);

        if (lastTargetLanguage && targetLanguage && targetLanguage !== lastTargetLanguage) {
            const channelId = getCurrentChannelId(globalState);
            if (channelId && storeRef) {
                const postIds = getChannelPosts(globalState, channelId).map((post) => post.id);
                void resyncCurrentChannelTranslations(channelId, postIds);
            }
        }
        lastTargetLanguage = targetLanguage;
    });
}

function MemberLanguagesSidebar(props: Record<string, unknown>) {
    return (
        <MemberLanguagesPanel
            {...props}
            onResyncChannel={(channelId: string) => {
                if (!storeRef) {
                    return;
                }
                const postIds = getChannelPosts(storeRef.getState(), channelId).map((post) => post.id);
                void resyncCurrentChannelTranslations(channelId, postIds);
            }}
        />
    );
}

async function requestTranslationEvaluation(post: Post) {
    if (!storeRef || !post?.id) {
        return;
    }

    const pluginState = getPluginState(storeRef.getState() as Record<string, unknown>);
    const currentUserId = storeRef.getState().entities?.users?.currentUserId || '';
    const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);
    const existing = pluginState.byPostId[post.id];
    if (!existing?.translated?.trim() || existing.reversed?.trim()) {
        return;
    }

    storeRef.dispatch({
        type: TRANSLATION_DELIVERED,
        record: {...existing, evaluatingQuality: true},
    });

    try {
        const data = await fetchJSON<Record<string, string | number | boolean>>(`${API_BASE}/evaluate`, {
            method: 'POST',
            body: JSON.stringify({
                post_id: post.id,
                target_language: targetLanguage,
                text: getPostTranslationSourceText(post) || post.message || existing.origin || '',
            }),
        });
        const record = recordFromPayload({
            post_id: post.id,
            origin: data.origin,
            translated: data.translated,
            from: data.from,
            to: data.to,
            detected_from: data.detected_from,
            engine: data.engine,
            reversed: data.reversed,
            score: data.score,
            semantic_score: data.semantic_score,
            embedding_score: data.embedding_score,
            quality_score: data.quality_score,
            cached: data.cached,
            auto: true,
        });
        storeRef.dispatch({type: TRANSLATION_EVALUATED, record});
        refreshPostsInUI(storeRef, [post.id]);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not evaluate translation quality';
        if (existing) {
            storeRef.dispatch({
                type: TRANSLATION_ERROR,
                postId: post.id,
                error: message,
            });
        }
    }
}

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        storeRef = store;
        bindTranslationStore(store);
        bindAuthorSummaryStore(store);
        bindTranslationRetry((post) => {
            if (!storeRef) {
                return;
            }
            const currentUserId = storeRef.getState().entities?.users?.currentUserId || '';
            if (currentUserId && post.user_id === currentUserId) {
                return;
            }
            void syncPostsTranslations([post]);
        });
        bindTranslationResync(store, syncChannelTranslations);
        bindTranslationDetailsLoader((post) => {
            if (!storeRef) {
                return;
            }
            const state = storeRef.getState();
            const pluginState = getPluginState(state as Record<string, unknown>);
            const currentUserId = state.entities?.users?.currentUserId || '';
            if (currentUserId && post.user_id === currentUserId) {
                const summary = pluginState.authorSummaryByPostId[post.id];
                const fetchOptions = {
                    text: getPostTranslationSourceText(post) || post.message || '',
                    channelId: post.channel_id || '',
                };
                if (!summary || summary.error || summary.languages.length === 0) {
                    void fetchAuthorSummary(post.id, fetchOptions);
                } else if (summary.loading) {
                    if (isAuthorSummaryStale(post.id)) {
                        void fetchAuthorSummary(post.id, {force: true, ...fetchOptions});
                    }
                }
                return;
            }
            if (!readerPostNeedsTranslation(post, pluginState, currentUserId, {retryErrors: true})) {
                const record = pluginState.byPostId[post.id];
                if (record?.translated?.trim() && !record.reversed?.trim() && !record.evaluatingQuality) {
                    void requestTranslationEvaluation(post);
                }
                return;
            }
            const record = pluginState.byPostId[post.id];
            if (record?.error) {
                clearTranslationRetry(post.id);
                storeRef.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
            }
            void syncPostsTranslations([post]);
        });
        bindInlineTranslationToggles(store);
        bindSpeakStore(store);
        bindLiveTranslationWatcher(store);
        bindTranslationDisplayWatcher(store);
        registerStyles();

        registry.registerReducer(reducer);
        registry.registerRootComponent(PluginRoot);

        registry.registerPostTypeComponent('custom_voice_note', VoiceNotePost);
        registry.registerPostTypeComponent('custom_video_note', VideoNotePost);
        registry.registerPostEditorActionComponent(MediaNoteButtons);
        registry.registerPostMessageAttachmentComponent(TranslationAttachmentWrapper);
        registry.registerFilePreviewComponent(
            shouldOverrideMediaPreview,
            MediaFilePreview,
        );

        const rhs = registry.registerRightHandSidebarComponent(
            MemberLanguagesSidebar,
            'Translation languages',
        );

        registry.registerGlobalComponent(() => (
            <ChannelHeaderTranslateMount
                onOpen={() => {
                    store.dispatch(rhs.showRHSPlugin);
                }}
            />
        ));

        registry.registerPopoverUserAttributesComponent(ProfileLanguageAttribute);

        await fetchLanguageOptions().catch(() => FALLBACK_LANGUAGE_OPTIONS);

        registry.registerUserSettings({
            id: PLUGIN_ID,
            uiName: 'Translation',
            sections: [
                {
                    title: 'Receive language',
                    settings: [
                        {
                            name: 'target_language',
                            type: 'custom',
                            title: 'Show channel messages in',
                            default: 'en',
                            component: ReceiveLanguageSetting,
                        },
                    ],
                    onSubmit: (changes) => {
                        const lang = changes.target_language;
                        if (lang) {
                            void saveUserLanguage(lang).then(() => {
                                const channelId = getCurrentChannelId(store.getState());
                                if (channelId) {
                                    scheduleChannelSync(channelId);
                                    scheduleChannelMemberLanguageSync(channelId);
                                }
                            });
                        }
                    },
                },
            ],
        });

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_language_preference_changed`,
            (msg) => {
                const data = msg.data as Record<string, string>;
                const userId = String(data.user_id || '');
                const language = String(data.target_language || '');
                if (!userId || !language) {
                    return;
                }
                store.dispatch({type: SET_USER_PUBLIC_LANGUAGE, userId, language});

                const currentUserId = store.getState().entities.users.currentUserId;
                if (currentUserId && userId === currentUserId) {
                    store.dispatch({type: SET_TARGET_LANGUAGE, language, userId});
                }

                const channelId = getCurrentChannelId(store.getState());
                if (channelId) {
                    scheduleInlineTranslationToggleSync(store);
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_author_summary`,
            (msg) => {
                const data = msg.data as Record<string, unknown>;
                const summary = authorSummaryFromPayload(data);
                if (summary.languages.length === 0) {
                    void fetchAuthorSummary(summary.postId);
                    return;
                }
                noteAuthorSummaryReceived(summary.postId);
                store.dispatch({
                    type: AUTHOR_SUMMARY_SUCCESS,
                    summary,
                });
                refreshPostsInUI(store, [summary.postId]);
                scheduleInlineTranslationToggleSync(store, summary.postId);
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_media_progress`,
            (msg) => {
                const data = msg.data as Record<string, string>;
                const postId = String(data.post_id || '');
                const stage = String(data.stage || '');
                if (!postId || !stage) {
                    return;
                }
                store.dispatch({
                    type: TRANSLATION_MEDIA_PROGRESS,
                    postId,
                    stage,
                });
                refreshPostsInUI(store, [postId]);
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_delivered`,
            (msg) => {
                const data = msg.data as Record<string, string | number | boolean>;
                const record = recordFromPayload({
                    ...data,
                    reversed: '',
                    score: 0,
                    semantic_score: 0,
                    embedding_score: 0,
                    quality_score: 0,
                    language_uncertain: data.language_uncertain,
                });
                clearTranslationWebsocketFallback(record.postId);
                clearTranslationRetry(record.postId);
                store.dispatch({
                    type: TRANSLATION_DELIVERED,
                    record,
                });
                refreshPostsInUI(store, [record.postId]);
                scheduleInlineTranslationToggleSync(store, record.postId);

                const currentUserId = store.getState().entities?.users?.currentUserId || '';
                const post = store.getState().entities?.posts?.posts?.[record.postId] as Post | undefined;
                if (
                    post &&
                    currentUserId &&
                    post.user_id !== currentUserId &&
                    record.translated?.trim() &&
                    !String(data.reversed || '').trim()
                ) {
                    void requestTranslationEvaluation(post);
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_evaluated`,
            (msg) => {
                const data = msg.data as Record<string, string | number | boolean>;
                const record = recordFromPayload(data);
                store.dispatch({
                    type: TRANSLATION_EVALUATED,
                    record,
                });
                refreshPostsInUI(store, [record.postId]);
                scheduleInlineTranslationToggleSync(store, record.postId);
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_result`,
            (msg) => {
                const data = msg.data as Record<string, string | number | boolean>;
                const record = recordFromPayload(data);
                clearTranslationWebsocketFallback(record.postId);
                clearTranslationRetry(record.postId);
                store.dispatch({
                    type: TRANSLATION_SUCCESS,
                    record,
                });
                refreshPostsInUI(store, [record.postId]);
                scheduleInlineTranslationToggleSync(store, record.postId);
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_error`,
            (msg) => {
                const data = msg.data as Record<string, string>;
                const postId = String(data.post_id);
                store.dispatch({
                    type: TRANSLATION_ERROR,
                    postId,
                    error: String(data.error || 'Translation failed'),
                });
                refreshPostsInUI(store, [postId]);
            },
        );

        registry.registerWebSocketEventHandler('posted', (msg) => {
            const post = parsePostedWebSocketPost(msg.data as Record<string, unknown>);
            if (!post?.id) {
                return;
            }

            handleLivePostTranslation(store, post);
        });

        registry.registerMessageWillFormatHook((post, message) => {
            const fullState = store.getState() as GlobalState;
            const pluginState = getPluginState(fullState as Record<string, unknown>);
            const currentUserId = fullState.entities?.users?.currentUserId;

            if (isVoiceNotePost(post) || isVideoNotePost(post)) {
                return '';
            }

            return getDisplayMessage(post, pluginState, currentUserId) || message;
        });

        const runPreSendPreview = async (post: Post) => {
            const text = post.message?.trim();
            if (!text) {
                return {post};
            }

            if (
                post.type === 'custom_voice_note' ||
                post.type === 'custom_video_note' ||
                post.props?.voice_note ||
                post.props?.video_note
            ) {
                return {post};
            }

            const pluginState = getPluginState(store.getState() as Record<string, unknown>);
            if (!pluginState.enablePreTranslatePreview) {
                return {post};
            }

            const receiveLanguage = pluginState.targetLanguage || 'en';

            try {
                const preview = await fetchJSON<{
                    origin: string;
                    translated: string;
                    detected_from: string;
                    to: string;
                    score: number;
                    quality_score?: number;
                    embedding_score?: number;
                    slang_expanded?: boolean;
                    normalized_text?: string;
                    same_language?: boolean;
                    needs_preview?: boolean;
                }>(`${API_BASE}/preview`, {
                    method: 'POST',
                    body: JSON.stringify({
                        text,
                        to: receiveLanguage,
                        channel_id: post.channel_id || '',
                    }),
                });

                if (!shouldShowPreSendPreview(preview)) {
                    return {post};
                }

                const send = await waitForPreviewDecision({
                    origin: preview.origin,
                    translated: preview.translated,
                    detectedFrom: preview.detected_from,
                    to: preview.to,
                    score: preview.score,
                    qualityScore: preview.quality_score,
                    embeddingScore: preview.embedding_score,
                    slangExpanded: preview.slang_expanded,
                    normalizedText: preview.normalized_text,
                });

                if (!send) {
                    return {error: {message: 'Message not sent'}};
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Translation preview failed';
                return {error: {message: `Could not preview translation: ${message}`}};
            }

            return {post};
        };

        registry.registerMessageWillBePostedHook({
            hook: runPreSendPreview,
        });

        const postRef: {current: Post | null} = {current: null};

        registry.registerPostDropdownMenuAction(
            'Translate message',
            () => {
                if (postRef.current) {
                    void translatePost(postRef.current);
                }
            },
            (post) => {
                postRef.current = post;
                return (isVoiceNotePost(post) || isVideoNotePost(post) || Boolean(getPostTranslationSourceText(post))) && !post.type;
            },
        );

        for (const option of FALLBACK_LANGUAGE_OPTIONS) {
            registry.registerPostDropdownMenuAction(
                `Translate to ${option.label}`,
                () => {
                    if (postRef.current) {
                        void saveUserLanguage(option.value);
                        void translatePost(postRef.current);
                    }
                },
                (post) => {
                    postRef.current = post;
                    return (isVoiceNotePost(post) || isVideoNotePost(post) || Boolean(getPostTranslationSourceText(post))) && !post.type;
                },
            );
        }

        store.subscribe(() => {
            const channelId = getCurrentChannelId(store.getState());
            if (channelId && channelId !== lastSyncedChannelId) {
                lastSyncedChannelId = channelId;
                lastChannelPostsKey = getChannelPostsKey(store.getState(), channelId);
                scheduleChannelSync(channelId);
                scheduleChannelMemberLanguageSync(channelId);
            }
        });

        await Promise.all([loadUserLanguage(), loadPluginConfig()]);

        const initialChannelId = getCurrentChannelId(store.getState());
        if (initialChannelId) {
            lastSyncedChannelId = initialChannelId;
            lastChannelPostsKey = getChannelPostsKey(store.getState(), initialChannelId);
            scheduleChannelSync(initialChannelId);
            scheduleChannelMemberLanguageSync(initialChannelId);
        }
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
