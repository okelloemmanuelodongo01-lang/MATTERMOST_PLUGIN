/** WhatsApp-style chat: sent messages on the right, received on the left. */
export const WHATSAPP_CHAT_CSS = `
        #post-list .post.translation-wa--sent:not(.post--system),
        #post-list .post.current--user:not(.post--system) {
            padding-left: 16% !important;
            padding-right: 8px !important;
        }

        #post-list .post.translation-wa--received:not(.post--system),
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) {
            padding-right: 16% !important;
            padding-left: 8px !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__content,
        #post-list .post.current--user:not(.post--system) .post__content {
            display: flex !important;
            flex-direction: row-reverse !important;
            align-items: flex-start !important;
            justify-content: flex-start !important;
            width: 100% !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__content > div:not(.post__img),
        #post-list .post.current--user:not(.post--system) .post__content > div:not(.post__img) {
            flex: 1 1 0 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-end !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__img,
        #post-list .post.current--user:not(.post--system) .post__img {
            flex: 0 0 53px !important;
            width: 53px !important;
            min-width: 53px !important;
            max-width: 53px !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__content,
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__content {
            display: flex !important;
            flex-direction: row !important;
            align-items: flex-start !important;
            justify-content: flex-start !important;
            width: 100% !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__content > div:not(.post__img),
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__content > div:not(.post__img) {
            flex: 1 1 0 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__img,
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__img {
            flex: 0 0 53px !important;
            width: 53px !important;
            min-width: 53px !important;
            max-width: 53px !important;
        }

        /* Keep avatar column width on consecutive messages — hide visually, not from layout */
        #post-list .post.translation-wa--sent.same--user:not(.post--system) .post__img,
        #post-list .post.current--user.same--user:not(.post--system) .post__img {
            visibility: hidden !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__header,
        #post-list .post.current--user:not(.post--system) .post__header {
            width: fit-content !important;
            max-width: 100% !important;
            align-self: flex-end !important;
            justify-content: flex-end !important;
            text-align: right !important;
            flex-wrap: wrap !important;
            gap: 2px 6px !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__header .col,
        #post-list .post.current--user:not(.post--system) .post__header .col {
            flex: 0 0 auto !important;
            width: auto !important;
            max-width: none !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__header,
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__header {
            width: fit-content !important;
            max-width: 100% !important;
            align-self: flex-start !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__header .col,
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__header .col {
            flex: 0 0 auto !important;
            width: auto !important;
            max-width: none !important;
        }

        #post-list .post.translation-wa--sent:not(.post--system) .post__body,
        #post-list .post.current--user:not(.post--system) .post__body {
            background: #d9fdd3 !important;
            color: #111b21 !important;
            border-radius: 12px 12px 4px 12px !important;
            padding: 8px 12px 6px !important;
            margin-top: 2px !important;
            box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06) !important;
            width: fit-content !important;
            max-width: 100% !important;
        }

        #post-list .post.translation-wa--sent.same--user:not(.post--system),
        #post-list .post.current--user.same--user.same--root:not(.post--system) {
            padding-top: 2px !important;
        }

        #post-list .post.translation-wa--received:not(.post--system) .post__body,
        #post-list .post:not(.current--user):not(.post--system):not(.translation-wa--sent) .post__body {
            background: var(--center-channel-bg, #fff) !important;
            border: 1px solid rgba(var(--center-channel-color-rgb, 63, 67, 80), 0.12) !important;
            border-radius: 12px 12px 12px 4px !important;
            padding: 8px 12px 6px !important;
            margin-top: 2px !important;
            box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04) !important;
            width: fit-content !important;
            max-width: 100% !important;
        }

        .theme--dark #post-list .post.translation-wa--sent:not(.post--system) .post__body,
        .theme--dark #post-list .post.current--user:not(.post--system) .post__body {
            background: #005c4b !important;
            color: #e9edef !important;
        }

        .theme--dark #post-list .post.translation-wa--received:not(.post--system) .post__body,
        .theme--dark #post-list .post:not(.current--user):not(.post--system) .post__body {
            background: #202c33 !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            color: #e9edef !important;
        }

        #post-list .post.translation-wa--sent .translation-voice-post,
        #post-list .post.translation-wa--sent .translation-video-post,
        #post-list .post.current--user .translation-voice-post,
        #post-list .post.current--user .translation-video-post {
            margin-left: auto !important;
            margin-right: 0 !important;
        }

        #post-list .post .translation-speak-bar,
        #post-list .post .translation-panel,
        #post-list .post .translation-message-toggle {
            pointer-events: auto !important;
        }

        #post-list .post .post__body.translation-has-toggle {
            overflow: visible !important;
        }

        /* Long messages: lift Mattermost height cap when details are open (channel + thread RHS) */
        .post .post__body.translation-details-open,
        .post.translation-details-open .post__body,
        .ThreadViewer .post .post__body.translation-details-open,
        #threadViewer .post .post__body.translation-details-open {
            max-height: none !important;
            overflow: visible !important;
        }

        .post .post__body.translation-details-open .post-message__text,
        .post .post__body.translation-details-open [data-testid="postMessageText"],
        .ThreadViewer .post .post__body.translation-details-open .post-message__text {
            max-height: none !important;
            overflow: visible !important;
        }

        .post .translation-panel,
        .ThreadViewer .post .translation-panel {
            max-height: none !important;
            overflow: visible !important;
        }
`;
