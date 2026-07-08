import type {FileInfo} from '@mattermost/types/files';
import type {Post} from '@mattermost/types/posts';

import {getVideoTranscript, isVideoNotePost} from './video_post_utils';

export function isVoiceFileInfo(file: FileInfo): boolean {
    if (file.name?.startsWith('voice-note-')) {
        return true;
    }
    const audioExtensions = ['webm', 'ogg', 'm4a', 'mp3', 'wav', 'mp4'];
    return Boolean(
        file.mime_type?.startsWith('audio/') &&
        audioExtensions.includes((file.extension || '').toLowerCase()),
    );
}

export function isVoiceNotePost(post: Post | null | undefined): boolean {
    if (!post) {
        return false;
    }
    if (post.type === 'custom_voice_note') {
        return true;
    }
    if (post.props?.voice_note) {
        return true;
    }

    const files = post.metadata?.files || [];
    if (files.some(isVoiceFileInfo)) {
        return true;
    }

    if ((post.file_ids?.length ?? 0) > 0) {
        const message = (post.message || '').trim().toLowerCase();
        if (!message || message === 'voice message') {
            return true;
        }
    }

    return false;
}

export function isMediaNotePost(post: Post | null | undefined): boolean {
    return isVoiceNotePost(post) || isVideoNotePost(post);
}

export function getVoiceDurationMs(post: Post): number | undefined {
    const fromProps = post.props?.voice_duration_ms;
    if (typeof fromProps === 'number' && fromProps > 0) {
        return fromProps;
    }
    if (typeof fromProps === 'string') {
        const parsed = Number(fromProps);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

export function getVoiceFileId(post: Post): string | undefined {
    const fromProps = typeof post.props?.voice_file_id === 'string'
        ? post.props.voice_file_id.trim()
        : '';
    if (fromProps) {
        return fromProps;
    }
    const files = post.metadata?.files || [];
    const voiceFile = files.find(isVoiceFileInfo);
    if (voiceFile?.id) {
        return voiceFile.id;
    }
    return post.file_ids?.[0];
}

export function getVoiceTranscript(post: Post): string {
    const fromProps = typeof post.props?.voice_transcript === 'string'
        ? post.props.voice_transcript.trim()
        : '';
    if (fromProps) {
        return fromProps;
    }

    const message = post.message?.trim() || '';
    if (!message || message.toLowerCase() === 'voice message') {
        return '';
    }
    return message;
}

export function getPostTranslationSourceText(post: Post): string {
    if (isVideoNotePost(post)) {
        return getVideoTranscript(post);
    }
    if (isVoiceNotePost(post)) {
        return getVoiceTranscript(post);
    }
    return post.message?.trim() || '';
}

export function shouldIncludePostInTranslationSync(post: Post): boolean {
    if (!post.id) {
        return false;
    }
    if (isMediaNotePost(post)) {
        return false;
    }
    return Boolean(getPostTranslationSourceText(post));
}

export function shouldOverrideVoicePreview(fileInfo: FileInfo, post?: Post): boolean {
    if (isVoiceFileInfo(fileInfo)) {
        return true;
    }
    return Boolean(post && isVoiceNotePost(post));
}
