import React, {useEffect, useState} from 'react';

import type {AuthorDeliverySummary, AuthorLanguageDelivery, TranslationRecord} from '../reducer';
import {getLanguageLabel} from '../language_options';
import {buildGoogleTranslateUrl, usesGoogleTranslate} from '../google_translate_link';
import {certaintyLabel, CERTAINTY_TOOLTIP, qualityPercent} from '../translation_quality_labels';
import TranslationBacktranslationDiff from './translation_backtranslation_diff';

function deliveryAsRecord(summary: AuthorDeliverySummary, delivery: AuthorLanguageDelivery): TranslationRecord {
    return {
        postId: summary.postId,
        origin: summary.origin,
        translated: delivery.translated,
        from: delivery.from,
        to: delivery.language,
        detectedFrom: delivery.detectedFrom,
        engine: delivery.engine,
        reversed: delivery.reversed,
        score: delivery.score,
        semanticScore: delivery.semanticScore,
        embeddingScore: delivery.embeddingScore,
        qualityScore: delivery.qualityScore,
        cached: delivery.cached,
        sameLanguage: delivery.sameLanguage,
        auto: true,
        loading: false,
    };
}

function qualityRange(languages: AuthorLanguageDelivery[]): {min: number; max: number} {
    const values = languages.map((lang) => qualityPercent(deliveryAsRecord({} as AuthorDeliverySummary, lang)));
    return {
        min: Math.min(...values),
        max: Math.max(...values),
    };
}

function worstDelivery(summary: AuthorDeliverySummary): AuthorLanguageDelivery {
    return summary.languages.reduce((worst, current) => {
        const worstScore = qualityPercent(deliveryAsRecord(summary, worst));
        const currentScore = qualityPercent(deliveryAsRecord(summary, current));
        return currentScore < worstScore ? current : worst;
    });
}

type SummaryBadgeProps = {
    summary: AuthorDeliverySummary;
};

function AuthorDeliverySummaryBadge({summary}: SummaryBadgeProps) {
    const worst = worstDelivery(summary);
    const record = deliveryAsRecord(summary, worst);
    const certainty = certaintyLabel(record);
    const range = qualityRange(summary.languages);
    const scoreLabel = range.min === range.max ? `${range.max}%` : `${range.min}%–${range.max}%`;

    return (
        <div className={`translation-quality translation-quality--${certainty.tier}`}>
            <div className='translation-quality__summary'>
                <span
                    className='translation-quality__label'
                    title={CERTAINTY_TOOLTIP}
                >
                    Certainty score
                </span>
                <span className='translation-quality__score'>{scoreLabel}</span>
                <span
                    className={`translation-quality__certainty translation-quality__certainty--${certainty.tier}`}
                    title={CERTAINTY_TOOLTIP}
                >
                    {range.min === range.max ? certainty.text : `Lowest: ${certainty.text}`}
                </span>
                <span
                    className='translation-quality__bar'
                    role='progressbar'
                    aria-valuenow={range.min}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Certainty score ${scoreLabel}`}
                    title={CERTAINTY_TOOLTIP}
                >
                    <span
                        className='translation-quality__bar-fill'
                        style={{width: `${range.min}%`}}
                    />
                </span>
            </div>
            <div className='translation-quality__details'>
                <span className='translation-quality__chip'>
                    {summary.languageCount} {summary.languageCount === 1 ? 'language' : 'languages'}
                </span>
                <span className='translation-quality__chip'>
                    {summary.recipientCount} {summary.recipientCount === 1 ? 'reader' : 'readers'}
                </span>
            </div>
        </div>
    );
}

type LanguageRowProps = {
    summary: AuthorDeliverySummary;
    delivery: AuthorLanguageDelivery;
    expanded: boolean;
    onToggle: () => void;
};

function AuthorLanguageRow({summary, delivery, expanded, onToggle}: LanguageRowProps) {
    const readerLabel = delivery.readerCount === 1 ? '1 reader' : `${delivery.readerCount} readers`;

    if (delivery.sameLanguage) {
        return (
            <div className='translation-author-lang'>
                <div className='translation-author-lang__header translation-author-lang__header--static'>
                    <span className='translation-author-lang__title'>
                        {getLanguageLabel(delivery.language)}
                    </span>
                    <span className='translation-author-lang__meta'>{readerLabel}</span>
                    <span className='translation-author-lang__meta'>Delivered as written</span>
                </div>
            </div>
        );
    }

    const record = deliveryAsRecord(summary, delivery);
    const overall = qualityPercent(record);
    const certainty = certaintyLabel(record);
    const googleUsed = usesGoogleTranslate(record);

    return (
        <div className='translation-author-lang'>
            <button
                type='button'
                className='translation-author-lang__header'
                onClick={onToggle}
                aria-expanded={expanded}
            >
                <span className='translation-author-lang__title'>
                    {getLanguageLabel(delivery.language)}
                </span>
                <span className='translation-author-lang__meta'>{readerLabel}</span>
                <span className={`translation-author-lang__score translation-author-lang__score--${certainty.tier}`}>
                    {overall}% · {certainty.text}
                </span>
            </button>
            {expanded && (
                <div className='translation-author-lang__body translation-panel__details'>
                    {delivery.translated.trim() && (
                        <div className='translation-panel__block'>
                            <div className='translation-panel__text'>{delivery.translated.trim()}</div>
                        </div>
                    )}
                    {delivery.reversed?.trim() && (
                        <TranslationBacktranslationDiff
                            original={summary.origin}
                            reversed={delivery.reversed}
                        />
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
            )}
        </div>
    );
}

type Props = {
    summary: AuthorDeliverySummary;
    showDetails: boolean;
};

export default function TranslationAuthorDelivery({summary, showDetails}: Props) {
    const [expandedLang, setExpandedLang] = useState<string | null>(null);

    useEffect(() => {
        if (!showDetails) {
            setExpandedLang(null);
        }
    }, [showDetails]);

    if (summary.loading) {
        return (
            <div className='translation-panel translation-attachment'>
                <span className='translation-panel__meta'>Checking delivery to readers…</span>
            </div>
        );
    }

    if (summary.error) {
        return (
            <div className='translation-panel translation-attachment translation-panel--error'>
                <div className='translation-panel__error'>{summary.error}</div>
            </div>
        );
    }

    if (summary.languages.length === 0) {
        return (
            <div className='translation-panel translation-attachment translation-attachment--author'>
                <span className='translation-panel__meta'>Loading delivery details for channel readers…</span>
            </div>
        );
    }

    const hasTranslatedDelivery = summary.languages.some((delivery) => !delivery.sameLanguage);
    if (!hasTranslatedDelivery) {
        return null;
    }

    if (!showDetails) {
        return null;
    }

    return (
        <div className='translation-panel translation-attachment translation-attachment--author'>
            <div className='translation-panel__header'>
                <AuthorDeliverySummaryBadge summary={summary} />
            </div>
            <div className='translation-panel__details'>
                <div className='translation-panel__block'>
                    <div className='translation-panel__original-label'>Delivery by language</div>
                    <p className='translation-author-delivery__hint'>
                        Each person in this channel sees your message in their receive language.
                        Scores can differ by language.
                    </p>
                </div>
                <div className='translation-author-delivery__list'>
                    {summary.languages.map((delivery) => (
                        <AuthorLanguageRow
                            key={delivery.language}
                            summary={summary}
                            delivery={delivery}
                            expanded={expandedLang === delivery.language}
                            onToggle={() => {
                                setExpandedLang((current) => (
                                    current === delivery.language ? null : delivery.language
                                ));
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
