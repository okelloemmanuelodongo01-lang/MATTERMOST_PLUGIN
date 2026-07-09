import React, {useEffect, useId, useMemo, useRef, useState} from 'react';

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
    onMenuOpen?: () => void;
    onChange: (value: string) => void;
};

const MENU_MAX_HEIGHT = 220;
const ITEM_HEIGHT = 36;
const VIRTUALIZE_THRESHOLD = 40;
const VIRTUAL_OVERSCAN = 6;

export default function PreferenceSelect({
    value,
    options,
    disabled,
    className = '',
    'aria-label': ariaLabel,
    onMenuOpen,
    onChange,
}: Props) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [scrollTop, setScrollTop] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const useVirtual = options.length > VIRTUALIZE_THRESHOLD;
    const selected = options.find((option) => option.value === value) || options[0];
    const selectedLabel = selected?.label || value;

    const virtualWindow = useMemo(() => {
        if (!useVirtual) {
            return {startIndex: 0, endIndex: options.length};
        }

        const visibleCount = Math.ceil(MENU_MAX_HEIGHT / ITEM_HEIGHT) + VIRTUAL_OVERSCAN * 2;
        const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VIRTUAL_OVERSCAN);
        const endIndex = Math.min(options.length, startIndex + visibleCount);
        return {startIndex, endIndex};
    }, [options.length, scrollTop, useVirtual]);

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
            setScrollTop(0);
            return;
        }

        const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
        const menu = menuRef.current;
        if (!menu) {
            return;
        }

        const nextScrollTop = useVirtual
            ? Math.max(0, selectedIndex * ITEM_HEIGHT - MENU_MAX_HEIGHT / 2 + ITEM_HEIGHT / 2)
            : 0;
        menu.scrollTop = nextScrollTop;
        setScrollTop(nextScrollTop);
        setActiveIndex(selectedIndex);
    }, [open, options, useVirtual, value]);

    const commitSelection = (nextValue: string) => {
        setOpen(false);
        if (nextValue !== value) {
            queueMicrotask(() => onChange(nextValue));
        }
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

    const renderOption = (option: SelectOption, index: number) => {
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
    };

    const visibleOptions = useVirtual
        ? options.slice(virtualWindow.startIndex, virtualWindow.endIndex)
        : options;

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
                        setOpen((current) => {
                            const next = !current;
                            if (next) {
                                onMenuOpen?.();
                            }
                            return next;
                        });
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
                    ref={menuRef}
                    className='translation-custom-select__menu'
                    role='listbox'
                    aria-label={ariaLabel}
                    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                    {useVirtual && virtualWindow.startIndex > 0 && (
                        <div
                            aria-hidden='true'
                            style={{height: virtualWindow.startIndex * ITEM_HEIGHT}}
                        />
                    )}
                    {visibleOptions.map((option, offset) => renderOption(
                        option,
                        useVirtual ? virtualWindow.startIndex + offset : offset,
                    ))}
                    {useVirtual && virtualWindow.endIndex < options.length && (
                        <div
                            aria-hidden='true'
                            style={{height: (options.length - virtualWindow.endIndex) * ITEM_HEIGHT}}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
