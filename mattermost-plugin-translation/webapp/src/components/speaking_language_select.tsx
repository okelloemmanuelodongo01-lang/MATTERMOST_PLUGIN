import React, {useEffect, useState} from 'react';

import LanguageSelect from './language_select';
import {loadSpeakingLanguage, saveSpeakingLanguage} from '../speech_recognition_bcp47';

type Props = {
    value: string;
    onChange: (code: string) => void;
    className?: string;
    disabled?: boolean;
};

export function useSpeakingLanguage(defaultCode = 'en'): [string, (code: string) => void] {
    const [value, setValue] = useState(() => loadSpeakingLanguage(defaultCode));

    const onChange = (code: string) => {
        setValue(code);
        saveSpeakingLanguage(code);
    };

    return [value, onChange];
}

export default function SpeakingLanguageSelect({value, onChange, className, disabled}: Props) {
    useEffect(() => {
        saveSpeakingLanguage(value);
    }, [value]);

    return (
        <LanguageSelect
            className={className}
            value={value}
            disabled={disabled}
            onChange={onChange}
        />
    );
}
