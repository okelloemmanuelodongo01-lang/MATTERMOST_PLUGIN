import React from 'react';

import PreferenceSelect from './preference_select';

export type VoiceGender = 'male' | 'female' | 'neutral';

type Props = {
    value: VoiceGender;
    disabled?: boolean;
    className?: string;
    onChange: (value: VoiceGender) => void;
};

const OPTIONS = [
    {value: 'neutral', label: 'Neutral'},
    {value: 'female', label: 'Female'},
    {value: 'male', label: 'Male'},
];

export default function VoiceGenderSelect({value, disabled, className = '', onChange}: Props) {
    return (
        <PreferenceSelect
            className={`translation-voice-gender-select ${className}`.trim()}
            value={value}
            options={OPTIONS}
            disabled={disabled}
            aria-label='Read-aloud voice'
            onChange={(next) => onChange(next as VoiceGender)}
        />
    );
}
