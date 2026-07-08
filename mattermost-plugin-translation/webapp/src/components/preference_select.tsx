import React, {useEffect, useId, useRef, useState} from 'react';

export type SelectOption = {
    value: string;
    label: string;
};

type Props = {
    value: string;
    options: SelectOption[];
    disabled?: boolean;
    className?: string;
    'aria-label'?: string;
    onChange: (value: string) => void;
};

export default function PreferenceSelect({
    value,
    options,
    disabled,
    className = '',
    'aria-label': ariaLabel,
    onChange,
}: Props) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const rootRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const selected = options.find((option) => option.value === value) || options[0];
    const selectedLabel = selected?.label || value;

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
                setOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (!open) {
            setActiveIndex(-1);
        }
    }, [open]);

    const commitSelection = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
    };

    const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) {
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((current) => !current);
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(0);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(Math.max(options.length - 1, 0));
        }
    };

    const handleOptionKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        index: number,
        optionValue: string,
    ) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            commitSelection(optionValue);
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index + 1) % options.length);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index - 1 + options.length) % options.length);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div
            ref={rootRef}
            className={`translation-custom-select ${open ? 'translation-custom-select--open' : ''} ${className}`.trim()}
        >
            <button
                type='button'
                className='translation-custom-select__trigger'
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup='listbox'
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => {
                    if (!disabled) {
                        setOpen((current) => !current);
                    }
                }}
                onKeyDown={handleTriggerKeyDown}
            >
                <span className='translation-custom-select__value'>{selectedLabel}</span>
                <span className='translation-custom-select__chevron' aria-hidden='true' />
            </button>

            {open && (
                <div
                    id={listId}
                    className='translation-custom-select__menu'
                    role='listbox'
                    aria-label={ariaLabel}
                >
                    {options.map((option, index) => {
                        const isSelected = option.value === value;
                        const isActive = index === activeIndex;

                        return (
                            <button
                                key={option.value}
                                type='button'
                                role='option'
                                aria-selected={isSelected}
                                className={
                                    'translation-custom-select__option' +
                                    (isSelected ? ' translation-custom-select__option--selected' : '') +
                                    (isActive ? ' translation-custom-select__option--active' : '')
                                }
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => commitSelection(option.value)}
                                onKeyDown={(event) => handleOptionKeyDown(event, index, option.value)}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
