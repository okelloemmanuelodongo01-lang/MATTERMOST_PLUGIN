import React from 'react';

import type {Post} from '@mattermost/types/posts';

import type {Theme} from '@mattermost/types/theme';



import VoiceNotePlayer from './voice_note_player';
import MediaTranscriptPanel from './media_transcript_panel';
import MediaAuthorPanel from './media_author_panel';
import PostSpeakBar from './post_speak_bar';

import {getVoiceDurationMs, getVoiceFileId} from '../voice_post_utils';
import {durationSecondsFromMs} from '../voice_player_utils';



type Props = {

    post: Post;

    compactDisplay?: boolean;

    isRHS?: boolean;

    theme?: Theme;

};



export default function VoiceNotePost({post}: Props) {

    const fileId = getVoiceFileId(post);

    const durationHintSeconds = durationSecondsFromMs(getVoiceDurationMs(post));



    return (

        <div className='translation-voice-post'>

            {fileId && (

                <VoiceNotePlayer

                    audioUrl={`/api/v4/files/${fileId}`}

                    durationHintSeconds={durationHintSeconds}

                />

            )}

            <MediaTranscriptPanel post={post} />
            <MediaAuthorPanel post={post} />
            <PostSpeakBar post={post} />

        </div>

    );

}

