import type {Post} from '@mattermost/types/posts';

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
    error?: string;
};

export type TranslationState = {
    byPostId: Record<string, TranslationRecord>;
    userLanguages: Record<string, string>;
    targetLanguage: string;
    ttsVoiceGender: VoiceGender;
    readAloudMode: ReadAloudMode;
    enableAutoTranslate: boolean;
    enablePreTranslatePreview: boolean;
};

export type VoiceGender = 'male' | 'female' | 'neutral';
export type ReadAloudMode = 'receive' | 'original';

export const initialState: TranslationState = {
    byPostId: {},
    userLanguages: {},
    targetLanguage: 'en',
    ttsVoiceGender: 'neutral',
    readAloudMode: 'receive',
    enableAutoTranslate: true,
    enablePreTranslatePreview: true,
};

export const SET_TARGET_LANGUAGE = 'SET_TARGET_LANGUAGE';
export const SET_TTS_VOICE_GENDER = 'SET_TTS_VOICE_GENDER';
export const SET_READ_ALOUD_MODE = 'SET_READ_ALOUD_MODE';
export const SET_PLUGIN_CONFIG = 'SET_PLUGIN_CONFIG';
export const MERGE_USER_LANGUAGES = 'MERGE_USER_LANGUAGES';
export const SET_USER_PUBLIC_LANGUAGE = 'SET_USER_PUBLIC_LANGUAGE';
export const TRANSLATION_LOADING = 'TRANSLATION_LOADING';
export const TRANSLATION_SUCCESS = 'TRANSLATION_SUCCESS';
export const TRANSLATION_ERROR = 'TRANSLATION_ERROR';
export const SYNC_TRANSLATIONS_SUCCESS = 'SYNC_TRANSLATIONS_SUCCESS';

type PluginAction =
    | {type: typeof SET_TARGET_LANGUAGE; language: string; userId?: string}
    | {type: typeof SET_TTS_VOICE_GENDER; gender: VoiceGender}
    | {type: typeof SET_READ_ALOUD_MODE; mode: ReadAloudMode}
    | {type: typeof SET_PLUGIN_CONFIG; enableAutoTranslate: boolean; enablePreTranslatePreview: boolean}
    | {type: typeof MERGE_USER_LANGUAGES; languages: Record<string, string>}
    | {type: typeof SET_USER_PUBLIC_LANGUAGE; userId: string; language: string}
    | {type: typeof TRANSLATION_LOADING; postId: string; auto?: boolean}
    | {type: typeof TRANSLATION_SUCCESS; record: TranslationRecord}
    | {type: typeof TRANSLATION_ERROR; postId: string; error: string}
    | {type: typeof SYNC_TRANSLATIONS_SUCCESS; records: TranslationRecord[]};

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
    case TRANSLATION_LOADING:
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.postId]: {
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
                    auto: Boolean(action.auto),
                    loading: true,
                },
            },
        };
    case TRANSLATION_SUCCESS:
        return {
            ...state,
            byPostId: {
                ...state.byPostId,
                [action.record.postId]: {...action.record, loading: false},
            },
        };
    case SYNC_TRANSLATIONS_SUCCESS: {
        const byPostId = {...state.byPostId};
        for (const record of action.records) {
            byPostId[record.postId] = {...record, loading: false};
        }
        return {...state, byPostId};
    }
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
                    error: action.error,
                },
            },
        };
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

export function getDisplayMessage(post: Post, state: TranslationState, currentUserId?: string): string {
    if (currentUserId && post.user_id === currentUserId) {
        return post.message;
    }
    const record = state.byPostId[post.id];
    if (!record || record.loading || record.error || record.sameLanguage) {
        return post.message;
    }
    return record.translated || post.message;
}

export function shouldShowTranslationBar(_post: Post, _state: TranslationState): boolean {
    return false;
}
