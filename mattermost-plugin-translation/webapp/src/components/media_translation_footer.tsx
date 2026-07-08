import React from 'react';

import type {TranslationRecord} from '../reducer';
import {buildGoogleTranslateUrl, usesGoogleTranslate} from '../google_translate_link';
import {getLanguageLabel} from '../language_options';

type Props = {
    record: TranslationRecord;
};

export default function MediaTranslationFooter({record}: Props) {
    const detected = (record.detectedFrom || record.from || '').trim();
    const detectedLabel = detected ? getLanguageLabel(detected) : '';
    const googleUsed = usesGoogleTranslate(record);
    const uncertain = Boolean(record.languageUncertain);

    if (!detectedLabel && !googleUsed) {
        return null;
    }

    return (
        <div className='translation-voice-panel__footer'>
            {detectedLabel && (
                <span className='translation-voice-panel__detected'>
                    {detectedLabel} detected
                    {uncertain && (
                        <span
                            className='translation-voice-panel__uncertain'
                            title='Language detection may be uncertain for this recording'
                        >
                            ?
                        </span>
                    )}
                </span>
            )}
            {googleUsed && (
                <a
                    className='translation-voice-panel__google-link'
                    href={buildGoogleTranslateUrl(record)}
                    target='_blank'
                    rel='noopener noreferrer'
                    title='Open this transcript in Google Translate'
                >
                    Translated by Google
                </a>
            )}
        </div>
    );
}
