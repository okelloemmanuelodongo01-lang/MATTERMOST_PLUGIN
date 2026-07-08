import React from 'react';

import type {ReadAloudMode} from '../reducer';
import PreferenceSelect from './preference_select';

type Props = {
    value: ReadAloudMode;
    disabled?: boolean;
    className?: string;
    onChange: (value: ReadAloudMode) => void;
};

const OPTIONS = [
    {value: 'receive', label: 'My language (translated)'},
    {value: 'original', label: 'Original message'},
];

export default function ReadAloudModeSelect({value, disabled, className = '', onChange}: Props) {
    return (
        <PreferenceSelect
            className={`translation-read-aloud-mode-select ${className}`.trim()}
            value={value}
            options={OPTIONS}
            disabled={disabled}
            aria-label='Read-aloud text'
            onChange={(next) => onChange(next as ReadAloudMode)}
        />
    );
}
