package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

var japaneseRomanizedRE = regexp.MustCompile(`(?i)\b(arigat[oō]?|sayonara|konnichiwa|ohay[oō]|sumimasen|ogenki|itadakimasu|moshi\s+moshi|hai|iie|onegaishimasu|gomennasai)\b`)
var koreanRomanizedRE = regexp.MustCompile(`(?i)\b(annyeong|annyeonghaseyo|kamsahamnida|gamsahamnida|saranghae|mianhae)\b`)

func inferSpokenLanguageFromTranscript(transcript, sttLang string) string {
	text := strings.TrimSpace(transcript)
	source := normalizeLangCode(sttLang)
	if text == "" {
		return source
	}

	for _, r := range text {
		if (r >= 0x3040 && r <= 0x30ff) || (r >= 0x3400 && r <= 0x9fff) {
			return "ja"
		}
		if r >= 0xac00 && r <= 0xd7af {
			return "ko"
		}
	}

	lower := strings.ToLower(text)
	if japaneseRomanizedRE.MatchString(lower) && (source == "" || source == "en") {
		return "ja"
	}
	if koreanRomanizedRE.MatchString(lower) && (source == "" || source == "en") {
		return "ko"
	}

	return source
}

func isVoiceNotePost(post *model.Post) bool {
	if post == nil {
		return false
	}
	if post.Type == "custom_voice_note" {
		return true
	}
	if post.Props != nil {
		if voice, ok := post.Props["voice_note"].(bool); ok && voice {
			return true
		}
	}
	return false
}

func (p *Plugin) postHasAudioFile(post *model.Post) bool {
	for _, fileID := range post.FileIds {
		info, appErr := p.API.GetFileInfo(fileID)
		if appErr != nil {
			continue
		}
		if info != nil && strings.HasPrefix(strings.ToLower(info.MimeType), "audio/") {
			return true
		}
	}
	return false
}

func voiceTranscriptFromPost(post *model.Post) string {
	if post.Props != nil {
		if transcript, ok := post.Props["voice_transcript"].(string); ok {
			transcript = strings.TrimSpace(transcript)
			if transcript != "" {
				return transcript
			}
		}
	}
	return strings.TrimSpace(post.Message)
}

func isPlaceholderVoiceText(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	return normalized == "" || normalized == "voice message"
}

func isVideoNotePost(post *model.Post) bool {
	if post == nil {
		return false
	}
	if post.Type == "custom_video_note" {
		return true
	}
	if post.Props != nil {
		if video, ok := post.Props["video_note"].(bool); ok && video {
			return true
		}
	}
	return false
}

func videoTranscriptFromPost(post *model.Post) string {
	if post.Props != nil {
		if transcript, ok := post.Props["video_transcript"].(string); ok {
			transcript = strings.TrimSpace(transcript)
			if transcript != "" {
				return transcript
			}
		}
	}
	return strings.TrimSpace(post.Message)
}

func isPlaceholderVideoText(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	return normalized == "" || normalized == "video message"
}

func mediaTranscriptFromPost(post *model.Post) string {
	if isVideoNotePost(post) {
		return videoTranscriptFromPost(post)
	}
	return voiceTranscriptFromPost(post)
}

func isPlaceholderMediaText(text string, post *model.Post) bool {
	if isVideoNotePost(post) {
		return isPlaceholderVideoText(text)
	}
	return isPlaceholderVoiceText(text)
}

func isMediaNotePost(post *model.Post) bool {
	return isVoiceNotePost(post) || isVideoNotePost(post)
}

func (p *Plugin) autoTranslateVoicePost(post *model.Post) {
	transcribed, err := p.transcribeMediaPostDetailed(post)
	if err != nil {
		p.API.LogWarn("Voice transcription unavailable", "post_id", post.Id, "error", err.Error())
		return
	}

	text := strings.TrimSpace(transcribed.Text)
	if isPlaceholderVoiceText(text) {
		p.API.LogDebug("Voice note has no transcript to translate", "post_id", post.Id)
		return
	}

	p.saveMediaTranscript(post, text)
	if transcribed.DetectedLanguage != "" {
		p.saveMediaDetectedLanguage(post, transcribed.DetectedLanguage)
	}

	p.autoTranslatePostTextWithHint(post, text, transcribed.DetectedLanguage)
}

func (p *Plugin) voiceFileIDFromPost(post *model.Post) string {
	if post.Props != nil {
		if fileID, ok := post.Props["voice_file_id"].(string); ok && strings.TrimSpace(fileID) != "" {
			return strings.TrimSpace(fileID)
		}
	}
	for _, fileID := range post.FileIds {
		info, appErr := p.API.GetFileInfo(fileID)
		if appErr != nil {
			continue
		}
		if info != nil && strings.HasPrefix(strings.ToLower(info.MimeType), "audio/") {
			return fileID
		}
	}
	return ""
}

func (p *Plugin) saveVoiceTranscript(post *model.Post, transcript string) {
	if post == nil || strings.TrimSpace(transcript) == "" {
		return
	}

	updated := post.Clone()
	if updated.Props == nil {
		updated.Props = model.StringInterface{}
	}
	updated.Props["voice_transcript"] = transcript
	if _, appErr := p.API.UpdatePost(updated); appErr != nil {
		p.API.LogWarn("Failed to save voice transcript on post", "post_id", post.Id, "error", appErr.Error())
	}
}

func (p *Plugin) videoFileIDFromPost(post *model.Post) string {
	if post.Props != nil {
		if fileID, ok := post.Props["video_file_id"].(string); ok && strings.TrimSpace(fileID) != "" {
			return strings.TrimSpace(fileID)
		}
	}
	for _, fileID := range post.FileIds {
		info, appErr := p.API.GetFileInfo(fileID)
		if appErr != nil {
			continue
		}
		if info != nil && strings.HasPrefix(strings.ToLower(info.MimeType), "video/") {
			return fileID
		}
	}
	return ""
}

func (p *Plugin) saveVideoTranscript(post *model.Post, transcript string) {
	if post == nil || strings.TrimSpace(transcript) == "" {
		return
	}

	updated := post.Clone()
	if updated.Props == nil {
		updated.Props = model.StringInterface{}
	}
	updated.Props["video_transcript"] = transcript
	if _, appErr := p.API.UpdatePost(updated); appErr != nil {
		p.API.LogWarn("Failed to save video transcript on post", "post_id", post.Id, "error", appErr.Error())
	}
}

func (p *Plugin) saveMediaTranscript(post *model.Post, transcript string) {
	if isVideoNotePost(post) {
		p.saveVideoTranscript(post, transcript)
		return
	}
	p.saveVoiceTranscript(post, transcript)
}

func (p *Plugin) saveMediaDetectedLanguage(post *model.Post, language string) {
	if post == nil || strings.TrimSpace(language) == "" {
		return
	}

	updated := post.Clone()
	if updated.Props == nil {
		updated.Props = model.StringInterface{}
	}
	if isVideoNotePost(post) {
		updated.Props["video_detected_language"] = strings.TrimSpace(language)
	} else {
		updated.Props["voice_detected_language"] = strings.TrimSpace(language)
	}
	if _, appErr := p.API.UpdatePost(updated); appErr != nil {
		p.API.LogWarn("Failed to save detected media language on post", "post_id", post.Id, "error", appErr.Error())
	}
}

func (p *Plugin) transcribeVideoPost(post *model.Post) (string, error) {
	result, err := p.transcribeVideoPostDetailed(post)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

func (p *Plugin) transcribeVideoPostDetailed(post *model.Post) (sttResult, error) {
	videoFileID := p.videoFileIDFromPost(post)
	if videoFileID == "" {
		return sttResult{}, fmt.Errorf("no video attachment found")
	}

	videoData, appErr := p.API.GetFile(videoFileID)
	if appErr != nil {
		return sttResult{}, appErr
	}

	info, appErr := p.API.GetFileInfo(videoFileID)
	if appErr != nil {
		return sttResult{}, appErr
	}

	return p.transcribeBytesDetailed(post, videoData, info.Name, info.MimeType)
}

type sttAPIResponse struct {
	Text             string `json:"text"`
	DetectedLanguage string `json:"detected_language"`
}

type sttResult struct {
	Text             string
	DetectedLanguage string
}

func (p *Plugin) transcribeMediaPost(post *model.Post) (string, error) {
	result, err := p.transcribeMediaPostDetailed(post)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

func (p *Plugin) transcribeMediaPostDetailed(post *model.Post) (sttResult, error) {
	if isVideoNotePost(post) {
		return p.transcribeVideoPostDetailed(post)
	}
	return p.transcribeVoicePostDetailed(post)
}

func (p *Plugin) transcribeVoicePost(post *model.Post) (string, error) {
	result, err := p.transcribeVoicePostDetailed(post)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

func (p *Plugin) transcribeVoicePostDetailed(post *model.Post) (sttResult, error) {
	audioFileID := p.voiceFileIDFromPost(post)
	if audioFileID == "" {
		return sttResult{}, fmt.Errorf("no audio attachment found")
	}

	audioData, appErr := p.API.GetFile(audioFileID)
	if appErr != nil {
		return sttResult{}, appErr
	}

	info, appErr := p.API.GetFileInfo(audioFileID)
	if appErr != nil {
		return sttResult{}, appErr
	}

	return p.transcribeBytesDetailed(post, audioData, info.Name, info.MimeType)
}

func (p *Plugin) transcribeBytesDetailed(post *model.Post, data []byte, fileName, mimeType string) (sttResult, error) {
	if err := p.ensureSTTConfigured(); err != nil {
		return sttResult{}, err
	}

	ctx := context.Background()
	// Only reuse language detected from a prior transcription of this same recording.
	// Spoken language is auto-detected from audio — not from user text receive-language settings.
	languageHint := p.mediaLanguageHintFromPost(post)

	// Channel receive languages narrow STT auto-detect (e.g. ja + en in Town Square) without fixing one speaker language.
	channelLanguages := p.getChannelSTTLanguageCandidates(post)

	result, err := p.callSTTAPI(ctx, data, fileName, mimeType, languageHint, channelLanguages)
	if err != nil {
		return sttResult{}, err
	}

	if p.shouldRetryMediaSTT(result) {
		retryHint := inferSpokenLanguageFromTranscript(result.Text, result.DetectedLanguage)
		if retryHint == "" {
			retryHint = result.DetectedLanguage
		}
		if strings.TrimSpace(retryHint) != "" {
			retry, retryErr := p.callSTTAPI(ctx, data, fileName, mimeType, retryHint, channelLanguages)
			if retryErr == nil && p.preferMediaSTTResult(retry, result, retryHint) {
				result = retry
			}
		}
	}

	return result, nil
}

func (p *Plugin) resolveMediaText(post *model.Post) (text string, detectedLang string, err error) {
	if post == nil {
		return "", "", fmt.Errorf("post not found")
	}

	text = strings.TrimSpace(mediaTranscriptFromPost(post))
	detectedLang = strings.TrimSpace(p.mediaLanguageHintFromPost(post))
	if text != "" && !isPlaceholderMediaText(text, post) {
		return text, detectedLang, nil
	}

	transcribed, err := p.transcribeMediaPostDetailed(post)
	if err != nil {
		return "", "", err
	}

	text = strings.TrimSpace(transcribed.Text)
	detectedLang = strings.TrimSpace(transcribed.DetectedLanguage)
	if text == "" || isPlaceholderMediaText(text, post) {
		return "", "", fmt.Errorf("no speech detected in this recording")
	}

	p.saveMediaTranscript(post, text)
	if detectedLang != "" {
		p.saveMediaDetectedLanguage(post, detectedLang)
	}

	return text, detectedLang, nil
}

func (p *Plugin) getChannelSTTLanguageCandidates(post *model.Post) []string {
	if post == nil {
		return nil
	}

	seen := make(map[string]struct{})
	var codes []string

	add := func(code string) {
		normalized := normalizeLangCode(code)
		if normalized == "" {
			return
		}
		if _, ok := seen[normalized]; ok {
			return
		}
		seen[normalized] = struct{}{}
		codes = append(codes, normalized)
	}

	for _, userID := range p.getChannelMemberUserIDs(post.ChannelId) {
		add(p.getUserTargetLanguage(userID))
	}

	if len(codes) > 32 {
		codes = codes[:32]
	}
	return codes
}

func (p *Plugin) ensureSTTConfigured() error {
	config := p.getConfiguration()
	sttURL := strings.TrimSpace(config.STTApiURL)
	if sttURL == "" {
		sttURL = strings.TrimSpace(config.TranslationAPIURL)
	}
	if sttURL == "" {
		return fmt.Errorf("speech-to-text API URL is not configured")
	}
	return nil
}

func (p *Plugin) shouldRetryMediaSTT(result sttResult) bool {
	text := strings.TrimSpace(result.Text)
	detected := normalizeLangCode(result.DetectedLanguage)

	if text == "" {
		return true
	}

	if detected == "" {
		return true
	}

	if inferred := inferSpokenLanguageFromTranscript(text, detected); inferred != "" && inferred != detected {
		return true
	}

	return len(text) < 10
}

func (p *Plugin) preferMediaSTTResult(retry, first sttResult, preferredLang string) bool {
	retryText := strings.TrimSpace(retry.Text)
	firstText := strings.TrimSpace(first.Text)
	if retryText == "" {
		return false
	}
	if firstText == "" {
		return true
	}
	if normalizeLangCode(retry.DetectedLanguage) == normalizeLangCode(preferredLang) &&
		normalizeLangCode(first.DetectedLanguage) != normalizeLangCode(preferredLang) {
		return true
	}
	return len(retryText) > len(firstText)+2
}

func (p *Plugin) mediaLanguageHintFromPost(post *model.Post) string {
	if post == nil || post.Props == nil {
		return ""
	}
	if isVideoNotePost(post) {
		if lang, ok := post.Props["video_detected_language"].(string); ok && strings.TrimSpace(lang) != "" {
			return strings.TrimSpace(lang)
		}
		if lang, ok := post.Props["video_language"].(string); ok && strings.TrimSpace(lang) != "" {
			return normalizeLangCode(strings.TrimSpace(lang))
		}
	}
	if lang, ok := post.Props["voice_detected_language"].(string); ok && strings.TrimSpace(lang) != "" {
		return strings.TrimSpace(lang)
	}
	if lang, ok := post.Props["voice_language"].(string); ok && strings.TrimSpace(lang) != "" {
		return normalizeLangCode(strings.TrimSpace(lang))
	}
	return ""
}

func isMediaLanguageUncertain(result sttResult) bool {
	text := strings.TrimSpace(result.Text)
	if text == "" {
		return true
	}
	detected := normalizeLangCode(result.DetectedLanguage)
	if detected == "" {
		return true
	}
	inferred := inferSpokenLanguageFromTranscript(text, detected)
	return inferred != "" && inferred != detected
}

func (p *Plugin) mediaLanguageFromPost(post *model.Post) string {
	return p.mediaLanguageHintFromPost(post)
}

func (p *Plugin) callSTTAPI(ctx context.Context, audio []byte, fileName, mimeType, languageHint string, languageCandidates []string) (sttResult, error) {
	config := p.getConfiguration()
	baseURL := strings.TrimRight(config.STTApiURL, "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(config.TranslationAPIURL, "/")
	}

	apiKey := strings.TrimSpace(config.STTApiKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(config.TranslationAPIKey)
	}

	var lastErr error
	for attempt := 0; attempt <= 2; attempt++ {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, err := writer.CreateFormFile("audio", fileName)
		if err != nil {
			return sttResult{}, err
		}
		if _, err := part.Write(audio); err != nil {
			return sttResult{}, err
		}
		if strings.TrimSpace(mimeType) != "" {
			_ = writer.WriteField("mime_type", mimeType)
		}
		if strings.TrimSpace(languageHint) != "" {
			_ = writer.WriteField("language_hint", languageHint)
		}
		if len(languageCandidates) > 0 {
			_ = writer.WriteField("language_candidates", strings.Join(languageCandidates, ","))
		}
		if err := writer.Close(); err != nil {
			return sttResult{}, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/transcribe", body)
		if err != nil {
			return sttResult{}, err
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if apiKey != "" {
			req.Header.Set("X-API-Key", apiKey)
		}

		client := &http.Client{Timeout: 360 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < 2 {
				time.Sleep(time.Duration(700*(attempt+1)) * time.Millisecond)
				continue
			}
			return sttResult{}, err
		}

		respBody, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			return sttResult{}, readErr
		}

		if resp.StatusCode >= 500 && attempt < 2 {
			lastErr = fmt.Errorf("%s", strings.TrimSpace(string(respBody)))
			time.Sleep(time.Duration(700*(attempt+1)) * time.Millisecond)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			msg := strings.TrimSpace(string(respBody))
			if msg == "" {
				return sttResult{}, fmt.Errorf("STT API error: HTTP %d", resp.StatusCode)
			}
			return sttResult{}, fmt.Errorf("%s", msg)
		}

		var result sttAPIResponse
		if err := json.Unmarshal(respBody, &result); err != nil {
			return sttResult{}, err
		}
		return sttResult{
			Text:             strings.TrimSpace(result.Text),
			DetectedLanguage: normalizeLangCode(result.DetectedLanguage),
		}, nil
	}

	if lastErr != nil {
		return sttResult{}, lastErr
	}
	return sttResult{}, fmt.Errorf("STT API request failed after retries")
}