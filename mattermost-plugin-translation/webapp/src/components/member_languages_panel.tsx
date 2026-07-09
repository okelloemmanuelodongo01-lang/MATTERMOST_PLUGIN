import React from 'react';

import {connect} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';

import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';



import LanguageSelect from './language_select';

import VoiceGenderSelect, {type VoiceGender} from './voice_gender_select';
import ReadAloudModeSelect from './read_aloud_mode_select';
import type {ReadAloudMode} from '../reducer';

import {

    getMyReceiveLanguage,

    getPluginState,

    SET_TARGET_LANGUAGE,

    SET_TTS_VOICE_GENDER,

    SET_READ_ALOUD_MODE,

    SET_USER_PUBLIC_LANGUAGE,

} from '../reducer';

import {languageShortCode} from '../language_labels';
import {getLanguageLabel} from '../language_options';
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

    savingVoice: boolean;

    savingReadAloudMode: boolean;

    voiceGender: VoiceGender;

    readAloudMode: ReadAloudMode;

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

    constructor(props: Props) {
        super(props);
        this.state = {
            members: [],
            loading: true,
            error: '',
            savingVoice: false,
            savingReadAloudMode: false,
            voiceGender: props.myVoiceGender,
            readAloudMode: props.myReadAloudMode,
        };
    }



    componentDidMount() {
        void this.loadMembers();
        window.setTimeout(() => void this.loadMembers(), 1200);
    }



    componentDidUpdate(prevProps: Props) {
        if (prevProps.channelId !== this.props.channelId) {
            void this.loadMembers();
        }

        if (prevProps.myVoiceGender !== this.props.myVoiceGender && !this.state.savingVoice) {
            this.setState({voiceGender: this.props.myVoiceGender});
        }

        if (prevProps.myReadAloudMode !== this.props.myReadAloudMode && !this.state.savingReadAloudMode) {
            this.setState({readAloudMode: this.props.myReadAloudMode});
        }
    }



    loadMembers = async () => {
        const {channelId, userLanguages} = this.props;

        if (!channelId) {
            this.setState({loading: false, members: [], error: 'Open a channel to see member languages.'});
            return;
        }

        this.setState({loading: true, error: ''});

        try {
            const members = await this.loadMembersForChannel(channelId, userLanguages);
            this.setState({members, loading: false});
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load';
            this.setState({loading: false, error: message});
        }
    };

    loadMembersForChannel = async (
        channelId: string,
        userLanguages: Record<string, string>,
    ): Promise<MemberLanguage[]> => {
        const languageMap: Record<string, string> = {...userLanguages};

        try {
            const pluginResponse = await fetch(
                `${API_BASE}/channel-languages?channel_id=${encodeURIComponent(channelId)}`,
                {
                    credentials: 'same-origin',
                    headers: {'X-Requested-With': 'XMLHttpRequest'},
                },
            );

            if (pluginResponse.ok) {
                const pluginData = await pluginResponse.json() as {members?: MemberLanguage[]};
                for (const member of pluginData.members || []) {
                    if (member.user_id && member.target_language) {
                        languageMap[member.user_id] = member.target_language;
                    }
                }

                if ((pluginData.members || []).length > 0) {
                    return (pluginData.members || []).map((member) => ({
                        ...member,
                        target_language: languageMap[member.user_id] || member.target_language || 'en',
                    }));
                }
            }
        } catch {
            // Fall back to Mattermost channel members below.
        }

        const mmMembers = await this.fetchMattermostChannelMembers(channelId);
        if (mmMembers.length === 0) {
            return [];
        }

        const profiles = await this.fetchMattermostUserProfiles(mmMembers.map((member) => member.user_id));
        const missingLanguageIds = profiles
            .map((profile) => profile.id)
            .filter((userId) => !languageMap[userId]);

        if (missingLanguageIds.length > 0) {
            const fetchedLanguages = await this.fetchUserLanguages(missingLanguageIds);
            Object.assign(languageMap, fetchedLanguages);
        }

        return profiles.map((profile) => ({
            user_id: profile.id,
            username: profile.username,
            display_name: profile.display_name,
            target_language: languageMap[profile.id] || 'en',
        })).sort((left, right) => (left.display_name || left.username).localeCompare(right.display_name || right.username));
    };

    fetchMattermostChannelMembers = async (channelId: string): Promise<Array<{user_id: string}>> => {
        const response = await fetch(
            `/api/v4/channels/${encodeURIComponent(channelId)}/members?per_page=200`,
            {
                credentials: 'same-origin',
                headers: {'X-Requested-With': 'XMLHttpRequest'},
            },
        );

        if (!response.ok) {
            throw new Error('Could not load channel members');
        }

        const members = await response.json() as Array<{user_id?: string}>;
        return members
            .map((member) => ({user_id: String(member.user_id || '')}))
            .filter((member) => Boolean(member.user_id));
    };

    fetchMattermostUserProfiles = async (userIds: string[]): Promise<Array<{
        id: string;
        username: string;
        display_name: string;
    }>> => {
        const uniqueIds = [...new Set(userIds.filter(Boolean))];
        if (uniqueIds.length === 0) {
            return [];
        }

        const response = await fetch('/api/v4/users/ids', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(uniqueIds),
        });

        if (!response.ok) {
            throw new Error('Could not load member profiles');
        }

        const profiles = await response.json() as Array<{
            id: string;
            username: string;
            nickname?: string;
            first_name?: string;
            last_name?: string;
        }>;

        return profiles.map((profile) => ({
            id: profile.id,
            username: profile.username,
            display_name: (profile.nickname || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.username).trim(),
        }));
    };

    fetchUserLanguages = async (userIds: string[]): Promise<Record<string, string>> => {
        const languages: Record<string, string> = {};

        await Promise.all(userIds.map(async (userId) => {
            try {
                const response = await fetch(
                    `${API_BASE}/user-language?user_id=${encodeURIComponent(userId)}`,
                    {
                        credentials: 'same-origin',
                        headers: {'X-Requested-With': 'XMLHttpRequest'},
                    },
                );
                if (!response.ok) {
                    return;
                }
                const data = await response.json() as {target_language?: string};
                if (data.target_language) {
                    languages[userId] = data.target_language;
                }
            } catch {
                // Ignore per-user language lookup failures.
            }
        }));

        return languages;
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



    handleLanguageChange = (language: string) => {
        const {currentUserId, onLanguageSaved} = this.props;
        this.setState({error: ''});

        if (currentUserId) {
            onLanguageSaved(language, currentUserId);
        }

        clearSpeakAudioCache();

        void this.savePreferences({target_language: language})
            .then(() => {
                void this.loadMembers();
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : 'Failed to save language';
                this.setState({error: message});
            });
    };

    handleVoiceGenderChange = async (gender: VoiceGender) => {
        const {onVoiceGenderSaved} = this.props;
        this.setState({savingVoice: true, error: '', voiceGender: gender});
        onVoiceGenderSaved(gender);

        try {
            const data = await this.savePreferences({tts_voice_gender: gender});
            clearSpeakAudioCache();
            onVoiceGenderSaved(normalizeVoiceGender(data.tts_voice_gender || gender));
            this.setState({voiceGender: normalizeVoiceGender(data.tts_voice_gender || gender)});
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save voice preference';
            this.setState({error: message, voiceGender: this.props.myVoiceGender});
        } finally {
            this.setState({savingVoice: false});
        }
    };

    handleReadAloudModeChange = async (mode: ReadAloudMode) => {
        const {onReadAloudModeSaved} = this.props;
        this.setState({savingReadAloudMode: true, error: '', readAloudMode: mode});
        onReadAloudModeSaved(mode);

        try {
            const data = await this.savePreferences({read_aloud_mode: mode});
            clearSpeakAudioCache();
            const saved = normalizeReadAloudMode(data.read_aloud_mode || mode);
            onReadAloudModeSaved(saved);
            this.setState({readAloudMode: saved});
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save read-aloud mode';
            this.setState({error: message, readAloudMode: this.props.myReadAloudMode});
        } finally {
            this.setState({savingReadAloudMode: false});
        }
    };



    render() {

        const {myReceiveLanguage, userLanguages, currentUserId} = this.props;

        const {members, loading, error, savingVoice, savingReadAloudMode, voiceGender, readAloudMode} = this.state;

        const displayMembers = members.map((member) => ({

            ...member,

            target_language: userLanguages[member.user_id] || member.target_language,

        }));

        const receiveLabel = getLanguageLabel(myReceiveLanguage);
        const speakHint = readAloudMode === 'receive'
            ? `Speaker uses Google voices when available. Reading in ${receiveLabel} when set to translated mode.`
            : 'Speaker uses Google voices when available. Reading the original message text.';

        const memberInitial = (name: string) => (name.trim().charAt(0) || '?').toUpperCase();

        return (

            <div className='translation-member-panel'>

                <section className='translation-member-panel__settings'>

                    <div className='translation-member-panel__field'>

                        <label className='translation-member-panel__label'>Your receive language</label>

                        <LanguageSelect

                            className='translation-language-select'

                            value={myReceiveLanguage}

                            onChange={(language) => this.handleLanguageChange(language)}

                        />

                    </div>

                    <div className='translation-member-panel__field'>

                        <label className='translation-member-panel__label'>Read-aloud voice</label>

                        <VoiceGenderSelect

                            value={voiceGender}

                            disabled={savingVoice}

                            onChange={(gender) => void this.handleVoiceGenderChange(gender)}

                        />

                    </div>

                    <div className='translation-member-panel__field'>

                        <label className='translation-member-panel__label'>Read-aloud text</label>

                        <ReadAloudModeSelect
                            value={readAloudMode}
                            disabled={savingReadAloudMode}
                            onChange={(mode) => void this.handleReadAloudModeChange(mode)}
                        />

                    </div>

                    <p className='translation-member-panel__speak-hint'>{speakHint}</p>

                </section>

                <section className='translation-member-panel__members'>

                    <div className='translation-member-panel__members-head'>

                        <div className='translation-member-panel__title'>Channel members</div>

                        <div className='translation-member-panel__hint-block'>

                            Each badge is that person&apos;s receive language (visible to everyone).

                        </div>

                    </div>

                    <div className='translation-member-panel__list'>

                        {loading && <div className='translation-member-panel__hint'>Loading…</div>}

                        {error && <div className='translation-member-panel__error'>{error}</div>}

                        {!loading && !error && displayMembers.length === 0 && (
                            <div className='translation-member-panel__hint'>No channel members found.</div>
                        )}

                        {!loading && !error && displayMembers.map((member) => {
                            const isYou = member.user_id === currentUserId;
                            const displayName = member.display_name || member.username;

                            return (
                                <div
                                    key={member.user_id}
                                    className={`translation-member-panel__row${isYou ? ' translation-member-panel__row--you' : ''}`}
                                >
                                    <div className='translation-member-panel__person'>
                                        <span
                                            className='translation-member-panel__avatar'
                                            aria-hidden='true'
                                        >
                                            {memberInitial(displayName)}
                                        </span>
                                        <span className='translation-member-panel__name'>
                                            {displayName}
                                            {isYou && <span className='translation-member-panel__you-tag'>You</span>}
                                        </span>
                                    </div>

                                    <span
                                        className='translation-member-panel__badge'
                                        title={getLanguageLabel(member.target_language)}
                                    >
                                        {languageShortCode(member.target_language)}
                                    </span>
                                </div>
                            );
                        })}

                    </div>

                </section>

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

