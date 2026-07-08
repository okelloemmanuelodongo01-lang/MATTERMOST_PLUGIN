import React from 'react';

import {connect, useSelector} from 'react-redux';

import type {Post} from '@mattermost/types/posts';

import type {GlobalState} from '@mattermost/types/store';

import PostSpeakBar from './post_speak_bar';
import TranslationAttachment from './translation_attachment';
import {isVideoNotePost} from '../video_post_utils';
import {isVoiceNotePost} from '../voice_post_utils';

type Props = {
    post?: Post;
    postId?: string;
    onHeightChange?: (height: number) => void;
};

function usePostFromProps(props: Props): Post | null {
    const postId = props.postId || props.post?.id || (props as Partial<Post>).id;

    return useSelector((state: GlobalState) => {
        if (!postId) {
            return props.post || null;
        }
        return state.entities.posts.posts[postId] || props.post || null;
    });
}

function TranslationAttachmentWrapperInner(props: Props) {
    const post = usePostFromProps(props);

    if (!post || post.type === 'custom_voice_note' || post.type === 'custom_video_note' || isVoiceNotePost(post) || isVideoNotePost(post)) {
        return null;
    }

    if (!post.message?.trim()) {
        return null;
    }

    return (
        <>
            <TranslationAttachment post={post} />
            <PostSpeakBar post={post} />
        </>
    );
}

export default connect()(TranslationAttachmentWrapperInner);
