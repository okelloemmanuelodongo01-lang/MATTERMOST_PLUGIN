import React from 'react';

import type {Post} from '@mattermost/types/posts';

import VideoNotePlayer from './video_note_player';
import MediaTranscriptPanel from './media_transcript_panel';
import MediaAuthorPanel from './media_author_panel';
import PostSpeakBar from './post_speak_bar';
import {durationSecondsFromMs} from '../voice_player_utils';
import {getVideoDurationMs, getVideoFileId} from '../video_post_utils';

type Props = {
    post: Post;
    compactDisplay?: boolean;
    isRHS?: boolean;
};

export default function VideoNotePost({post}: Props) {
    const fileId = getVideoFileId(post);
    const durationHintSeconds = durationSecondsFromMs(getVideoDurationMs(post));

    return (
        <div className='translation-video-post'>
            {fileId && (
                <VideoNotePlayer
                    videoUrl={`/api/v4/files/${fileId}`}
                    durationHintSeconds={durationHintSeconds}
                />
            )}
            <MediaTranscriptPanel post={post} />
            <MediaAuthorPanel post={post} />
            <PostSpeakBar post={post} />
        </div>
    );
}
