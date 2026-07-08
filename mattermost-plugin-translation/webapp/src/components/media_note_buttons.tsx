import React, {useCallback, useEffect, useRef, useState} from 'react';

import LanguageSelect from './language_select';
import VoiceNoteButton from './voice_note_button';
import VideoNoteButton from './video_note_button';
import {getLanguageLabel} from '../language_options';
import {loadSpeakingLanguage, saveSpeakingLanguage} from '../speech_recognition_bcp47';

type MediaDraft = {
    channelId: string;
    rootId?: string;
    message?: string;
};

type Props = {
    draft: MediaDraft;
    getSelectedText?: () => {start?: number | null; end?: number | null};
    updateText?: (message: string) => void;
};

const AUTO_SPEAK_LANGUAGE = '';

export default function MediaNoteButtons(props: Props) {
    const [speakingLanguage, setSpeakingLanguage] = useState(AUTO_SPEAK_LANGUAGE);
    const [langPanelOpen, setLangPanelOpen] = useState(false);
    const wrapRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        setSpeakingLanguage(loadSpeakingLanguage(AUTO_SPEAK_LANGUAGE));
    }, []);

    useEffect(() => {
        if (!langPanelOpen) {
            return undefined;
        }
        const handlePointerDown = (event: MouseEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) {
                setLangPanelOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [langPanelOpen]);

    const handleLanguageChange = useCallback((code: string) => {
        const normalized = code.trim().toLowerCase();
        setSpeakingLanguage(normalized);
        if (normalized) {
            saveSpeakingLanguage(normalized);
        }
    }, []);

    const speakingLabel = speakingLanguage
        ? getLanguageLabel(speakingLanguage).slice(0, 2).toUpperCase()
        : 'A';

    return (
        <span
            ref={wrapRef}
            className='translation-media-note-buttons'
        >
            <span className='translation-media-note-buttons__lang-wrap'>
                <button
                    type='button'
                    className='translation-media-note-buttons__lang-toggle'
                    onClick={() => setLangPanelOpen((open) => !open)}
                    title='Speaking language (optional hint for voice/video)'
                    aria-label='Speaking language'
                    aria-expanded={langPanelOpen}
                >
                    {speakingLabel}
                </button>
                {langPanelOpen && (
                    <div className='translation-media-note-buttons__lang-panel'>
                        <div className='translation-media-note-buttons__lang-label'>I am speaking</div>
                        <LanguageSelect
                            value={speakingLanguage || 'en'}
                            onChange={handleLanguageChange}
                        />
                        <div className='translation-media-note-buttons__lang-hint'>
                            Optional hint before you record. Leave as your usual language, or pick another if you switch languages often.
                        </div>
                    </div>
                )}
            </span>
            <VoiceNoteButton
                {...props}
                speakingLanguage={speakingLanguage || undefined}
            />
            <VideoNoteButton
                {...props}
                speakingLanguage={speakingLanguage || undefined}
            />
        </span>
    );
}
