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
	hash := sha256.Sum256([]byte("v6-embedding-sync|" + strings.TrimSpace(text) + "|" + from + "|" + to + "|" + hintLanguage))
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

func (p *Plugin) publishTranslationResult(userID, postID string, result *TranslationResult, cached, sameLanguage, auto bool, languageUncertain bool) {
	p.publishTranslationDelivered(userID, postID, result, cached, sameLanguage, auto, languageUncertain)
	if result != nil && result.HasEvaluation() {
		p.publishTranslationEvaluated(userID, postID, result, cached)
	}
}

func (p *Plugin) publishTranslationDelivered(userID, postID string, result *TranslationResult, cached, sameLanguage, auto bool, languageUncertain bool) {
	if result == nil {
		return
	}

	payload := map[string]interface{}{
		"post_id":       postID,
		"origin":        result.Origin,
		"translated":    result.Translated,
		"from":          result.From,
		"to":            result.To,
		"detected_from": result.DetectedFrom,
		"engine":        result.Engine,
		"cached":        cached,
		"same_language": sameLanguage,
		"auto":          auto,
	}
	if languageUncertain {
		payload["language_uncertain"] = true
	}

	p.API.PublishWebSocketEvent("translation_delivered", payload, &model.WebsocketBroadcast{
		UserId: userID,
	})
}

func (p *Plugin) publishMediaTranslationProgress(userID, postID, stage string) {
	p.API.PublishWebSocketEvent("translation_media_progress", map[string]interface{}{
		"post_id": postID,
		"stage":   stage,
	}, &model.WebsocketBroadcast{UserId: userID})
}

func (p *Plugin) publishTranslationEvaluated(userID, postID string, result *TranslationResult, cached bool) {
	if result == nil {
		return
	}

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
	}

	p.API.PublishWebSocketEvent("translation_evaluated", payload, &model.WebsocketBroadcast{
		UserId: userID,
	})

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
	needsMediaSTT := false
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
			cachedText := strings.TrimSpace(mediaTranscriptFromPost(post))
			if cachedText != "" && !isPlaceholderMediaText(cachedText, post) {
				text = cachedText
				mediaTranslateHint = strings.TrimSpace(p.mediaLanguageHintFromPost(post))
			} else {
				needsMediaSTT = true
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

	if text == "" && !needsMediaSTT {
		http.Error(w, "No text available to translate. For voice or video messages, record again in Chrome/Edge or configure STT in plugin settings.", http.StatusBadRequest)
		return
	}

	to := strings.TrimSpace(req.To)
	if to == "" {
		to = p.getUserTargetLanguage(userID)
	}

	from := strings.TrimSpace(req.From)
	if isMediaPost && mediaPost != nil && text != "" {
		from = p.mediaTranslationSourceLanguage(mediaTranslateHint, mediaPost, text)
	}

	if !isMediaPost {
		cacheKey := p.cacheKey(text, from, to, "")
		if cached, ok := p.getCachedTranslation(cacheKey); ok {
			sameLanguage := isSameLanguage(cached.DetectedFrom, to)
			p.publishTranslationResult(userID, req.PostID, cached, true, sameLanguage, false, false)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"status":        "complete",
				"cached":        true,
				"same_language": sameLanguage,
				"result":        cached,
			})
			return
		}
	} else if text != "" {
		cacheKey := p.cacheKey(text, from, to, "")
		if cached, ok := p.getCachedTranslation(cacheKey); ok {
			sameLanguage := p.translationSameLanguage(true, mediaTranslateHint, from, to, text, cached)
			p.publishMediaTranslationDelivered(userID, req.PostID, cached, true, sameLanguage, false, false)
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
		languageUncertain := false
		workingText := text
		workingHint := mediaTranslateHint
		workingFrom := from

		if isMediaPost && needsMediaSTT && mediaPost != nil {
			p.publishMediaTranslationProgress(userID, req.PostID, "transcribing")
			transcribed, sttErr := p.transcribeMediaPostDetailed(mediaPost)
			if sttErr != nil {
				p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
					"post_id": req.PostID,
					"error":   "Could not transcribe media message: " + sttErr.Error(),
				}, &model.WebsocketBroadcast{UserId: userID})
				p.API.LogWarn("Media STT failed", "post_id", req.PostID, "error", sttErr.Error())
				return
			}

			workingText = strings.TrimSpace(transcribed.Text)
			workingHint = strings.TrimSpace(transcribed.DetectedLanguage)
			if workingText == "" || isPlaceholderMediaText(workingText, mediaPost) {
				p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
					"post_id": req.PostID,
					"error":   "No speech detected in this recording",
				}, &model.WebsocketBroadcast{UserId: userID})
				return
			}

			p.saveMediaTranscript(mediaPost, workingText)
			if workingHint != "" {
				p.saveMediaDetectedLanguage(mediaPost, workingHint)
			}
			languageUncertain = isMediaLanguageUncertain(transcribed)

			p.publishMediaTranslationProgress(userID, req.PostID, "detecting")
			workingFrom = p.mediaTranslationSourceLanguage(workingHint, mediaPost, workingText)
		} else if isMediaPost && mediaPost != nil {
			p.publishMediaTranslationProgress(userID, req.PostID, "detecting")
			workingFrom = p.mediaTranslationSourceLanguage(workingHint, mediaPost, workingText)
		}

		if isMediaPost {
			p.publishMediaTranslationProgress(userID, req.PostID, "translating")
			cacheKey := p.cacheKey(workingText, workingFrom, to, "")
			if cachedResult, ok := p.getCachedTranslation(cacheKey); ok {
				result = cachedResult
				cached = true
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
				defer cancel()
				result, err = p.callTranslationAPI(ctx, workingText, to, workingFrom, "", true)
				cached = false
				if err == nil && result != nil {
					p.storeCachedTranslation(cacheKey, result)
				}
			}
		} else {
			result, cached, err = p.translateWithCache(workingText, workingFrom, to, "")
		}

		if err != nil {
			p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
				"post_id": req.PostID,
				"error":   err.Error(),
			}, &model.WebsocketBroadcast{UserId: userID})
			p.API.LogError("Translation failed", "error", err.Error(), "post_id", req.PostID)
			return
		}

		sameLanguage := p.translationSameLanguage(isMediaPost, workingHint, workingFrom, to, workingText, result)
		if isMediaPost {
			p.publishMediaTranslationDelivered(userID, req.PostID, result, cached, sameLanguage, false, languageUncertain)
		} else {
			p.publishTranslationResult(userID, req.PostID, result, cached, sameLanguage, false, false)
		}
	}()
}

func (p *Plugin) publishMediaTranslationDelivered(userID, postID string, result *TranslationResult, cached, sameLanguage, auto bool, languageUncertain bool) {
	if result == nil {
		return
	}
	p.publishTranslationDelivered(userID, postID, result, cached, sameLanguage, auto, languageUncertain)
	if result.HasEvaluation() {
		p.publishTranslationEvaluated(userID, postID, result, cached)
		return
	}

	resultCopy := *result
	post, appErr := p.API.GetPost(postID)
	text := strings.TrimSpace(result.Origin)
	from := strings.TrimSpace(result.From)
	if post != nil && appErr == nil && isMediaNotePost(post) {
		if transcript := strings.TrimSpace(mediaTranscriptFromPost(post)); transcript != "" {
			text = transcript
		}
		sttLang := strings.TrimSpace(p.mediaLanguageHintFromPost(post))
		from = p.mediaTranslationSourceLanguage(sttLang, post, text)
	}
	if text == "" {
		text = strings.TrimSpace(resultCopy.Origin)
	}
	to := strings.TrimSpace(result.To)
	go p.evaluateSyncEntry(userID, postID, text, from, to, "", &resultCopy)
}

func (p *Plugin) mediaTranslationSourceLanguage(sttLang string, post *model.Post, transcript string) string {
	source := inferSpokenLanguageFromTranscript(transcript, sttLang)
	if source != "" {
		return source
	}

	if post != nil {
		if cached := normalizeLangCode(p.mediaLanguageHintFromPost(post)); cached != "" {
			return cached
		}
	}

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

type evaluateAPIRequest struct {
	PostID         string `json:"post_id"`
	TargetLanguage string `json:"target_language"`
	Text           string `json:"text"`
}

func (p *Plugin) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")

	var req evaluateAPIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	postID := strings.TrimSpace(req.PostID)
	if postID == "" {
		http.Error(w, "post_id is required", http.StatusBadRequest)
		return
	}

	text := strings.TrimSpace(req.Text)
	from := ""
	hint := ""
	if text == "" {
		post, appErr := p.getPostWithRetry(postID, 3)
		if appErr != nil || post == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Could not load post. Tap the chevron to retry."})
			return
		}
		if isMediaNotePost(post) {
			text = strings.TrimSpace(mediaTranscriptFromPost(post))
			if text == "" || isPlaceholderMediaText(text, post) {
				http.Error(w, "No transcript available yet. Translate the voice or video message first.", http.StatusBadRequest)
				return
			}
			sttLang := strings.TrimSpace(p.mediaLanguageHintFromPost(post))
			from = p.mediaTranslationSourceLanguage(sttLang, post, text)
		} else {
			text = strings.TrimSpace(post.Message)
		}
	}
	if text == "" {
		http.Error(w, "post has no text", http.StatusBadRequest)
		return
	}

	to := strings.TrimSpace(req.TargetLanguage)
	if to == "" {
		to = p.getUserTargetLanguage(userID)
	}

	var deliver *TranslationResult
	var cached bool
	var err error
	if from != "" {
		deliver, cached, err = p.translateWithCacheFast(text, from, to, hint)
	} else {
		deliver, cached, err = p.translateDeliverWithCache(text, "", to, hint)
	}
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	evaluated := p.ensureEvaluated(text, from, to, hint, deliver)
	p.publishTranslationEvaluated(userID, postID, evaluated, cached)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"post_id":         postID,
		"status":          "complete",
		"cached":          cached,
		"origin":          evaluated.Origin,
		"translated":      evaluated.Translated,
		"from":            evaluated.From,
		"to":              evaluated.To,
		"detected_from":   evaluated.DetectedFrom,
		"engine":          evaluated.Engine,
		"reversed":        evaluated.Reversed,
		"score":           evaluated.Score,
		"semantic_score":  evaluated.SemanticScore,
		"embedding_score": evaluated.EmbeddingScore,
		"quality_score":   evaluated.QualityScore,
	})
}

type syncAPIRequest struct {
	Posts           []syncPostInput `json:"posts"`
	TargetLanguage  string          `json:"target_language"`
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

	if clientLang := normalizeLangCode(strings.TrimSpace(req.TargetLanguage)); clientLang != "" {
		to = clientLang
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

		var post *model.Post
		if fetched, appErr := p.API.GetPost(item.ID); appErr == nil {
			post = fetched
		}

		// Reader translations only — author delivery uses GET /author-summary.
		if post != nil && post.UserId == userID {
			continue
		}

		targetLang := to
		result, cached, err := p.translateDeliverWithCache(text, "", targetLang, "")
		if err != nil {
			p.API.LogWarn("Sync translation failed", "post_id", item.ID, "error", err.Error())
			continue
		}

		sameLanguage := isSameLanguage(result.DetectedFrom, targetLang)

		entry := syncTranslationEntry{
			PostID:         item.ID,
			Origin:         result.Origin,
			Translated:     result.Translated,
			From:           result.From,
			To:             result.To,
			DetectedFrom:   result.DetectedFrom,
			Engine:         result.Engine,
			Reversed:       result.Reversed,
			Score:          result.Score,
			SemanticScore:  result.SemanticScore,
			EmbeddingScore: result.EmbeddingScore,
			QualityScore:   result.QualityScore,
			Cached:         cached,
			SameLanguage:   sameLanguage,
		}
		results = append(results, entry)

		if !result.HasEvaluation() && text != "" {
			postID := item.ID
			deliverCopy := *result
			go p.evaluateSyncEntry(userID, postID, text, "", targetLang, "", &deliverCopy)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"translations":    results,
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
