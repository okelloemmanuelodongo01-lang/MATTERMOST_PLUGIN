import type {Post} from '@mattermost/types/posts';

import {isMediaNotePost} from './voice_post_utils';

export type TranslationRecord = {
    postId: string;
    origin: string;
    translated: string;
    from: string;
    to: string;
    detectedFrom: string;
    engine: string;
    reversed: string;
    score: number;
    semanticScore: number;
    embeddingScore: number;
    qualityScore: number;
    cached: boolean;
    sameLanguage: boolean;
    auto: boolean;
    loading: boolean;
    evaluatingQuality?: boolean;
    mediaStage?: string;
    languageUncertain?: boolean;
    error?: string;
};

export type AuthorLanguageDelivery = {
    language: string;
    translated: string;
    reversed: string;
    from: string;
    detectedFrom: string;
    engine: string;
    score: number;
    semanticScore: number;
    embeddingScore: number;
    qualityScore: number;
    cached: boolean;
    sameLanguage: boolean;
    readerCount: number;
};

export type AuthorDeliverySummary = {
    postId: string;
    origin: string;
    from: string;
    detectedFrom: string;
    recipientCount: number;
    languageCount: number;
    languages: AuthorLanguageDelivery[];
    loading: boolean;
    error?: string;
};

export type TranslationState = {
    byPostId: Record<string, TranslationRecord>;
    authorSummaryByPostId: Record<string, AuthorDeliverySummary>;
    userLanguages: Record<string, string>;
    targetLanguage: string;
    ttsVoiceGender: VoiceGender;
    readAloudMode: ReadAloudMode;
    enableAutoTranslate: boolean;
    enablePreTranslatePreview: boolean;
    showOriginalByPostId: Record<string, boolean>;
};

export type VoiceGender = 'male' | 'female' | 'neutral';
export type ReadAloudMode = 'receive' | 'original';

export const initialState: TranslationState = {
    byPostId: {},
    authorSummaryByPostId: {},
    userLanguages: {},
    targetLanguage: 'en',
    ttsVoiceGender: 'neutral',
    readAloudMode: 'receive',
    enableAutoTranslate: true,
    enablePreTranslatePreview: true,
    showOriginalByPostId: {},
};

export const SET_TARGET_LANGUAGE = 'SET_TARGET_LANGUAGE';
export const SET_TTS_VOICE_GENDER = 'SET_TTS_VOICE_GENDER';
export const SET_READ_ALOUD_MODE = 'SET_READ_ALOUD_MODE';
export const SET_PLUGIN_CONFIG = 'SET_PLUGIN_CONFIG';
export const MERGE_USER_LANGUAGES = 'MERGE_USER_LANGUAGES';
export const SET_USER_PUBLIC_LANGUAGE = 'SET_USER_PUBLIC_LANGUAGE';
export const TRANSLATION_LOADING = 'TRANSLATION_LOADING';
export const TRANSLATION_SUCCESS = 'TRANSLATION_SUCCESS';
export const TRANSLATION_DELIVERED = 'TRANSLATION_DELIVERED';
export const TRANSLATION_EVALUATED = 'TRANSLATION_EVALUATED';
export const TRANSLATION_ERROR = 'TRANSLATION_ERROR';
export const TRANSLATION_MEDIA_PROGRESS = 'TRANSLATION_MEDIA_PROGRESS';
export const SYNC_TRANSLATIONS_SUCCESS = 'SYNC_TRANSLATIONS_SUCCESS';
export const AUTHOR_SUMMARY_LOADING = 'AUTHOR_SUMMARY_LOADING';
export const AUTHOR_SUMMARY_SUCCESS = 'AUTHOR_SUMMARY_SUCCESS';
export const AUTHOR_SUMMARY_ERROR = 'AUTHOR_SUMMARY_ERROR';
export const TOGGLE_SHOW_ORIGINAL = 'TOGGLE_SHOW_ORIGINAL';
export const INVALIDATE_CHANNEL_TRANSLATIONS = 'INVALIDATE_CHANNEL_TRANSLATIONS';

type PluginAction =
    | {type: typeof SET_TARGET_LANGUAGE; language: string; userId?: string}
    | {type: typeof SET_TTS_VOICE_GENDER; gender: VoiceGender}
    | {type: typeof SET_READ_ALOUD_MODE; mode: ReadAloudMode}
    | {type: typeof SET_PLUGIN_CONFIG; enableAutoTranslate: boolean; enablePreTranslatePreview: boolean}
    | {type: typeof MERGE_USER_LANGUAGES; languages: Record<string, string>}
    | {type: typeof SET_USER_PUBLIC_LANGUAGE; userId: string; language: string}
    | {type: typeof TRANSLATION_LOADING; postId: string; auto?: boolean}
    | {type: typeof TRANSLATION_SUCCESS; record: TranslationRecord}
    | {type: typeof TRANSLATION_DELIVERED; record: TranslationRecord}
    | {type: typeof TRANSLATION_EVALUATED; record: TranslationRecord}
    | {type: typeof TRANSLATION_ERROR; postId: string; error: string}
    | {type: typeof TRANSLATION_MEDIA_PROGRESS; postId: string; stage: string}
    | {type: typeof SYNC_TRANSLATIONS_SUCCESS; records: TranslationRecord[]; authorSummaries?: AuthorDeliverySummary[]}
    | {type: typeof AUTHOR_SUMMARY_LOADING; postId: string}
    | {type: typeof AUTHOR_SUMMARY_SUCCESS; summary: AuthorDeliverySummary}
    | {type: typeof AUTHOR_SUMMARY_ERROR; postId: string; error: string}
    | {type: typeof TOGGLE_SHOW_ORIGINAL; postId: string}
    | {type: typeof INVALIDATE_CHANNEL_TRANSLATIONS; postIds: string[]};

export default function reducer(state = initialState, action: PluginAction): TranslationState {
    switch (action.type) {
    case SET_TARGET_LANGUAGE: {
        const next = {...state, targetLanguage: action.language};
        if (action.userId) {
            next.userLanguages = {...state.userLanguages, [action.userId]: action.language};
        }
        return next;
    }
    case SET_TTS_VOICE_GENDER:
        return {...state, ttsVoiceGender: action.gender};
    case SET_READ_ALOUD_MODE:
        return {...state, readAloudMode: action.mode};
    case MERGE_USER_LANGUAGES:
        return {
            ...state,
            userLanguages: {...state.userLanguages, ...action.languages},
        };
    case SET_USER_PUBLIC_LANGUAGE:
        return {
            ...state,
            userLanguages: {...state.userLanguages, [action.userId]: action.language},
        };
    case SET_PLUGIN_CONFIG:
        return {
            ...state,
            enableAutoTranslate: action.enableAutoTranslate,
            enablePreTranslatePreview: action.enablePreTranslatePreview,
        };
    case TRANSLATION_LOADING: {
        const existing = state.byPostId[action.postId];
        if (existing?.translated?.trim() && !existing.error) {
            return {
                ...state,
                byPostId: {
                    ...state.byPostId,
                    [action.postId]: {...existing, loading: true, auto: Boolean(action.auto)},
                },
            };
        }
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.postId]: {
                    postId: action.postId,
                    origin: existing?.origin || '',
                    translated: existing?.translated || '',
                    from: existing?.from || '',
                    to: state.targetLanguage,
                    detectedFrom: existing?.detectedFrom || '',
                    engine: existing?.engine || '',
                    reversed: existing?.reversed || '',
                    score: existing?.score || 0,
                    semanticScore: existing?.semanticScore || 0,
                    embeddingScore: existing?.embeddingScore || 0,
                    qualityScore: existing?.qualityScore || 0,
                    cached: existing?.cached || false,
                    sameLanguage: existing?.sameLanguage || false,
                    auto: Boolean(action.auto),
                    loading: true,
                    mediaStage: 'transcribing',
                },
            },
        };
    }
    case TRANSLATION_MEDIA_PROGRESS: {
        const existing = state.byPostId[action.postId];
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.postId]: {
                    postId: action.postId,
                    origin: existing?.origin || '',
                    translated: existing?.translated || '',
                    from: existing?.from || '',
                    to: existing?.to || state.targetLanguage,
                    detectedFrom: existing?.detectedFrom || '',
                    engine: existing?.engine || '',
                    reversed: existing?.reversed || '',
                    score: existing?.score || 0,
                    semanticScore: existing?.semanticScore || 0,
                    embeddingScore: existing?.embeddingScore || 0,
                    qualityScore: existing?.qualityScore || 0,
                    cached: existing?.cached || false,
                    sameLanguage: existing?.sameLanguage || false,
                    auto: existing?.auto ?? false,
                    loading: true,
                    mediaStage: action.stage,
                    error: undefined,
                },
            },
        };
    }
    case TRANSLATION_SUCCESS:
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.record.postId]: {...action.record, loading: false, evaluatingQuality: false, mediaStage: undefined},
            },
        };
    case TRANSLATION_DELIVERED: {
        const existing = state.byPostId[action.record.postId];
        const hasEval = Boolean(action.record.reversed?.trim() && action.record.qualityScore > 0);
        const evaluatingQuality = action.record.evaluatingQuality ?? !hasEval;
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.record.postId]: {
                    ...(existing || {}),
                    ...action.record,
                    loading: false,
                    evaluatingQuality,
                    mediaStage: undefined,
                },
            },
        };
    }
    case TRANSLATION_EVALUATED: {
        const existing = state.byPostId[action.record.postId];
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.record.postId]: {
                    ...(existing || {}),
                    ...action.record,
                    loading: false,
                    evaluatingQuality: false,
                },
            },
        };
    }
    case SYNC_TRANSLATIONS_SUCCESS: {
        const byPostId = {...state.byPostId};
        for (const record of action.records) {
            byPostId[record.postId] = {...record, loading: false};
        }
        const authorSummaryByPostId = {...state.authorSummaryByPostId};
        for (const summary of action.authorSummaries || []) {
            authorSummaryByPostId[summary.postId] = {...summary, loading: false};
        }
        return {...state, byPostId, authorSummaryByPostId};
    }
    case AUTHOR_SUMMARY_LOADING:
        return {
            ...state,
            authorSummaryByPostId: {
                ...state.authorSummaryByPostId,
                [action.postId]: {
                    postId: action.postId,
                    origin: '',
                    from: '',
                    detectedFrom: '',
                    recipientCount: 0,
                    languageCount: 0,
                    languages: [],
                    loading: true,
                },
            },
        };
    case AUTHOR_SUMMARY_SUCCESS:
        return {
            ...state,
            authorSummaryByPostId: {
                ...state.authorSummaryByPostId,
                [action.summary.postId]: {...action.summary, loading: false},
            },
        };
    case AUTHOR_SUMMARY_ERROR:
        return {
            ...state,
            authorSummaryByPostId: {
                ...state.authorSummaryByPostId,
                [action.postId]: {
                    ...(state.authorSummaryByPostId[action.postId] || {
                        postId: action.postId,
                        origin: '',
                        from: '',
                        detectedFrom: '',
                        recipientCount: 0,
                        languageCount: 0,
                        languages: [],
                    }),
                    loading: false,
                    error: action.error,
                },
            },
        };
    case TRANSLATION_ERROR:
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.postId]: {
                    ...(state.byPostId[action.postId] || {
                        postId: action.postId,
                        origin: '',
                        translated: '',
                        from: '',
                        to: state.targetLanguage,
                        detectedFrom: '',
                        engine: '',
                        reversed: '',
                        score: 0,
                        semanticScore: 0,
                        embeddingScore: 0,
                        qualityScore: 0,
                        cached: false,
                        sameLanguage: false,
                        auto: false,
                    }),
                    loading: false,
                    mediaStage: undefined,
                    error: action.error,
                },
            },
        };
    case TOGGLE_SHOW_ORIGINAL: {
        const current = Boolean(state.showOriginalByPostId[action.postId]);
        return {
            ...state,
            showOriginalByPostId: {
                ...state.showOriginalByPostId,
                [action.postId]: !current,
            },
        };
    }
    case INVALIDATE_CHANNEL_TRANSLATIONS: {
        const nextByPostId = {...state.byPostId};
        const nextSummaries = {...state.authorSummaryByPostId};
        for (const postId of action.postIds) {
            delete nextByPostId[postId];
            delete nextSummaries[postId];
        }
        return {
            ...state,
            byPostId: nextByPostId,
            authorSummaryByPostId: nextSummaries,
        };
    }
    default:
        return state;
    }
}

export function getPluginState(state: Record<string, unknown> | undefined): TranslationState {
    if (!state) {
        return initialState;
    }
    return (state['plugins-com.transchecker.translation'] as TranslationState | undefined) || initialState;
}

export function getUserReceiveLanguage(state: TranslationState, userId: string): string | undefined {
    return state.userLanguages[userId];
}

export function getMyReceiveLanguage(state: TranslationState, currentUserId: string): string {
    if (currentUserId && state.userLanguages[currentUserId]) {
        return state.userLanguages[currentUserId];
    }
    return state.targetLanguage;
}

export function normalizeLanguageCode(code: string): string {
    const trimmed = (code || '').trim().toLowerCase();
    if (!trimmed) {
        return '';
    }
    return trimmed.split(/[-_]/)[0];
}

export function isSameLanguageCode(a: string, b: string): boolean {
    const left = normalizeLanguageCode(a);
    const right = normalizeLanguageCode(b);
    return left !== '' && left === right;
}

export function isTranslationRecordCurrent(record: TranslationRecord | undefined, targetLanguage: string): boolean {
    if (!record || record.loading || record.error) {
        return false;
    }
    const target = normalizeLanguageCode(targetLanguage);
    if (!target) {
        return true;
    }
    return isSameLanguageCode(record.to, target);
}

export function getDisplayMessage(post: Post, state: TranslationState, currentUserId?: string): string {
    if (currentUserId && post.user_id === currentUserId) {
        return post.message;
    }
    const record = state.byPostId[post.id];
    const myTarget = getMyReceiveLanguage(state, currentUserId || '');
    if (!record || record.error) {
        return post.message;
    }
    if (
        record.translated?.trim() &&
        isTranslationRecordCurrent(record, myTarget) &&
        !(record.sameLanguage && isSameLanguageCode(record.detectedFrom || record.from, myTarget))
    ) {
        return record.translated.trim();
    }
    if (record.loading) {
        return post.message;
    }
    if (!isTranslationRecordCurrent(record, myTarget)) {
        return post.message;
    }
    if (record.sameLanguage && isSameLanguageCode(record.detectedFrom || record.from, myTarget)) {
        return post.message;
    }
    return record.translated?.trim() || post.message;
}

export function isTranslatableTextPost(post: Post): boolean {
    if (!post?.id || !post.message?.trim()) {
        return false;
    }

    if (post.type === 'custom_voice_note' || post.type === 'custom_video_note') {
        return false;
    }

    if (post.type && post.type.startsWith('system_')) {
        return false;
    }

    return true;
}

export function shouldShowTranslationDetailsPanel(
    post: Post,
    state: TranslationState,
    isAuthor?: boolean,
): boolean {
    if (isTranslatableTextPost(post)) {
        return true;
    }
    if (!isMediaNotePost(post)) {
        return false;
    }
    if (isAuthor) {
        return true;
    }
    return Boolean(state.byPostId[post.id]?.translated?.trim());
}

export function shouldShowTranslationBar(
    post: Post,
    state: TranslationState,
    _currentUserId?: string,
    isAuthor?: boolean,
): boolean {
    if (isTranslatableTextPost(post)) {
        return true;
    }
    if (!isMediaNotePost(post)) {
        return false;
    }
    if (isAuthor) {
        return true;
    }
    return Boolean(state.byPostId[post.id]?.translated?.trim());
}
