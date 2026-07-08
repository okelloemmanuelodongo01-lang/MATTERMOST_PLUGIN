import React, {useEffect, useState} from 'react';

import PreferenceSelect from './preference_select';
import {fetchLanguageOptions, type LanguageOption} from '../language_options';

type Props = {
    value: string;
    onChange: (code: string) => void;
    className?: string;
    disabled?: boolean;
};

export default function LanguageSelect({value, onChange, className, disabled}: Props) {
    const [options, setOptions] = useState<LanguageOption[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        void fetchLanguageOptions()
            .then((loaded) => {
                if (active) {
                    setOptions(loaded);
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    if (loading) {
        return <span className='translation-language-select__loading'>Loading languages…</span>;
    }

    return (
        <PreferenceSelect
            className={className || 'translation-language-select'}
            value={value}
            options={options}
            disabled={disabled}
            aria-label='Your receive language'
            onChange={onChange}
        />
    );
}
