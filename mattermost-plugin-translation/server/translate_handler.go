package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

type translateAPIRequest struct {
	PostID string `json:"post_id"`
	Text   string `json:"text"`
	To     string `json:"to"`
	From   string `json:"from"`
}

type cachedTranslation struct {
	Result    TranslationResult `json:"result"`
	CachedAt  int64             `json:"cached_at"`
	ExpiresAt int64             `json:"expires_at"`
}

func (p *Plugin) cacheKey(text, from, to, hintLanguage string) string {
	hash := sha256.Sum256([]byte(strings.TrimSpace(text) + "|" + from + "|" + to + "|" + hintLanguage))
	return "translation:" + hex.EncodeToString(hash[:])
}

func (p *Plugin) getCachedTranslation(key string) (*TranslationResult, bool) {
	data, err := p.API.KVGet(key)
	if err != nil || len(data) == 0 {
		return nil, false
	}

	var cached cachedTranslation
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil, false
	}

	if cached.ExpiresAt > 0 && time.Now().Unix() > cached.ExpiresAt {
		_ = p.API.KVDelete(key)
		return nil, false
	}

	return &cached.Result, true
}

func (p *Plugin) storeCachedTranslation(key string, result *TranslationResult) {
	config := p.getConfiguration()
	now := time.Now().Unix()
	cached := cachedTranslation{
		Result:    *result,
		CachedAt:  now,
		ExpiresAt: now + int64(config.CacheTTLHours)*3600,
	}

	data, err := json.Marshal(cached)
	if err != nil {
		p.API.LogError("Failed to marshal cache entry", "error", err.Error())
		return
	}

	if err := p.API.KVSet(key, data); err != nil {
		p.API.LogError("Failed to store cache entry", "error", err.Error())
	}
}

const pluginPreferenceCategory = "pp_com.transchecker.translation"
const targetLanguagePreferenceName = "target_language"

func (p *Plugin) userLanguageKey(userID string) string {
	return "lang_" + userID
}

func (p *Plugin) getUserTargetLanguage(userID string) string {
	config := p.getConfiguration()

	if pref, appErr := p.API.GetPreferenceForUser(userID, pluginPreferenceCategory, targetLanguagePreferenceName); appErr == nil && pref.Value != "" {
		return pref.Value
	}

	data, err := p.API.KVGet(p.userLanguageKey(userID))
	if err == nil && len(data) > 0 {
		return string(data)
	}

	return config.DefaultTargetLanguage
}

func (p *Plugin) setUserTargetLanguage(userID, lang string) error {
	pref := model.Preference{
		UserId:   userID,
		Category: pluginPreferenceCategory,
		Name:     targetLanguagePreferenceName,
		Value:    lang,
	}

	if appErr := p.API.UpdatePreferencesForUser(userID, []model.Preference{pref}); appErr != nil {
		p.API.LogError("Failed to save language preference", "error", appErr.Error(), "user_id", userID, "lang", lang)
		return appErr
	}

	if err := p.API.KVSet(p.userLanguageKey(userID), []byte(lang)); err != nil {
		p.API.LogWarn("Saved language preference but KV backup failed", "error", err.Error())
	}

	p.publishLanguagePreferenceChanged(userID, lang)

	return nil
}

func (p *Plugin) SetUserLanguage(userID, lang string) error {
	return p.setUserTargetLanguage(userID, lang)
}

func (p *Plugin) GetUserLanguage(userID string) string {
	return p.getUserTargetLanguage(userID)
}

func (p *Plugin) TranslateMessage(userID, postID, text, to string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	result, err := p.callTranslationAPI(ctx, text, to, "", "", false)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(
		"**Translated (%s → %s)** via %s\n%s\n\nQuality: **%.0f%%** | AI semantic: **%.0f%%** | Character match: **%.0f%%**\n\n_Back-translation:_ %s",
		result.DetectedFrom,
		result.To,
		result.Engine,
		result.Translated,
		result.QualityScore*100,
		result.EmbeddingScore*100,
		result.Score*100,
		result.Reversed,
	), nil
}

func (p *Plugin) publishTranslationResult(userID, postID string, result *TranslationResult, cached, sameLanguage, auto bool) {
	payload := map[string]interface{}{
		"post_id":         postID,
		"origin":          result.Origin,
		"translated":      result.Translated,
		"from":            result.From,
		"to":              result.To,
		"detected_from":   result.DetectedFrom,
		"engine":          result.Engine,
		"reversed":        result.Reversed,
		"score":           result.Score,
		"semantic_score":  result.SemanticScore,
		"embedding_score": result.EmbeddingScore,
		"quality_score":   result.QualityScore,
		"cached":          cached,
		"same_language":   sameLanguage,
		"auto":            auto,
	}

	p.API.PublishWebSocketEvent("translation_result", payload, &model.WebsocketBroadcast{
		UserId: userID,
	})
}

func (p *Plugin) handleTranslate(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var req translateAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	text := strings.TrimSpace(req.Text)
	mediaTranslateHint := ""
	isMediaPost := false
	var mediaPost *model.Post
	if req.PostID != "" {
		post, appErr := p.API.GetPost(req.PostID)
		if appErr != nil {
			http.Error(w, "post not found", http.StatusNotFound)
			return
		}
		if isMediaNotePost(post) {
			isMediaPost = true
			mediaPost = post
			transcribed, err := p.transcribeMediaPostDetailed(post)
			if err != nil {
				p.API.LogWarn("Media STT failed", "post_id", req.PostID, "error", err.Error())
				http.Error(w, "Could not transcribe media message: "+err.Error(), http.StatusBadRequest)
				return
			}
			text = strings.TrimSpace(transcribed.Text)
			mediaTranslateHint = strings.TrimSpace(transcribed.DetectedLanguage)
			if text != "" {
				p.saveMediaTranscript(post, text)
				if mediaTranslateHint != "" {
					p.saveMediaDetectedLanguage(post, mediaTranslateHint)
				}
			}
		} else {
			if text == "" {
				text = mediaTranscriptFromPost(post)
			}
			if text == "" {
				text = strings.TrimSpace(post.Message)
			}
		}
	}

	if text == "" {
		http.Error(w, "No text available to translate. For voice or video messages, record again in Chrome/Edge or configure STT in plugin settings.", http.StatusBadRequest)
		return
	}

	to := strings.TrimSpace(req.To)
	if to == "" {
		to = p.getUserTargetLanguage(userID)
	}

	from := strings.TrimSpace(req.From)
	if isMediaPost && mediaPost != nil {
		from = p.mediaTranslationSourceLanguage(mediaTranslateHint, mediaPost, text)
	}

	if !isMediaPost {
		cacheKey := p.cacheKey(text, from, to, "")
		if cached, ok := p.getCachedTranslation(cacheKey); ok {
			sameLanguage := isSameLanguage(cached.DetectedFrom, to)
			p.publishTranslationResult(userID, req.PostID, cached, true, sameLanguage, false)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status":        "complete",
				"cached":        true,
				"same_language": sameLanguage,
				"result":        cached,
			})
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "translating",
		"post_id": req.PostID,
	})

	go func() {
		var result *TranslationResult
		var cached bool
		var err error

		if isMediaPost {
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()
			result, err = p.callTranslationAPI(ctx, text, to, from, "", true)
			cached = false
		} else {
			result, cached, err = p.translateWithCache(text, from, to, "")
		}

		if err != nil {
			p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
				"post_id": req.PostID,
				"error":   err.Error(),
			}, &model.WebsocketBroadcast{UserId: userID})
			p.API.LogError("Translation failed", "error", err.Error(), "post_id", req.PostID)
			return
		}

		sameLanguage := p.translationSameLanguage(isMediaPost, mediaTranslateHint, from, to, text, result)
		p.publishTranslationResult(userID, req.PostID, result, cached, sameLanguage, false)
	}()
}

func (p *Plugin) mediaTranslationSourceLanguage(sttLang string, post *model.Post, transcript string) string {
	source := normalizeLangCode(sttLang)
	if source != "" {
		return source
	}

	if post != nil {
		if cached := normalizeLangCode(p.mediaLanguageHintFromPost(post)); cached != "" {
			return cached
		}
	}

	_ = transcript
	return source
}

func (p *Plugin) translationSameLanguage(isMedia bool, sttLang, fromLang, targetLang, sourceText string, result *TranslationResult) bool {
	if result == nil {
		return true
	}

	translated := strings.TrimSpace(result.Translated)
	origin := strings.TrimSpace(result.Origin)
	if translated != "" && origin != "" && translated != origin {
		return false
	}

	target := normalizeLangCode(targetLang)
	if isMedia {
		if from := normalizeLangCode(fromLang); from != "" {
			return from == target
		}
		if stt := normalizeLangCode(sttLang); stt != "" {
			return stt == target
		}
	}

	return isSameLanguage(result.DetectedFrom, targetLang)
}

type syncPostInput struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type syncAPIRequest struct {
	Posts []syncPostInput `json:"posts"`
}

type syncTranslationEntry struct {
	PostID        string  `json:"post_id"`
	Origin        string  `json:"origin"`
	Translated    string  `json:"translated"`
	From          string  `json:"from"`
	To            string  `json:"to"`
	DetectedFrom  string  `json:"detected_from"`
	Engine        string  `json:"engine"`
	Reversed      string  `json:"reversed"`
	Score          float64 `json:"score"`
	SemanticScore  float64 `json:"semantic_score"`
	EmbeddingScore float64 `json:"embedding_score"`
	QualityScore   float64 `json:"quality_score"`
	Cached        bool    `json:"cached"`
	SameLanguage  bool    `json:"same_language"`
}

func (p *Plugin) handleSync(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	to := p.getUserTargetLanguage(userID)

	var req syncAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if len(req.Posts) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"translations": []syncTranslationEntry{}})
		return
	}

	if len(req.Posts) > 60 {
		req.Posts = req.Posts[:60]
	}

	results := make([]syncTranslationEntry, 0, len(req.Posts))
	for _, item := range req.Posts {
		text := strings.TrimSpace(item.Text)
		if text == "" || item.ID == "" {
			continue
		}

		result, cached, err := p.translateWithCache(text, "", to, "")
		if err != nil {
			p.API.LogWarn("Sync translation failed", "post_id", item.ID, "error", err.Error())
			continue
		}

		sameLanguage := isSameLanguage(result.DetectedFrom, to)
		results = append(results, syncTranslationEntry{
			PostID:        item.ID,
			Origin:        result.Origin,
			Translated:    result.Translated,
			From:          result.From,
			To:            result.To,
			DetectedFrom:  result.DetectedFrom,
			Engine:        result.Engine,
			Reversed:      result.Reversed,
			Score:          result.Score,
			SemanticScore:  result.SemanticScore,
			EmbeddingScore: result.EmbeddingScore,
			QualityScore:   result.QualityScore,
			Cached:        cached,
			SameLanguage:  sameLanguage,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"translations": results,
		"target_language": to,
	})
}

type previewAPIRequest struct {
	Text      string `json:"text"`
	To        string `json:"to"`
	ChannelID string `json:"channel_id"`
}

func (p *Plugin) previewTargetLanguage(userID, channelID, clientTo string) string {
	if lang := strings.TrimSpace(clientTo); lang != "" {
		return lang
	}

	if channelID != "" {
		recipientLangs := make(map[string]struct{})
		for _, memberID := range p.getChannelMemberUserIDs(channelID) {
			if memberID == userID {
				continue
			}
			lang := normalizeLangCode(p.getUserTargetLanguage(memberID))
			if lang != "" {
				recipientLangs[lang] = struct{}{}
			}
		}
		if len(recipientLangs) == 1 {
			for lang := range recipientLangs {
				return lang
			}
		}
	}

	return p.getUserTargetLanguage(userID)
}

func previewNeedsConfirmation(result *TranslationResult, targetLang string) bool {
	if result == nil {
		return false
	}
	targetLang = normalizeLangCode(targetLang)
	detected := normalizeLangCode(result.DetectedFrom)
	origin := strings.TrimSpace(result.Origin)
	translated := strings.TrimSpace(result.Translated)

	if origin == "" {
		return false
	}
	if translated == "" {
		return false
	}
	if translated != origin {
		return true
	}
	if targetLang == "" || detected == "" {
		return false
	}
	return detected != targetLang
}

func (p *Plugin) handlePreview(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var req previewAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	text := strings.TrimSpace(req.Text)
	if text == "" {
		http.Error(w, "text is required", http.StatusBadRequest)
		return
	}

	to := p.previewTargetLanguage(userID, strings.TrimSpace(req.ChannelID), req.To)

	result, cached, err := p.translateWithCache(text, "", to, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	needsPreview := previewNeedsConfirmation(result, to)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"origin":          result.Origin,
		"translated":      result.Translated,
		"from":            result.From,
		"to":              result.To,
		"detected_from":   result.DetectedFrom,
		"engine":          result.Engine,
		"reversed":        result.Reversed,
		"score":           result.Score,
		"semantic_score":  result.SemanticScore,
		"embedding_score": result.EmbeddingScore,
		"quality_score":   result.QualityScore,
		"cached":          cached,
		"same_language":   !needsPreview,
		"needs_preview":   needsPreview,
	})
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"enable_auto_translate":        p.isAutoTranslateEnabled(),
		"enable_pre_translate_preview": p.isPreTranslatePreviewEnabled(),
	})
}

func (p *Plugin) handleGetLanguage(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	lang := p.getUserTargetLanguage(userID)
	voice := p.getUserTTSVoiceGender(userID)
	readMode := p.getUserReadAloudMode(userID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"target_language":  lang,
		"tts_voice_gender": voice,
		"read_aloud_mode":  readMode,
	})
}

func (p *Plugin) handleSetLanguage(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var body struct {
		TargetLanguage string `json:"target_language"`
		TTSVoiceGender string `json:"tts_voice_gender"`
		ReadAloudMode  string `json:"read_aloud_mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	lang := strings.TrimSpace(body.TargetLanguage)
	voice := strings.TrimSpace(body.TTSVoiceGender)
	readMode := strings.TrimSpace(body.ReadAloudMode)

	if lang == "" && voice == "" && readMode == "" {
		http.Error(w, "target_language, tts_voice_gender, or read_aloud_mode is required", http.StatusBadRequest)
		return
	}

	if lang != "" {
		if err := p.setUserTargetLanguage(userID, lang); err != nil {
			http.Error(w, fmt.Sprintf("failed to save preference: %s", err.Error()), http.StatusInternalServerError)
			return
		}
	}

	if voice != "" {
		if err := p.setUserTTSVoiceGender(userID, voice); err != nil {
			http.Error(w, fmt.Sprintf("failed to save voice preference: %s", err.Error()), http.StatusInternalServerError)
			return
		}
	}

	if readMode != "" {
		if err := p.setUserReadAloudMode(userID, readMode); err != nil {
			http.Error(w, fmt.Sprintf("failed to save read-aloud mode: %s", err.Error()), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"target_language":  p.getUserTargetLanguage(userID),
		"tts_voice_gender": p.getUserTTSVoiceGender(userID),
		"read_aloud_mode":  p.getUserReadAloudMode(userID),
	})
}
