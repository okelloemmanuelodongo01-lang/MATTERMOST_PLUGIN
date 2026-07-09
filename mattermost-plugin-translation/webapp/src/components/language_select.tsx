import React, {useCallback, useEffect, useState} from 'react';

import PreferenceSelect from './preference_select';
import {
    clearCachedLanguageOptions,
    fetchLanguageOptions,
    getCachedLanguageOptions,
    isPartialLanguageList,
    type LanguageOption,
} from '../language_options';

type Props = {
    value: string;
    onChange: (code: string) => void;
    className?: string;
    disabled?: boolean;
};

export default function LanguageSelect({value, onChange, className, disabled}: Props) {
    const [options, setOptions] = useState<LanguageOption[]>(() => getCachedLanguageOptions() || []);
    const [loading, setLoading] = useState(() => !getCachedLanguageOptions());

    const loadOptions = useCallback(async (force = false) => {
        if (force) {
            clearCachedLanguageOptions();
        }

        setLoading(true);
        try {
            const loaded = await fetchLanguageOptions({force});
            if (loaded.length > 0) {
                setOptions(loaded);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadOptions(false);
    }, [loadOptions]);

    useEffect(() => {
        if (!isPartialLanguageList(options)) {
            return undefined;
        }

        const timer = window.setInterval(() => {
            void loadOptions(true);
        }, 8000);

        return () => {
            window.clearInterval(timer);
        };
    }, [loadOptions, options]);

    const handleMenuOpen = useCallback(() => {
        if (isPartialLanguageList(options)) {
            void loadOptions(true);
        }
    }, [loadOptions, options]);

    if (loading && options.length === 0) {
        return <span className='translation-language-select__loading'>Loading languages…</span>;
    }

    return (
        <PreferenceSelect
            className={className || 'translation-language-select'}
            value={value}
            options={options.length > 0 ? options : [{value, label: value}]}
            disabled={disabled}
            aria-label='Your receive language'
            onMenuOpen={handleMenuOpen}
            onChange={onChange}
        />
    );
}
