package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

type speakAPIRequest struct {
	PostID string `json:"post_id"`
}

type cachedSpeakAudio struct {
	Audio     []byte `json:"audio"`
	CachedAt  int64  `json:"cached_at"`
	ExpiresAt int64  `json:"expires_at"`
}

func (p *Plugin) speakAudioCacheKey(text, language, voiceGender string) string {
	hash := sha256.Sum256([]byte(strings.TrimSpace(text) + "|" + normalizeLangCode(language) + "|" + googleTTSGenderCode(voiceGender)))
	return "speak_audio:" + hex.EncodeToString(hash[:16])
}

func (p *Plugin) getCachedSpeakAudio(key string) ([]byte, bool) {
	data, err := p.API.KVGet(key)
	if err != nil || len(data) == 0 {
		return nil, false
	}

	var cached cachedSpeakAudio
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil, false
	}
	if cached.ExpiresAt > 0 && time.Now().Unix() > cached.ExpiresAt {
		_ = p.API.KVDelete(key)
		return nil, false
	}
	if len(cached.Audio) == 0 {
		return nil, false
	}
	return cached.Audio, true
}

func (p *Plugin) storeCachedSpeakAudio(key string, audio []byte) {
	if len(audio) == 0 {
		return
	}
	now := time.Now().Unix()
	cached := cachedSpeakAudio{
		Audio:     audio,
		CachedAt:  now,
		ExpiresAt: now + 7*24*3600,
	}
	data, err := json.Marshal(cached)
	if err != nil {
		return
	}
	if err := p.API.KVSet(key, data); err != nil {
		p.API.LogWarn("Failed to cache speak audio", "error", err.Error())
	}
}

func (p *Plugin) resolveSpeakableTextForUser(post *model.Post, userID string) (string, string, error) {
	if post == nil {
		return "", "", fmt.Errorf("post not found")
	}

	targetLang := p.getUserTargetLanguage(userID)
	readMode := p.getUserReadAloudMode(userID)

	if post.UserId == userID {
		if isMediaNotePost(post) {
			return "", "", fmt.Errorf("use the media player for your own recording")
		}
		text := strings.TrimSpace(post.Message)
		if text == "" {
			return "", "", fmt.Errorf("no text to read")
		}
		if result, _, err := p.translateWithCache(text, "", targetLang, p.getUserTargetLanguage(post.UserId)); err == nil {
			return text, speakLanguageForAuthor(result, targetLang), nil
		}
		return text, normalizeLangCode(targetLang), nil
	}

	text := strings.TrimSpace(post.Message)
	if isMediaNotePost(post) {
		text = mediaTranscriptFromPost(post)
		if isPlaceholderMediaText(text, post) {
			transcribed, err := p.transcribeMediaPost(post)
			if err != nil {
				return "", "", fmt.Errorf("could not transcribe media: %w", err)
			}
			text = strings.TrimSpace(transcribed)
			if text != "" {
				p.saveMediaTranscript(post, text)
			}
		}
	}

	if text == "" {
		return "", "", fmt.Errorf("no text available to read")
	}

	result, _, err := p.translateWithCache(text, "", targetLang, p.getUserTargetLanguage(post.UserId))
	if err != nil {
		return "", "", err
	}

	if readMode == "original" {
		lang := normalizeLangCode(result.DetectedFrom)
		if lang == "" {
			lang = normalizeLangCode(targetLang)
		}
		return text, lang, nil
	}

	if isSameLanguage(result.DetectedFrom, targetLang) {
		lang := normalizeLangCode(result.DetectedFrom)
		if lang == "" {
			lang = normalizeLangCode(targetLang)
		}
		return text, lang, nil
	}

	spoken := strings.TrimSpace(result.Translated)
	lang := normalizeLangCode(targetLang)
	if lang == "" {
		lang = normalizeLangCode(result.To)
	}
	if spoken == "" {
		if lang == "" {
			lang = normalizeLangCode(result.DetectedFrom)
		}
		return text, lang, nil
	}

	return spoken, lang, nil
}

func speakLanguageForAuthor(result *TranslationResult, targetLang string) string {
	if result != nil {
		if lang := normalizeLangCode(result.DetectedFrom); lang != "" {
			return lang
		}
	}
	return normalizeLangCode(targetLang)
}

func (p *Plugin) callSynthesizeAPI(ctx context.Context, text, language, voiceGender string) ([]byte, error) {
	config := p.getConfiguration()
	baseURL := strings.TrimRight(config.TranslationAPIURL, "/")

	body, err := json.Marshal(map[string]string{
		"text":         text,
		"language":     language,
		"voice_gender": googleTTSGenderCode(voiceGender),
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/synthesize", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", config.TranslationAPIKey)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("speech API unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			return nil, fmt.Errorf("speech API error: HTTP %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	return respBody, nil
}

func friendlySynthesisError(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "Speech synthesis is unavailable."
	}

	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err == nil && strings.TrimSpace(parsed.Error) != "" {
		raw = strings.TrimSpace(parsed.Error)
	}

	lower := strings.ToLower(raw)
	if strings.Contains(lower, "texttospeech") && (strings.Contains(lower, "disabled") || strings.Contains(lower, "blocked") || strings.Contains(lower, "not been used")) {
		return "Google Text-to-Speech is not enabled for your API key. Enable Cloud Text-to-Speech in Google Cloud Console."
	}
	if strings.Contains(lower, "api key") {
		return "Google Text-to-Speech rejected the API key."
	}

	if len(raw) > 180 {
		return raw[:180] + "…"
	}
	return raw
}

func (p *Plugin) handleSpeakResolve(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var req speakAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	postID := strings.TrimSpace(req.PostID)
	if postID == "" {
		http.Error(w, "post_id is required", http.StatusBadRequest)
		return
	}

	post, appErr := p.API.GetPost(postID)
	if appErr != nil {
		http.Error(w, "post not found", http.StatusNotFound)
		return
	}

	text, language, err := p.resolveSpeakableTextForUser(post, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"text":             text,
		"language":         language,
		"voice_gender":     p.getUserTTSVoiceGender(userID),
		"read_aloud_mode":  p.getUserReadAloudMode(userID),
	})
}

func (p *Plugin) handleSpeak(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var req speakAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	postID := strings.TrimSpace(req.PostID)
	if postID == "" {
		http.Error(w, "post_id is required", http.StatusBadRequest)
		return
	}

	post, appErr := p.API.GetPost(postID)
	if appErr != nil {
		http.Error(w, "post not found", http.StatusNotFound)
		return
	}

	text, language, err := p.resolveSpeakableTextForUser(post, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	voiceGender := p.getUserTTSVoiceGender(userID)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cacheKey := p.speakAudioCacheKey(text, language, voiceGender)
	if audio, ok := p.getCachedSpeakAudio(cacheKey); ok {
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("X-TTS-Language", language)
		w.Header().Set("X-TTS-Cached", "true")
		_, _ = w.Write(audio)
		return
	}

	audio, err := p.callSynthesizeAPI(ctx, text, language, voiceGender)
	if err != nil {
		p.API.LogWarn("Speech synthesis failed", "post_id", postID, "error", err.Error())
		http.Error(w, friendlySynthesisError(err.Error()), http.StatusBadGateway)
		return
	}

	p.storeCachedSpeakAudio(cacheKey, audio)

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-TTS-Language", language)
	w.Header().Set("X-TTS-Cached", "false")
	_, _ = w.Write(audio)
}
