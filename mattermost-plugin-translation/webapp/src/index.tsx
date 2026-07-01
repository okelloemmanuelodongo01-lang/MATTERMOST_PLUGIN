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
    getDisplayMessage,
    getPluginState,
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
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            height: 100%;
            max-height: 100%;
            box-sizing: border-box;
            overflow: hidden;
        }
        .translation-member-panel__you {
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex-shrink: 0;
        }
        .translation-member-panel__label {
            display: block;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.7;
            margin-bottom: 0;
        }
        .translation-member-panel__hint-block {
            font-size: 12px;
            color: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.65);
            margin-bottom: 12px;
            line-height: 1.4;
        }
        .translation-member-panel__hint-block--tight {
            margin-top: -4px;
            margin-bottom: 0;
        }
        .translation-voice-gender-select {
            width: 100%;
            min-height: 36px;
            padding: 6px 10px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16);
            border-radius: 4px;
            background: var(--center-channel-bg, #fff);
            color: var(--center-channel-color, #3f4350);
            font-size: 14px;
        }
        .translation-member-panel__title {
            font-weight: 600;
            margin-bottom: 10px;
        }
        .translation-member-panel__members {
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
            padding: 8px 0;
            border-bottom: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
        }
        .translation-member-panel__name {
            font-size: 14px;
        }
        .translation-member-panel__badge {
            font-size: 11px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            background: rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.08);
            color: var(--center-channel-color, #3f4350);
        }
        .translation-member-panel__badge--you {
            background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
            color: var(--button-bg, #166de0);
            display: inline-block;
            font-size: 13px;
            padding: 4px 10px;
        }
        .translation-member-panel__hint,
        .translation-member-panel__error {
            font-size: 13px;
            opacity: 0.75;
        }
        .translation-language-select {
            width: 100%;
            max-width: 100%;
            margin-top: 6px;
            padding: 8px 10px;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.16);
            border-radius: 4px;
            background: var(--center-channel-bg, #fff);
            color: var(--center-channel-color, #3f4350);
            font-size: 13px;
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
        refreshPostsInUI(storeRef, getChannelPosts(storeRef.getState(), channelId).map((post) => post.id));
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
        refreshPostsInUI(storeRef, getChannelPosts(storeRef.getState(), channelId).map((post) => post.id));
    }
}

async function translatePost(post: Post) {
    if (!storeRef) {
        return;
    }

    const state = getPluginState(storeRef.getState() as Record<string, unknown>);
    storeRef.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: false});

    try {
        await fetchJSON(`${API_BASE}/translate`, {
            method: 'POST',
            body: JSON.stringify({
                post_id: post.id,
                text: getPostTranslationSourceText(post),
                to: state.targetLanguage,
            }),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Translation request failed';
        storeRef.dispatch({type: TRANSLATION_ERROR, postId: post.id, error: message});
    }
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

    const posts = getChannelPosts(globalState, channelId);
    const missing = posts.filter((post) => {
        const existing = pluginState.byPostId[post.id];
        return !existing || (!existing.translated && !existing.loading && !existing.error);
    });

    if (missing.length === 0) {
        return;
    }

    for (const post of missing) {
        storeRef.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
    }

    try {
        const data = await fetchJSON<{
            translations: Array<Record<string, string | number | boolean>>;
        }>(`${API_BASE}/sync`, {
            method: 'POST',
            body: JSON.stringify({
                posts: missing.map((post) => ({
                    id: post.id,
                    text: getPostTranslationSourceText(post),
                })),
            }),
        });

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
            cached: entry.cached,
            same_language: entry.same_language,
            auto: true,
        }));

        storeRef.dispatch({type: SYNC_TRANSLATIONS_SUCCESS, records});
        refreshPostsInUI(storeRef, records.map((record) => record.postId));
    } catch {
        for (const post of missing) {
            storeRef.dispatch({
                type: TRANSLATION_ERROR,
                postId: post.id,
                error: 'Could not load translations for this channel',
            });
        }
    }
}

function scheduleChannelSync(channelId: string) {
    if (syncTimer) {
        clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
        void syncChannelTranslations(channelId);
    }, 400);
}

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        storeRef = store;
        bindTranslationStore(store);
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
            MemberLanguagesPanel,
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
                    refreshPostsInUI(
                        store,
                        getChannelPosts(store.getState(), channelId)
                            .filter((post) => post.user_id === userId)
                            .map((post) => post.id),
                    );
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_result`,
            (msg) => {
                const data = msg.data as Record<string, string | number | boolean>;
                const record = recordFromPayload(data);
                store.dispatch({
                    type: TRANSLATION_SUCCESS,
                    record,
                });
                refreshPostsInUI(store, [record.postId]);
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_translation_error`,
            (msg) => {
                const data = msg.data as Record<string, string>;
                store.dispatch({
                    type: TRANSLATION_ERROR,
                    postId: String(data.post_id),
                    error: String(data.error || 'Translation failed'),
                });
            },
        );

        registry.registerWebSocketEventHandler('posted', (msg) => {
            const data = msg.data as {post?: Post};
            const post = data.post;
            if (!post?.id) {
                return;
            }

            const pluginState = getPluginState(store.getState() as Record<string, unknown>);
            if (!pluginState.enableAutoTranslate) {
                return;
            }

            const currentUserId = store.getState().entities?.users?.currentUserId;
            const isIncomingMedia = Boolean(
                currentUserId &&
                post.user_id !== currentUserId &&
                (isVoiceNotePost(post) || isVideoNotePost(post)),
            );
            const isTextPost = shouldIncludePostInTranslationSync(post);

            if (!isIncomingMedia && !isTextPost) {
                return;
            }

            if (!pluginState.byPostId[post.id]) {
                if (isIncomingMedia) {
                    void translatePost(post);
                } else {
                    store.dispatch({type: TRANSLATION_LOADING, postId: post.id, auto: true});
                }
            }
        });

        registry.registerMessageWillFormatHook((post, message) => {
            const fullState = store.getState() as GlobalState;
            const pluginState = getPluginState(fullState as Record<string, unknown>);
            const currentUserId = fullState.entities?.users?.currentUserId;

            if (isVoiceNotePost(post) || isVideoNotePost(post)) {
                return '';
            }

            if (currentUserId && post.user_id === currentUserId) {
                return message;
            }

            const display = getDisplayMessage(post, pluginState, currentUserId) || message;
            const record = pluginState.byPostId[post.id];

            if (
                !record ||
                record.loading ||
                record.error ||
                record.sameLanguage ||
                !record.translated
            ) {
                return display;
            }

            return display;
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
                scheduleChannelSync(channelId);
                scheduleChannelMemberLanguageSync(channelId);
            }
        });

        await Promise.all([loadUserLanguage(), loadPluginConfig()]);

        const initialChannelId = getCurrentChannelId(store.getState());
        if (initialChannelId) {
            lastSyncedChannelId = initialChannelId;
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
