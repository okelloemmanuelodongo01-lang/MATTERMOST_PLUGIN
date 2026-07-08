import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';
import type {Post} from '@mattermost/types/posts';

import {getPost} from 'mattermost-redux/selectors/entities/posts';

import {getPluginState, shouldShowTranslationBar, TOGGLE_SHOW_ORIGINAL, isTranslatableTextPost} from './reducer';
import {isMediaNotePost} from './voice_post_utils';
import {ensurePostTranslationDetails} from './translation_details';

const TOGGLE_ATTR = 'data-translation-details-toggle';
const TOGGLE_CLASS = 'translation-message-toggle';
const BODY_TOGGLE_CLASS = 'translation-has-toggle';

function chevronMarkup(expanded: boolean): string {
    const path = expanded
        ? 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z'
        : 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z';
    return `<svg class="translation-message-toggle__icon${expanded ? ' translation-message-toggle__icon--expanded' : ''}" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${path}"/></svg>`;
}

function postIdFromElement(postEl: Element): string | null {
    if (!(postEl instanceof HTMLElement)) {
        return null;
    }

    const dataId = postEl.getAttribute('data-post-id');
    if (dataId) {
        return dataId;
    }

    const id = postEl.id || '';
    if (id.startsWith('post_')) {
        return id.slice(5);
    }
    if (id.startsWith('post-')) {
        return id.slice(5);
    }
    if (id) {
        return id;
    }

    return null;
}

function findAllPostElements(postId: string): HTMLElement[] {
    const seen = new Set<HTMLElement>();
    const add = (el: Element | null) => {
        if (!(el instanceof HTMLElement)) {
            return;
        }
        const post = el.classList.contains('post') ? el : el.closest('.post');
        if (post instanceof HTMLElement) {
            seen.add(post);
        }
    };

    const selectors = [
        `#post_${CSS.escape(postId)}`,
        `.post[data-post-id="${postId}"]`,
        `[data-post-id="${postId}"]`,
    ];

    for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => add(el));
    }

    return [...seen];
}

function findPostElement(postId: string): HTMLElement | null {
    const posts = findAllPostElements(postId);
    return posts[0] || null;
}

const expandedLongPosts = new WeakSet<HTMLElement>();

function isMattermostShowMoreButton(button: Element): button is HTMLButtonElement {
    if (!(button instanceof HTMLButtonElement)) {
        return false;
    }
    if (button.closest('.translation-speak-button-wrap, .translation-message-toggle, .translation-panel')) {
        return false;
    }

    const testId = button.getAttribute('data-testid') || '';
    if (testId === 'postMessageShowMoreButton') {
        return true;
    }

    const label = (button.getAttribute('aria-label') || button.textContent || '').trim().toLowerCase();
    return label === 'show more' || label === 'show less' || button.classList.contains('see-more-less-button');
}

function liftMattermostPostHeightCaps(postEl: HTMLElement) {
    postEl.querySelectorAll('.post-message__text, [data-testid="postMessageText"], .post-message__text-container').forEach((node) => {
        if (node instanceof HTMLElement) {
            node.style.maxHeight = 'none';
            node.style.overflow = 'visible';
        }
    });
}

function expandMattermostLongPost(postEl: HTMLElement) {
    liftMattermostPostHeightCaps(postEl);

    if (expandedLongPosts.has(postEl)) {
        return;
    }

    const showMoreButton = postEl.querySelector(
        '[data-testid="postMessageShowMoreButton"], button[aria-label="Show more"], button[aria-label="Show More"], .see-more-less-button',
    );
    if (isMattermostShowMoreButton(showMoreButton)) {
        const label = (showMoreButton.getAttribute('aria-label') || showMoreButton.textContent || '').trim().toLowerCase();
        if (label === 'show more') {
            showMoreButton.click();
        }
    }

    expandedLongPosts.add(postEl);
}

function applyDetailsOpenState(postEl: HTMLElement, expanded: boolean) {
    postEl.classList.toggle('translation-details-open', expanded);
    const body = postBodyHost(postEl);
    body?.classList.toggle('translation-details-open', expanded);
    if (expanded) {
        expandMattermostLongPost(postEl);
        return;
    }

    expandedLongPosts.delete(postEl);
}

function ensurePostIdAttribute(postEl: HTMLElement, postId: string) {
    if (!postEl.getAttribute('data-post-id')) {
        postEl.setAttribute('data-post-id', postId);
    }
}

function postBodyHost(postEl: Element): HTMLElement | null {
    const body = postEl.querySelector('.post__body');
    return body instanceof HTMLElement ? body : null;
}

function syncToggleForPost(
    store: Store<GlobalState>,
    postId: string,
    pluginState: ReturnType<typeof getPluginState>,
    currentUserId: string,
) {
    const state = store.getState();
    const post = getPost(state, postId) as Post | undefined;
    const isText = Boolean(post?.id && isTranslatableTextPost(post));
    const isMedia = Boolean(post?.id && isMediaNotePost(post));
    if (!isText && !isMedia) {
        for (const postEl of findAllPostElements(postId)) {
            removeMessageToggle(postEl);
        }
        return;
    }

    const postElements = findAllPostElements(postId);
    if (postElements.length === 0) {
        return;
    }

    const isAuthor = Boolean(currentUserId && post.user_id === currentUserId);
    const showBar = shouldShowTranslationBar(post, pluginState, currentUserId, isAuthor);
    const expanded = Boolean(pluginState.showOriginalByPostId[postId]);

    for (const postEl of postElements) {
        ensurePostIdAttribute(postEl, postId);

        if (!showBar) {
            removeMessageToggle(postEl);
            continue;
        }

        upsertMessageToggle(postEl, postId, expanded);
        applyDetailsOpenState(postEl, expanded);
    }
}

function removeMessageToggle(postEl: Element) {
    const body = postBodyHost(postEl);
    body?.querySelectorAll(`.${TOGGLE_CLASS}`).forEach((button) => button.remove());
    body?.classList.remove(BODY_TOGGLE_CLASS, 'translation-details-open');
    if (postEl instanceof HTMLElement) {
        postEl.classList.remove('translation-details-open');
    }
}

function updateToggleButton(button: HTMLButtonElement, postId: string, expanded: boolean) {
    button.className = TOGGLE_CLASS;
    button.setAttribute(TOGGLE_ATTR, postId);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-label', expanded ? 'Hide translation details' : 'Show translation details');
    button.title = expanded ? 'Hide translation details' : 'Show translation details';
    button.innerHTML = chevronMarkup(expanded);
}

function upsertMessageToggle(
    postEl: Element,
    postId: string,
    expanded: boolean,
) {
    const body = postBodyHost(postEl);
    if (!body) {
        return;
    }

    body.classList.add(BODY_TOGGLE_CLASS);

    const existingButtons = body.querySelectorAll(`.${TOGGLE_CLASS}`);
    let button = existingButtons[0];
    existingButtons.forEach((candidate, index) => {
        if (index > 0) {
            candidate.remove();
        }
    });

    if (!(button instanceof HTMLButtonElement)) {
        button = document.createElement('button');
        button.type = 'button';
    }

    const mediaHost = body.querySelector('.translation-voice-post, .translation-video-post');
    const messageHost = body.querySelector('.post-message__text, [data-testid="postMessageText"]');
    if (mediaHost?.parentElement === body) {
        body.insertBefore(button, mediaHost.nextSibling);
    } else if (messageHost?.parentElement === body) {
        body.insertBefore(button, messageHost.nextSibling);
    } else if (!body.contains(button)) {
        body.appendChild(button);
    }

    updateToggleButton(button, postId, expanded);
}

export function toggleTranslationDetails(store: Store<GlobalState>, postId: string) {
    if (!postId) {
        return;
    }

    store.dispatch({type: TOGGLE_SHOW_ORIGINAL, postId});
    const post = getPost(store.getState(), postId);
    if (post) {
        ensurePostTranslationDetails(post);
    }
    scheduleInlineTranslationToggleSync(store, postId);
}

export function syncInlineTranslationToggles(store: Store<GlobalState>) {
    const state = store.getState();
    const pluginState = getPluginState(state as Record<string, unknown>);
    const currentUserId = state.entities?.users?.currentUserId || '';
    const seen = new Set<string>();

    for (const postId of Object.keys(pluginState.byPostId)) {
        seen.add(postId);
        syncToggleForPost(store, postId, pluginState, currentUserId);
    }

    for (const postId of Object.keys(pluginState.authorSummaryByPostId)) {
        seen.add(postId);
        syncToggleForPost(store, postId, pluginState, currentUserId);
    }

    document.querySelectorAll('.post').forEach((postEl) => {
        const postId = postIdFromElement(postEl);
        if (!postId || seen.has(postId)) {
            return;
        }

        syncToggleForPost(store, postId, pluginState, currentUserId);
    });
}

let boundStore: Store<GlobalState> | null = null;
let listenersBound = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const syncRetryTimers = new Set<ReturnType<typeof setTimeout>>();
let lastPluginSnapshot = '';

function pluginSnapshot(state: GlobalState): string {
    const pluginState = getPluginState(state as Record<string, unknown>);
    const postSigs = Object.entries(pluginState.byPostId)
        .map(([postId, record]) => `${postId}:${record.loading ? 1 : 0}:${record.translated?.length || 0}:${record.sameLanguage ? 1 : 0}:${record.error || ''}`)
        .sort()
        .join('|');
    const summarySigs = Object.entries(pluginState.authorSummaryByPostId)
        .map(([postId, summary]) => `${postId}:${summary.loading ? 1 : 0}:${summary.languages?.length || 0}:${summary.error || ''}`)
        .sort()
        .join('|');
    const expandedSigs = Object.entries(pluginState.showOriginalByPostId)
        .filter(([, expanded]) => expanded)
        .map(([postId]) => postId)
        .sort()
        .join('|');

    return JSON.stringify({postSigs, summarySigs, expandedSigs});
}

function handleTogglePointer(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    if (target.closest(
        '.translation-speak-button, .translation-speak-button-wrap, .translation-speak-bar, .translation-panel, .translation-member-panel, .translation-language-select, .translation-custom-select, .translation-pref-select, .translation-voice-gender-select, .translation-read-aloud-mode-select',
    )) {
        return;
    }

    const button = target.closest(`[${TOGGLE_ATTR}]`);
    if (!(button instanceof HTMLElement) || !boundStore) {
        return;
    }

    const postId = button.getAttribute(TOGGLE_ATTR);
    if (!postId) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event) {
        event.stopImmediatePropagation();
    }

    toggleTranslationDetails(boundStore, postId);
}

export function bindInlineTranslationToggles(store: Store<GlobalState>) {
    boundStore = store;

    if (!listenersBound) {
        listenersBound = true;
        document.addEventListener('click', handleTogglePointer, true);
    }

    scheduleInlineTranslationToggleSync(store);
    lastPluginSnapshot = pluginSnapshot(store.getState());
    store.subscribe(() => {
        const nextSnapshot = pluginSnapshot(store.getState());
        if (nextSnapshot === lastPluginSnapshot) {
            return;
        }
        lastPluginSnapshot = nextSnapshot;
        scheduleInlineTranslationToggleSync(store);
    });
}

export function scheduleInlineTranslationToggleSync(store: Store<GlobalState>, postId?: string) {
    if (syncTimer) {
        clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
        syncInlineTranslationToggles(store);
    }, 120);

    if (!postId) {
        return;
    }

    while (syncRetryTimers.size > 8) {
        const oldest = syncRetryTimers.values().next().value;
        if (!oldest) {
            break;
        }
        clearTimeout(oldest);
        syncRetryTimers.delete(oldest);
    }

    const delays = [200, 500, 1000, 2000];
    for (const delay of delays) {
        const timer = setTimeout(() => {
            syncRetryTimers.delete(timer);
            const state = store.getState();
            const pluginState = getPluginState(state as Record<string, unknown>);
            const currentUserId = state.entities?.users?.currentUserId || '';
            syncToggleForPost(store, postId, pluginState, currentUserId);
        }, delay);
        syncRetryTimers.add(timer);
    }
}
