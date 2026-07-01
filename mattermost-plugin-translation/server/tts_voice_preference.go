package main

import (
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

const ttsVoiceGenderPreferenceName = "tts_voice_gender"
const readAloudModePreferenceName = "read_aloud_mode"

func normalizeReadAloudMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "original":
		return "original"
	default:
		return "receive"
	}
}

func normalizeTTSVoiceGender(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "male":
		return "male"
	case "female":
		return "female"
	default:
		return "neutral"
	}
}

func googleTTSGenderCode(value string) string {
	switch normalizeTTSVoiceGender(value) {
	case "male":
		return "MALE"
	case "female":
		return "FEMALE"
	default:
		return "NEUTRAL"
	}
}

func (p *Plugin) getUserTTSVoiceGender(userID string) string {
	if pref, appErr := p.API.GetPreferenceForUser(userID, pluginPreferenceCategory, ttsVoiceGenderPreferenceName); appErr == nil && pref.Value != "" {
		return normalizeTTSVoiceGender(pref.Value)
	}

	key := "tts_voice_" + userID
	if data, err := p.API.KVGet(key); err == nil && len(data) > 0 {
		return normalizeTTSVoiceGender(string(data))
	}

	return "neutral"
}

func (p *Plugin) setUserTTSVoiceGender(userID, gender string) error {
	gender = normalizeTTSVoiceGender(gender)

	pref := model.Preference{
		UserId:   userID,
		Category: pluginPreferenceCategory,
		Name:     ttsVoiceGenderPreferenceName,
		Value:    gender,
	}

	if appErr := p.API.UpdatePreferencesForUser(userID, []model.Preference{pref}); appErr != nil {
		p.API.LogError("Failed to save TTS voice preference", "error", appErr.Error(), "user_id", userID, "gender", gender)
		return appErr
	}

	if err := p.API.KVSet("tts_voice_"+userID, []byte(gender)); err != nil {
		p.API.LogWarn("Saved TTS voice preference but KV backup failed", "error", err.Error())
	}

	return nil
}

func (p *Plugin) getUserReadAloudMode(userID string) string {
	if pref, appErr := p.API.GetPreferenceForUser(userID, pluginPreferenceCategory, readAloudModePreferenceName); appErr == nil && pref.Value != "" {
		return normalizeReadAloudMode(pref.Value)
	}

	key := "read_aloud_" + userID
	if data, err := p.API.KVGet(key); err == nil && len(data) > 0 {
		return normalizeReadAloudMode(string(data))
	}

	return "receive"
}

func (p *Plugin) setUserReadAloudMode(userID, mode string) error {
	mode = normalizeReadAloudMode(mode)

	pref := model.Preference{
		UserId:   userID,
		Category: pluginPreferenceCategory,
		Name:     readAloudModePreferenceName,
		Value:    mode,
	}

	if appErr := p.API.UpdatePreferencesForUser(userID, []model.Preference{pref}); appErr != nil {
		p.API.LogError("Failed to save read-aloud mode preference", "error", appErr.Error(), "user_id", userID, "mode", mode)
		return appErr
	}

	if err := p.API.KVSet("read_aloud_"+userID, []byte(mode)); err != nil {
		p.API.LogWarn("Saved read-aloud mode but KV backup failed", "error", err.Error())
	}

	return nil
}
