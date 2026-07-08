import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import {languageCodeLabel} from './language_labels';
import {getPluginState, getMyReceiveLanguage, isTranslationRecordCurrent, type ReadAloudMode} from './reducer';

const PLUGIN_ID = 'com.transchecker.translation';
const API_BASE = `/plugins/${PLUGIN_ID}/api/v1`;

let speakStoreRef: Store<GlobalState> | null = null;

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activePostId: string | null = null;
let usingBrowserSpeech = false;

const postAudioCache = new Map<string, Blob>();
const POST_AUDIO_CACHE_MAX = 50;

function speakCacheKey(postId: string, voiceGender: string, readMode: string): string {
    return `${postId}:${voiceGender}:${readMode}`;
}

type SpeechListener = (postId: string | null) => void;
const listeners = new Set<SpeechListener>();

function notifyListeners(): void {
    for (const listener of listeners) {
        listener(activePostId);
    }
}

export function onSpeechStateChange(listener: SpeechListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveSpeechPostId(): string | null {
    return activePostId;
}

export function isSpeechPlaying(): boolean {
    if (activeAudio && !activeAudio.paused) {
        return true;
    }
    if (usingBrowserSpeech && typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
        return true;
    }
    return false;
}

export function clearSpeakAudioCache(): void {
    postAudioCache.clear();
}

function cachePostAudio(cacheKey: string, blob: Blob): void {
    if (postAudioCache.has(cacheKey)) {
        postAudioCache.delete(cacheKey);
    }
    postAudioCache.set(cacheKey, blob);
    while (postAudioCache.size > POST_AUDIO_CACHE_MAX) {
        const oldest = postAudioCache.keys().next().value;
        if (!oldest) {
            break;
        }
        postAudioCache.delete(oldest);
    }
}

export function stopActiveSpeech(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    usingBrowserSpeech = false;

    if (activeAudio) {
        activeAudio.pause();
        activeAudio.onended = null;
        activeAudio.onerror = null;
        activeAudio = null;
    }
    if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = null;
    }
    activePostId = null;
    notifyListeners();
}

function toBcp47(language: string): string {
    const code = language.trim().toLowerCase();
    if (!code) {
        return 'en-US';
    }
    if (code.includes('-')) {
        const [lang, region] = code.split('-');
        return `${lang}-${region.toUpperCase()}`;
    }
    const defaults: Record<string, string> = {
        en: 'en-US',
        fr: 'fr-FR',
        ja: 'ja-JP',
        lg: 'lg-UG',
        ln: 'ln-CD',
        sw: 'sw-KE',
        de: 'de-DE',
        es: 'es-ES',
        ar: 'ar-SA',
        hi: 'hi-IN',
        pt: 'pt-BR',
        zh: 'zh-CN',
        ko: 'ko-KR',
        it: 'it-IT',
        nl: 'nl-NL',
        pl: 'pl-PL',
        ru: 'ru-RU',
        tr: 'tr-TR',
        vi: 'vi-VN',
        id: 'id-ID',
        am: 'am-ET',
        ha: 'ha-NG',
        yo: 'yo-NG',
        zu: 'zu-ZA',
    };
    return defaults[code] || `${code}-${code.toUpperCase()}`;
}

function parseSpeakError(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
        return 'Read-aloud is unavailable right now.';
    }
    try {
        const parsed = JSON.parse(trimmed) as {error?: string};
        if (parsed.error) {
            return parsed.error;
        }
    } catch {
        // plain text from plugin http.Error
    }
    if (trimmed.length > 200) {
        return trimmed.slice(0, 200) + '…';
    }
    return trimmed;
}

function pickBrowserVoice(language: string, voiceGender?: string): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        return null;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
        return null;
    }

    const langPrefix = toBcp47(language).toLowerCase().split('-')[0];
    const languageMatches = voices.filter((voice) => voice.lang.toLowerCase().startsWith(langPrefix));
    if (languageMatches.length === 0) {
        return null;
    }

    const pool = languageMatches;

    const gender = (voiceGender || 'neutral').toLowerCase();
    const femalePattern = /female|woman|girl|zira|samantha|victoria|hazel|susan|karen|moira|tessa|amelie|marie|claire/i;
    const malePattern = /male|man|boy|david|mark|james|daniel|thomas|paul|george|henri|nicolas/i;

    if (gender === 'female') {
        return pool.find((voice) => femalePattern.test(voice.name)) || pool[0] || null;
    }
    if (gender === 'male') {
        return pool.find((voice) => malePattern.test(voice.name)) || pool[0] || null;
    }

    return pool[0] || null;
}

function ensureBrowserVoicesReady(): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        return Promise.resolve();
    }
    if (window.speechSynthesis.getVoices().length > 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const done = () => {
            window.speechSynthesis.removeEventListener('voiceschanged', done);
            resolve();
        };
        window.speechSynthesis.addEventListener('voiceschanged', done);
        window.setTimeout(done, 400);
    });
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
    void ensureBrowserVoicesReady();
}

type SpeakResolve = {
    text: string;
    language: string;
    voice_gender?: string;
    read_aloud_mode?: string;
};

export function bindSpeakStore(store: Store<GlobalState>) {
    speakStoreRef = store;
}

function getClientSpeakPayload(postId: string): SpeakResolve | null {
    if (!speakStoreRef || !postId) {
        return null;
    }

    const state = speakStoreRef.getState();
    const currentUserId = state.entities?.users?.currentUserId || '';
    const post = state.entities?.posts?.posts?.[postId] as Post | undefined;
    if (!post?.id) {
        return null;
    }

    const pluginState = getPluginState(state as Record<string, unknown>);
    const readMode: ReadAloudMode = pluginState.readAloudMode;
    const targetLanguage = getMyReceiveLanguage(pluginState, currentUserId);
    const voiceGender = pluginState.ttsVoiceGender;
    const record = pluginState.byPostId[postId];
    const message = post.message?.trim() || '';
    const hasCurrentTranslation = Boolean(
        record?.translated?.trim() &&
        isTranslationRecordCurrent(record, targetLanguage) &&
        !record.sameLanguage,
    );

    if (!message) {
        return null;
    }

    if (currentUserId && post.user_id === currentUserId) {
        return {
            text: message,
            language: record?.detectedFrom || targetLanguage,
            voice_gender: voiceGender,
            read_aloud_mode: readMode,
        };
    }

    if (readMode === 'receive' && hasCurrentTranslation) {
        return {
            text: record!.translated,
            language: record!.to || targetLanguage,
            voice_gender: voiceGender,
            read_aloud_mode: readMode,
        };
    }

    return {
        text: message,
        language: record?.detectedFrom || targetLanguage,
        voice_gender: voiceGender,
        read_aloud_mode: readMode,
    };
}

async function fetchSpeakResolveWithTimeout(postId: string, clientPayload?: SpeakResolve | null, timeoutMs = 12000): Promise<SpeakResolve> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${API_BASE}/speak/resolve`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({
                post_id: postId,
                voice_gender: clientPayload?.voice_gender,
                read_aloud_mode: clientPayload?.read_aloud_mode,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Could not prepare speech (${response.status})`);
        }

        const server = await response.json() as SpeakResolve;
        if (!clientPayload) {
            return server;
        }

        return {
            text: clientPayload.text || server.text,
            language: clientPayload.language || server.language,
            voice_gender: clientPayload.voice_gender || server.voice_gender,
            read_aloud_mode: clientPayload.read_aloud_mode || server.read_aloud_mode,
        };
    } finally {
        window.clearTimeout(timer);
    }
}

async function resolveSpeakPayload(postId: string): Promise<SpeakResolve> {
    const clientPayload = getClientSpeakPayload(postId);
    try {
        return await fetchSpeakResolveWithTimeout(postId, clientPayload);
    } catch {
        if (clientPayload?.text) {
            return clientPayload;
        }
        throw new Error('Could not prepare speech for this message.');
    }
}

export async function fetchSpeakPreview(postId: string): Promise<{language: string; languageLabel: string}> {
    const clientPayload = getClientSpeakPayload(postId);
    if (clientPayload?.language) {
        return {
            language: clientPayload.language,
            languageLabel: languageCodeLabel(clientPayload.language),
        };
    }

    const resolved = await resolveSpeakPayload(postId);
    const language = resolved.language || 'en';
    return {
        language,
        languageLabel: languageCodeLabel(language),
    };
}

async function playWithBrowserSpeech(postId: string, text: string, language: string, voiceGender?: string): Promise<'started'> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        throw new Error('This browser does not support read-aloud.');
    }

    await ensureBrowserVoicesReady();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = toBcp47(language);
    const selectedVoice = pickBrowserVoice(language, voiceGender);
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }
    utterance.onend = () => {
        stopActiveSpeech();
    };
    utterance.onerror = () => {
        stopActiveSpeech();
    };

    activePostId = postId;
    usingBrowserSpeech = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    notifyListeners();
    return 'started';
}

async function playWithGoogleAudio(postId: string, cacheKey: string, blob: Blob): Promise<'started'> {
    cachePostAudio(cacheKey, blob);
    activeObjectUrl = URL.createObjectURL(blob);
    activePostId = postId;
    activeAudio = new Audio(activeObjectUrl);
    activeAudio.onended = () => {
        stopActiveSpeech();
    };
    activeAudio.onerror = () => {
        stopActiveSpeech();
    };

    await activeAudio.play();
    notifyListeners();
    return 'started';
}

export async function playPostSpeech(postId: string): Promise<'started' | 'stopped'> {
    if (activePostId === postId && isSpeechPlaying()) {
        stopActiveSpeech();
        return 'stopped';
    }

    stopActiveSpeech();

    const clientPayload = getClientSpeakPayload(postId);
    const voiceGender = clientPayload?.voice_gender || 'neutral';
    const readMode = clientPayload?.read_aloud_mode || 'receive';
    const cacheKey = speakCacheKey(postId, voiceGender, readMode);

    const cached = postAudioCache.get(cacheKey);
    if (cached && cached.size > 0) {
        return playWithGoogleAudio(postId, cacheKey, cached);
    }

    const resolved = clientPayload || await resolveSpeakPayload(postId);
    const text = resolved.text?.trim();
    if (!text) {
        throw new Error('No text available to read aloud.');
    }

    const language = resolved.language || 'en';
    const requestVoice = resolved.voice_gender || voiceGender;
    const requestReadMode = resolved.read_aloud_mode || readMode;

    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);
        let response: Response;
        try {
            response = await fetch(`${API_BASE}/speak`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    post_id: postId,
                    voice_gender: requestVoice,
                    read_aloud_mode: requestReadMode,
                }),
                signal: controller.signal,
            });
        } finally {
            window.clearTimeout(timer);
        }

        if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
                return playWithGoogleAudio(postId, cacheKey, blob);
            }
        }
    } catch {
        // Fall through to browser speech below.
    }

    return playWithBrowserSpeech(postId, text, language, requestVoice);
}
