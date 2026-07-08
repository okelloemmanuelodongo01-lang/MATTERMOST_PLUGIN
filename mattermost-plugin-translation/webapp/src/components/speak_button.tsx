import React, {useCallback, useEffect, useState} from 'react';

import SpeakerIcon from './speaker_icon';
import {fetchSpeakPreview, getActiveSpeechPostId, onSpeechStateChange, playPostSpeech, stopActiveSpeech} from '../speak_client';

type Props = {
    postId: string;
    className?: string;
};

export default function SpeakButton({postId, className = ''}: Props) {
    const [loading, setLoading] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [readingLanguage, setReadingLanguage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetchSpeakPreview(postId)
            .then((preview) => {
                if (!cancelled) {
                    setReadingLanguage(preview.languageLabel);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setReadingLanguage(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [postId]);

    useEffect(() => {
        return onSpeechStateChange((activeId) => {
            setPlaying(activeId === postId);
            setLoading(false);
        });
    }, [postId]);

    useEffect(() => {
        return () => {
            if (getActiveSpeechPostId() === postId) {
                stopActiveSpeech();
            }
        };
    }, [postId]);

    const handleClick = useCallback(async (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if ('stopImmediatePropagation' in event.nativeEvent) {
            event.nativeEvent.stopImmediatePropagation();
        }

        setError(null);

        if (playing) {
            stopActiveSpeech();
            return;
        }

        setLoading(true);
        try {
            await playPostSpeech(postId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read message aloud.');
        } finally {
            setLoading(false);
        }
    }, [postId, playing]);

    const label = loading
        ? 'Preparing audio'
        : playing
            ? 'Stop reading aloud'
            : readingLanguage
                ? `Read message aloud (${readingLanguage})`
                : 'Read message aloud';

    return (
        <span className={`translation-speak-button-wrap ${className}`.trim()}>
            <button
                type='button'
                className={
                    'translation-speak-button' +
                    (playing ? ' translation-speak-button--playing' : '') +
                    (loading ? ' translation-speak-button--loading' : '')
                }
                onClick={(event) => void handleClick(event)}
                onPointerDown={(event) => {
                    event.stopPropagation();
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
                aria-label={label}
                title={label}
                disabled={loading}
            >
                <SpeakerIcon
                    size={13}
                    active={playing}
                />
            </button>
            {error && (
                <span
                    className='translation-speak-button__error'
                    role='alert'
                >
                    {error}
                </span>
            )}
        </span>
    );
}
