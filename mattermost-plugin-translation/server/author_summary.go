package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

type authorLanguageDelivery struct {
	To             string  `json:"to"`
	Translated     string  `json:"translated"`
	Reversed       string  `json:"reversed"`
	From           string  `json:"from"`
	DetectedFrom   string  `json:"detected_from"`
	Engine         string  `json:"engine"`
	Score          float64 `json:"score"`
	SemanticScore  float64 `json:"semantic_score"`
	EmbeddingScore float64 `json:"embedding_score"`
	QualityScore   float64 `json:"quality_score"`
	Cached         bool    `json:"cached"`
	SameLanguage   bool    `json:"same_language"`
	ReaderCount    int     `json:"reader_count"`
}

type authorDeliverySummary struct {
	PostID          string                   `json:"post_id"`
	Origin          string                   `json:"origin"`
	From            string                   `json:"from"`
	DetectedFrom    string                   `json:"detected_from"`
	RecipientCount  int                      `json:"recipient_count"`
	LanguageCount   int                      `json:"language_count"`
	Languages       []authorLanguageDelivery `json:"languages"`
}

func (p *Plugin) channelRecipientLanguages(authorID, channelID string) map[string]int {
	counts := make(map[string]int)
	for _, memberID := range p.getChannelMemberUserIDs(channelID) {
		if memberID == authorID {
			continue
		}
		lang := normalizeLangCode(p.getUserTargetLanguage(memberID))
		if lang == "" {
			continue
		}
		counts[lang]++
	}
	return counts
}

func (p *Plugin) buildAuthorDeliverySummary(postID, authorID, channelID, text, hintLanguage string, resultsByLang map[string]langTranslation) *authorDeliverySummary {
	text = strings.TrimSpace(text)
	if text == "" || postID == "" || authorID == "" || channelID == "" {
		return nil
	}

	langReaders := p.channelRecipientLanguages(authorID, channelID)
	if len(langReaders) == 0 {
		for _, memberID := range p.getChannelMemberUserIDs(channelID) {
			if memberID == authorID {
				continue
			}
			lang := normalizeLangCode(p.getUserTargetLanguage(memberID))
			if lang == "" {
				lang = "en"
			}
			langReaders[lang]++
		}
	}
	if len(langReaders) == 0 {
		return nil
	}

	hint := strings.TrimSpace(hintLanguage)
	if hint == "" {
		hint = p.getUserTargetLanguage(authorID)
	}

	deliveries := make([]authorLanguageDelivery, 0, len(langReaders))
	recipientCount := 0
	var origin, from, detectedFrom string

	for lang, readers := range langReaders {
		if readers <= 0 {
			continue
		}

		lt, ok := resultsByLang[lang]
		var result *TranslationResult
		var cached bool
		var sameLanguage bool

		if ok && lt.result != nil {
			result = lt.result
			cached = lt.cached
			sameLanguage = lt.sameLanguage
		} else {
			var err error
			result, cached, err = p.translateDeliverWithCache(text, "", lang, hint)
			if err != nil {
				p.API.LogWarn("Author delivery summary translation failed, using fallback", "post_id", postID, "to", lang, "error", err.Error())
				detected := normalizeLangCode(hint)
				if detected == "" {
					detected = "en"
				}
				result = &TranslationResult{
					Origin:       text,
					Translated:   text,
					From:         detected,
					DetectedFrom: detected,
					To:           lang,
					Engine:       "fallback",
					Reversed:     text,
					Score:        1,
					QualityScore: 1,
				}
				cached = false
				sameLanguage = isSameLanguage(detected, lang)
			} else {
				sameLanguage = isSameLanguage(result.DetectedFrom, lang)
			}
		}

		if result == nil {
			continue
		}

		result = p.ensureEvaluated(text, "", lang, hint, result)

		itemOrigin := strings.TrimSpace(result.Origin)
		if itemOrigin == "" {
			itemOrigin = text
		}
		itemTranslated := strings.TrimSpace(result.Translated)
		if itemTranslated == "" {
			itemTranslated = text
		}

		if origin == "" {
			origin = itemOrigin
			from = result.From
			detectedFrom = result.DetectedFrom
		}

		sameLanguage = sameLanguage || strings.EqualFold(itemOrigin, itemTranslated)

		recipientCount += readers
		deliveries = append(deliveries, authorLanguageDelivery{
			To:             lang,
			Translated:     itemTranslated,
			Reversed:       result.Reversed,
			From:           result.From,
			DetectedFrom:   result.DetectedFrom,
			Engine:         result.Engine,
			Score:          result.Score,
			SemanticScore:  result.SemanticScore,
			EmbeddingScore: result.EmbeddingScore,
			QualityScore:   result.QualityScore,
			Cached:         cached,
			SameLanguage:   sameLanguage,
			ReaderCount:    readers,
		})
	}

	if len(deliveries) == 0 {
		return nil
	}

	sort.Slice(deliveries, func(i, j int) bool {
		if deliveries[i].ReaderCount != deliveries[j].ReaderCount {
			return deliveries[i].ReaderCount > deliveries[j].ReaderCount
		}
		return deliveries[i].To < deliveries[j].To
	})

	return &authorDeliverySummary{
		PostID:         postID,
		Origin:         origin,
		From:           from,
		DetectedFrom:   detectedFrom,
		RecipientCount: recipientCount,
		LanguageCount:  len(deliveries),
		Languages:      deliveries,
	}
}

func authorLanguageDeliveryJSON(languages []authorLanguageDelivery) string {
	data, err := json.Marshal(languages)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func (p *Plugin) publishAuthorDeliverySummary(authorID string, summary *authorDeliverySummary) {
	if authorID == "" || summary == nil || len(summary.Languages) == 0 {
		return
	}

	payload := map[string]interface{}{
		"post_id":         summary.PostID,
		"origin":          summary.Origin,
		"from":            summary.From,
		"detected_from":   summary.DetectedFrom,
		"recipient_count": summary.RecipientCount,
		"language_count":  summary.LanguageCount,
		"languages_json":  authorLanguageDeliveryJSON(summary.Languages),
	}

	p.API.PublishWebSocketEvent("translation_author_summary", payload, &model.WebsocketBroadcast{
		UserId: authorID,
	})
}

func (p *Plugin) publishAuthorDeliveryComplete(authorID, postID string) {
	// Empty websocket payloads left the author panel stuck. The webapp fetches on demand instead.
	_ = authorID
	_ = postID
}

func (p *Plugin) handleAuthorSummary(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	postID := strings.TrimSpace(r.URL.Query().Get("post_id"))
	clientText := ""
	clientChannelID := ""

	if r.Method == http.MethodPost {
		var body struct {
			PostID    string `json:"post_id"`
			Text      string `json:"text"`
			ChannelID string `json:"channel_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			if postID == "" {
				postID = strings.TrimSpace(body.PostID)
			}
			clientText = strings.TrimSpace(body.Text)
			clientChannelID = strings.TrimSpace(body.ChannelID)
		}
	}
	if postID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "post_id is required"})
		return
	}

	post, appErr := p.getPostWithRetry(postID, 3)
	if appErr != nil || post == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Could not load post. Tap the chevron to retry."})
		return
	}
	if post.UserId != userID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "not allowed"})
		return
	}

	text := strings.TrimSpace(post.Message)
	if text == "" {
		text = clientText
	}
	if text == "" && isMediaNotePost(post) {
		text = strings.TrimSpace(mediaTranscriptFromPost(post))
	}
	channelID := post.ChannelId
	if channelID == "" {
		channelID = clientChannelID
	}
	if text == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "post has no text"})
		return
	}
	if channelID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "could not resolve channel for delivery summary"})
		return
	}

	hint := p.getUserTargetLanguage(userID)
	summary := p.buildAuthorDeliverySummary(postID, userID, channelID, text, hint, nil)
	if summary == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "could not build delivery summary"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(summary)
}
