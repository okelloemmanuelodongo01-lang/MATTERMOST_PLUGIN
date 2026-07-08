import React from 'react';

import {diffWords, type DiffToken} from '../translation_diff';

type Props = {
    original: string;
    reversed: string;
    label?: string;
};

function renderDiffTokens(tokens: DiffToken[]) {
    return tokens.map((token, index) => {
        const prefix = index > 0 ? ' ' : '';
        if (token.kind === 'same') {
            return (
                <span key={`${token.text}-${index}`} className='translation-diff__same'>
                    {prefix}{token.text}
                </span>
            );
        }
        if (token.kind === 'removed') {
            return (
                <span key={`${token.text}-${index}`} className='translation-diff__removed'>
                    {prefix}{token.text}
                </span>
            );
        }
        return (
            <span key={`${token.text}-${index}`} className='translation-diff__added'>
                {prefix}{token.text}
            </span>
        );
    });
}

export default function TranslationBacktranslationDiff({original, reversed, label = 'Difference: original / back-translation'}: Props) {
    const originalTrim = original.trim();
    const reversedTrim = reversed.trim();

    if (!originalTrim || !reversedTrim) {
        return null;
    }

    const isMatch = originalTrim.toLowerCase() === reversedTrim.toLowerCase();

    if (isMatch) {
        return (
            <div className='translation-panel__diff translation-panel__diff--match'>
                <div className='translation-panel__diff-label'>{label}</div>
                <div className='translation-panel__diff-body'>Back-translation matches the original.</div>
            </div>
        );
    }

    const tokens = diffWords(originalTrim, reversedTrim);

    return (
        <div className='translation-panel__diff'>
            <div className='translation-panel__diff-label'>Difference: original / back-translation</div>
            <div className='translation-panel__diff-body'>
                {renderDiffTokens(tokens)}
            </div>
        </div>
    );
}
