import React from 'react';

import type {TranslationRecord} from '../reducer';

import {buildGoogleTranslateUrl, usesGoogleTranslate} from '../google_translate_link';
import {certaintyLabel, CERTAINTY_TOOLTIP, qualityPercent} from '../translation_quality_labels';

type Props = {
    record: TranslationRecord;
};

function pct(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export default function TranslationQualityBadge({record}: Props) {
    if (record.cached && record.qualityScore <= 0 && record.score <= 0) {
        return (
            <div className='translation-quality translation-quality--cached'>
                <span className='translation-quality__label'>Certainty score</span>
                <span className='translation-quality__meta'>Cached result</span>
            </div>
        );
    }

    const overall = qualityPercent(record);
    const certainty = certaintyLabel(record);
    const backPct = pct(record.score);
    const semanticPct = pct(record.semanticScore);
    const embeddingPct = pct(record.embeddingScore);
    const googleUsed = usesGoogleTranslate(record);
    const isFastPath = record.engine.includes(':fast');

    return (
        <div className={`translation-quality translation-quality--${certainty.tier}`}>
            <div className='translation-quality__summary'>
                <span
                    className='translation-quality__label'
                    title={CERTAINTY_TOOLTIP}
                >
                    Certainty score
                </span>
                <span className='translation-quality__score'>{overall}%</span>
                <span
                    className={`translation-quality__certainty translation-quality__certainty--${certainty.tier}`}
                    title={CERTAINTY_TOOLTIP}
                >
                    {certainty.text}
                </span>
                <span
                    className='translation-quality__bar'
                    role='progressbar'
                    aria-valuenow={overall}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Certainty score ${overall}%`}
                    title={CERTAINTY_TOOLTIP}
                >
                    <span
                        className='translation-quality__bar-fill'
                        style={{width: `${overall}%`}}
                    />
                </span>
            </div>
            <div className='translation-quality__details'>
                <span className='translation-quality__chip'>Back-translation {backPct}%</span>
                <span className='translation-quality__chip'>Semantic {semanticPct}%</span>
                {!isFastPath && (
                    <span className='translation-quality__chip'>AI match {embeddingPct}%</span>
                )}
                {googleUsed && (
                    <a
                        className='translation-quality__google-link'
                        href={buildGoogleTranslateUrl(record)}
                        target='_blank'
                        rel='noopener noreferrer'
                        title='Open this message in Google Translate'
                    >
                        Translated by Google
                    </a>
                )}
            </div>
        </div>
    );
}
