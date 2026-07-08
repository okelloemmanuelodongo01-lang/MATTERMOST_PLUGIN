import React, {useCallback, useEffect, useRef, useState} from 'react';

import MicrophoneIcon from './microphone_icon';
import {createVoicePost, uploadChannelFile} from '../mattermost_api';
import {
    formatRecordingDuration,
    isRecordingAtLimit,
    isRecordingNearLimit,
    isRecordingTooShort,
    MAX_MEDIA_DURATION_MS,
} from '../media_recording_limits';
import {VoiceRecorderSession} from '../voice_recorder';

type VoiceDraft = {
    channelId: string;
    rootId?: string;
    message?: string;
};

type Props = {
    draft: VoiceDraft;
    getSelectedText?: () => {start?: number | null; end?: number | null};
    updateText?: (message: string) => void;
    speakingLanguage?: string;
};

type Status = 'idle' | 'recording' | 'paused' | 'sending';

export default function VoiceNoteButton({draft, speakingLanguage}: Props) {
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const sessionRef = useRef<VoiceRecorderSession | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const sendRecordingRef = useRef<() => Promise<void>>(async () => undefined);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const syncElapsed = useCallback(() => {
        const session = sessionRef.current;
        if (session) {
            const elapsed = session.getElapsedMs();
            setElapsedMs(elapsed);
            if (isRecordingAtLimit(elapsed) && session.getState() !== 'inactive') {
                void sendRecordingRef.current();
            }
        }
    }, []);

    useEffect(() => {
        return () => {
            clearTimer();
            sessionRef.current?.cancel();
        };
    }, [clearTimer]);

    const sendRecording = useCallback(async () => {
        const session = sessionRef.current;
        if (!session) {
            return;
        }

        clearTimer();
        setStatus('sending');

        try {
            const result = await session.stop();
            sessionRef.current = null;

            if (!draft.channelId) {
                throw new Error('No channel selected.');
            }

            if (isRecordingTooShort(result.durationMs)) {
                throw new Error('Recording is too short. Hold the button for at least 2 seconds.');
            }

            const audioFile = new File([result.blob], result.fileName, {type: result.mimeType});
            const fileId = await uploadChannelFile(draft.channelId, audioFile);
            await createVoicePost({
                channelId: draft.channelId,
                rootId: draft.rootId,
                fileId,
                transcript: result.transcript,
                durationMs: result.durationMs,
                speakingLanguage,
            });

            setStatus('idle');
            setElapsedMs(0);
        } catch (err) {
            sessionRef.current = null;
            setStatus('idle');
            setError(err instanceof Error ? err.message : 'Failed to send voice message.');
        }
    }, [clearTimer, draft.channelId, draft.rootId, speakingLanguage]);

    sendRecordingRef.current = sendRecording;

    const startRecording = useCallback(async () => {
        setError(null);
        setElapsedMs(0);
        const session = new VoiceRecorderSession();
        sessionRef.current = session;

        try {
            await session.start();
            setStatus('recording');
            clearTimer();
            timerRef.current = setInterval(syncElapsed, 250);
        } catch (err) {
            session.cancel();
            sessionRef.current = null;
            setStatus('idle');
            setError(err instanceof Error ? err.message : 'Could not access the microphone.');
        }
    }, [clearTimer, syncElapsed]);

    const cancelRecording = useCallback(() => {
        clearTimer();
        sessionRef.current?.cancel();
        sessionRef.current = null;
        setStatus('idle');
        setElapsedMs(0);
        setError(null);
    }, [clearTimer]);

    const togglePause = useCallback(() => {
        const session = sessionRef.current;
        if (!session) {
            return;
        }
        if (session.getState() === 'paused') {
            session.resume();
            setStatus('recording');
        } else {
            session.pause();
            setStatus('paused');
        }
        syncElapsed();
    }, [syncElapsed]);

    const isActive = status === 'recording' || status === 'paused';
    const nearLimit = isRecordingNearLimit(elapsedMs);

    if (isActive || status === 'sending') {
        return (
            <span className='translation-voice-note translation-voice-note--active'>
                <span
                    className={
                        'translation-voice-note__timer' +
                        (status === 'paused' ? ' translation-voice-note__timer--paused' : '') +
                        (nearLimit ? ' translation-voice-note__timer--warn' : '')
                    }
                    aria-live='polite'
                    title={nearLimit ? 'Recording limit is 5 minutes' : undefined}
                >
                    {status === 'sending' ? 'Sending…' : formatRecordingDuration(elapsedMs)}
                </span>
                {status !== 'sending' && (
                    <>
                        <button
                            type='button'
                            className='translation-voice-note__control'
                            onClick={togglePause}
                            title={status === 'paused' ? 'Resume recording' : 'Pause recording'}
                            aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
                        >
                            {status === 'paused' ? '▶' : '❚❚'}
                        </button>
                        <button
                            type='button'
                            className='translation-voice-note__control translation-voice-note__control--delete'
                            onClick={cancelRecording}
                            title='Delete recording'
                            aria-label='Delete recording'
                        >
                            ✕
                        </button>
                        <button
                            type='button'
                            className='translation-voice-note__control translation-voice-note__control--send'
                            onClick={() => void sendRecording()}
                            title='Send voice message'
                            aria-label='Send voice message'
                        >
                            ➤
                        </button>
                    </>
                )}
                {error && (
                    <span
                        className='translation-voice-note__error'
                        role='alert'
                    >
                        {error}
                    </span>
                )}
            </span>
        );
    }

    return (
        <span className='translation-voice-note'>
            <button
                type='button'
                className='translation-voice-note__btn'
                onClick={() => void startRecording()}
                aria-label='Record voice message'
                title={`Record voice message (max ${MAX_MEDIA_DURATION_MS / 60000} min)`}
            >
                <MicrophoneIcon size={22}/>
            </button>
            {error && (
                <span
                    className='translation-voice-note__error'
                    role='alert'
                >
                    {error}
                </span>
            )}
        </span>
    );
}
