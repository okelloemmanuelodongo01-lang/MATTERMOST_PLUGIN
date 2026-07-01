import React from 'react';

import {connect} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';



import LanguageSelect from './language_select';

import VoiceGenderSelect, {type VoiceGender} from './voice_gender_select';
import type {ReadAloudMode} from '../reducer';

import {

    getMyReceiveLanguage,

    getPluginState,

    SET_TARGET_LANGUAGE,

    SET_TTS_VOICE_GENDER,

    SET_READ_ALOUD_MODE,

    SET_USER_PUBLIC_LANGUAGE,

} from '../reducer';

import {languageShortCode, languageCodeLabel} from '../language_labels';
import {clearSpeakAudioCache} from '../speak_client';



type MemberLanguage = {

    user_id: string;

    username: string;

    display_name: string;

    target_language: string;

};



type Props = {

    myReceiveLanguage: string;

    myVoiceGender: VoiceGender;

    myReadAloudMode: ReadAloudMode;

    channelId: string;

    userLanguages: Record<string, string>;

    currentUserId: string;

    onLanguageSaved: (language: string, userId: string) => void;

    onVoiceGenderSaved: (gender: VoiceGender) => void;

    onReadAloudModeSaved: (mode: ReadAloudMode) => void;

};



type State = {

    members: MemberLanguage[];

    loading: boolean;

    error: string;

    savingLanguage: boolean;

    savingVoice: boolean;

    savingReadAloudMode: boolean;

};



const API_BASE = '/plugins/com.transchecker.translation/api/v1';



function normalizeVoiceGender(value?: string): VoiceGender {

    switch ((value || '').trim().toLowerCase()) {

    case 'male':

        return 'male';

    case 'female':

        return 'female';

    default:

        return 'neutral';

    }

}



function normalizeReadAloudMode(value?: string): ReadAloudMode {
    return (value || '').trim().toLowerCase() === 'original' ? 'original' : 'receive';
}



class MemberLanguagesPanel extends React.PureComponent<Props, State> {

    state: State = {

        members: [],

        loading: true,

        error: '',

        savingLanguage: false,

        savingVoice: false,

        savingReadAloudMode: false,

    };



    componentDidMount() {

        void this.loadMembers();

    }



    componentDidUpdate(prevProps: Props) {

        if (

            prevProps.channelId !== this.props.channelId ||

            prevProps.myReceiveLanguage !== this.props.myReceiveLanguage ||

            prevProps.userLanguages !== this.props.userLanguages

        ) {

            void this.loadMembers();

        }

    }



    loadMembers = async () => {

        const {channelId} = this.props;

        if (!channelId) {

            this.setState({loading: false, members: [], error: 'Open a channel to see member languages.'});

            return;

        }



        this.setState({loading: true, error: ''});

        try {

            const response = await fetch(

                `${API_BASE}/channel-languages?channel_id=${encodeURIComponent(channelId)}`,

                {

                    credentials: 'same-origin',

                    headers: {'X-Requested-With': 'XMLHttpRequest'},

                },

            );



            if (!response.ok) {

                throw new Error('Could not load member languages');

            }



            const data = await response.json() as {members: MemberLanguage[]};

            this.setState({members: data.members || [], loading: false});

        } catch (error) {

            const message = error instanceof Error ? error.message : 'Failed to load';

            this.setState({loading: false, error: message});

        }

    };



    savePreferences = async (payload: {target_language?: string; tts_voice_gender?: VoiceGender; read_aloud_mode?: ReadAloudMode}) => {

        const response = await fetch(`${API_BASE}/language`, {

            method: 'POST',

            credentials: 'same-origin',

            headers: {

                'Content-Type': 'application/json',

                'X-Requested-With': 'XMLHttpRequest',

            },

            body: JSON.stringify(payload),

        });



        if (!response.ok) {

            throw new Error('Could not save preference');

        }



        return response.json() as Promise<{target_language?: string; tts_voice_gender?: string; read_aloud_mode?: string}>;

    };



    handleLanguageChange = async (language: string) => {

        const {currentUserId, onLanguageSaved} = this.props;

        this.setState({savingLanguage: true, error: ''});

        try {

            await this.savePreferences({target_language: language});

            clearSpeakAudioCache();



            if (currentUserId) {

                onLanguageSaved(language, currentUserId);

            }

        } catch (error) {

            const message = error instanceof Error ? error.message : 'Failed to save language';

            this.setState({error: message});

        } finally {

            this.setState({savingLanguage: false});

        }

    };



    handleVoiceGenderChange = async (gender: VoiceGender) => {

        const {onVoiceGenderSaved} = this.props;

        this.setState({savingVoice: true, error: ''});

        try {

            const data = await this.savePreferences({tts_voice_gender: gender});

            clearSpeakAudioCache();

            onVoiceGenderSaved(normalizeVoiceGender(data.tts_voice_gender || gender));

        } catch (error) {

            const message = error instanceof Error ? error.message : 'Failed to save voice preference';

            this.setState({error: message});

        } finally {

            this.setState({savingVoice: false});

        }

    };



    handleReadAloudModeChange = async (mode: ReadAloudMode) => {

        const {onReadAloudModeSaved} = this.props;

        this.setState({savingReadAloudMode: true, error: ''});

        try {

            const data = await this.savePreferences({read_aloud_mode: mode});

            clearSpeakAudioCache();

            onReadAloudModeSaved(normalizeReadAloudMode(data.read_aloud_mode || mode));

        } catch (error) {

            const message = error instanceof Error ? error.message : 'Failed to save read-aloud mode';

            this.setState({error: message});

        } finally {

            this.setState({savingReadAloudMode: false});

        }

    };



    render() {

        const {myReceiveLanguage, myVoiceGender, myReadAloudMode, userLanguages} = this.props;

        const {members, loading, error, savingLanguage, savingVoice, savingReadAloudMode} = this.state;



        const displayMembers = members.map((member) => ({

            ...member,

            target_language: userLanguages[member.user_id] || member.target_language,

        }));



        return (

            <div className='translation-member-panel'>

                <div className='translation-member-panel__you'>

                    <div className='translation-member-panel__label'>Your receive language</div>

                    <LanguageSelect

                        className='translation-language-select'

                        value={myReceiveLanguage}

                        disabled={savingLanguage}

                        onChange={(language) => void this.handleLanguageChange(language)}

                    />

                    <div className='translation-member-panel__label'>Read-aloud voice</div>

                    <VoiceGenderSelect

                        className='translation-language-select'

                        value={myVoiceGender}

                        disabled={savingVoice}

                        onChange={(gender) => void this.handleVoiceGenderChange(gender)}

                    />

                    <div className='translation-member-panel__label'>Read-aloud text</div>

                    <select

                        className='translation-language-select'

                        value={myReadAloudMode}

                        disabled={savingReadAloudMode}

                        onChange={(event) => void this.handleReadAloudModeChange(event.target.value as ReadAloudMode)}

                    >

                        <option value='receive'>My language (translated)</option>

                        <option value='original'>Original message language</option>

                    </select>

                    <div className='translation-member-panel__hint-block translation-member-panel__hint-block--tight'>

                        Speaker icon uses native Google voices. Reading in: {languageCodeLabel(myReceiveLanguage)} when set to translated mode.

                    </div>

                </div>

                <div className='translation-member-panel__members'>

                <div className='translation-member-panel__title'>Channel members</div>

                <div className='translation-member-panel__hint-block'>

                    Each badge is that person&apos;s receive language (visible to everyone).

                </div>

                {loading && <div className='translation-member-panel__hint'>Loading…</div>}

                {error && <div className='translation-member-panel__error'>{error}</div>}

                {!loading && !error && displayMembers.map((member) => (

                    <div

                        key={member.user_id}

                        className='translation-member-panel__row'

                    >

                        <span className='translation-member-panel__name'>{member.display_name || member.username}</span>

                        <span className='translation-member-panel__badge'>

                            {languageShortCode(member.target_language)}

                        </span>

                    </div>

                ))}

                </div>

            </div>

        );

    }

}



function mapStateToProps(state: GlobalState) {

    const pluginState = getPluginState(state as Record<string, unknown>);

    const currentUserId = getCurrentUserId(state) || '';

    return {

        myReceiveLanguage: getMyReceiveLanguage(pluginState, currentUserId),

        myVoiceGender: pluginState.ttsVoiceGender,

        myReadAloudMode: pluginState.readAloudMode,

        channelId: getCurrentChannelId(state) || '',

        userLanguages: pluginState.userLanguages,

        currentUserId,

    };

}



function mapDispatchToProps(dispatch: (action: unknown) => void) {

    return {

        onLanguageSaved: (language: string, userId: string) => {

            dispatch({type: SET_TARGET_LANGUAGE, language, userId});

            dispatch({type: SET_USER_PUBLIC_LANGUAGE, userId, language});

        },

        onVoiceGenderSaved: (gender: VoiceGender) => {

            dispatch({type: SET_TTS_VOICE_GENDER, gender});

        },

        onReadAloudModeSaved: (mode: ReadAloudMode) => {

            dispatch({type: SET_READ_ALOUD_MODE, mode});

        },

    };

}



export default connect(mapStateToProps, mapDispatchToProps)(MemberLanguagesPanel);

