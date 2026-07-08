import React from 'react';

import TranslationBacktranslationDiff from './translation_backtranslation_diff';

type Props = {
    original: string;
    reversed?: string;
    showDiff?: boolean;
};

export default function TranslationOriginalDiff({original, reversed, showDiff = true}: Props) {
    const sourceText = original.trim();
    const reversedText = reversed?.trim() || '';

    if (!sourceText) {
        return null;
    }

    const canShowDiff = showDiff && Boolean(reversedText);

    return (
        <>
            <div className='translation-panel__block'>
                <div className='translation-panel__original-label'>Original</div>
                <div className='translation-panel__text'>{sourceText}</div>
            </div>
            {canShowDiff && (
                <TranslationBacktranslationDiff
                    original={sourceText}
                    reversed={reversedText}
                />
            )}
        </>
    );
}
