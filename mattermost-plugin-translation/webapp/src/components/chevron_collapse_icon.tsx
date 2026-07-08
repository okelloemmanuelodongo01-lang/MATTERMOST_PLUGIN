import React from 'react';

type Props = {
    expanded?: boolean;
    size?: number;
};

/** Chevron for expand/collapse original text (inverted from Mattermost collapse icon). */
export default function ChevronCollapseIcon({expanded = false, size = 16}: Props) {
    const fill = 'rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.72)';

    return (
        <svg
            width={size}
            height={size}
            viewBox='0 0 24 24'
            aria-hidden='true'
            focusable='false'
            className={expanded ? 'translation-chevron translation-chevron--expanded' : 'translation-chevron'}
        >
            <path
                fill={fill}
                d={expanded
                    ? 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z'
                    : 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'}
            />
        </svg>
    );
}
