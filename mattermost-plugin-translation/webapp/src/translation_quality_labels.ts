import type {TranslationRecord} from './reducer';

export function qualityFraction(record: TranslationRecord): number {
    const raw = record.qualityScore > 0 ? record.qualityScore : record.score;
    return Math.max(0, Math.min(1, raw));
}

export function qualityPercent(record: TranslationRecord): number {
    return Math.round(qualityFraction(record) * 100);
}

export type CertaintyLabel = {
    text: string;
    tier: 'excellent' | 'good' | 'soso' | 'poor';
};

/** TransChecker-style certainty label from 0–1 quality score. */
export function certaintyLabel(record: TranslationRecord): CertaintyLabel {
    const value = qualityFraction(record);

    if (value >= 0.85) {
        return {text: 'Excellent', tier: 'excellent'};
    }
    if (value >= 0.7) {
        return {text: 'Good', tier: 'good'};
    }
    if (value >= 0.55) {
        return {text: 'So So', tier: 'soso'};
    }
    return {text: 'Low', tier: 'poor'};
}

export const CERTAINTY_TOOLTIP =
    'Certainty score shows how accurate the translation is. Closer to 100% means higher confidence. ' +
    'If the score is low, the message may be difficult to machine translate.';
