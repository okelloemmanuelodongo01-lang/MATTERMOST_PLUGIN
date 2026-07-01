package main

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) MessageHasBeenPosted(_ *plugin.Context, post *model.Post) {
	if !p.isAutoTranslateEnabled() {
		return
	}

	if post == nil || post.DeleteAt > 0 {
		return
	}

	if post.Type != "" && post.Type != "custom_voice_note" && post.Type != "custom_video_note" {
		return
	}

	if post.Props != nil {
		if fromPlugin, ok := post.Props["from_translation_plugin"].(bool); ok && fromPlugin {
			return
		}
	}

	if isVoiceNotePost(post) || isVideoNotePost(post) {
		go p.processMediaPost(post)
		return
	}

	if strings.TrimSpace(post.Message) == "" {
		return
	}

	p.API.LogDebug("Auto-translate queued", "post_id", post.Id, "channel_id", post.ChannelId)
	go p.autoTranslatePost(post)
}

func (p *Plugin) autoTranslatePost(post *model.Post) {
	text := strings.TrimSpace(post.Message)
	if text == "" {
		return
	}
	p.autoTranslatePostTextWithHint(post, text, "")
}

func (p *Plugin) autoTranslatePostText(post *model.Post, text string) {
	p.autoTranslatePostTextWithHint(post, text, "")
}

func (p *Plugin) autoTranslatePostTextWithHint(post *model.Post, text string, hintLanguage string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}

	userIDs := p.getChannelMemberUserIDs(post.ChannelId)
	if len(userIDs) == 0 {
		p.API.LogWarn("Auto-translate skipped: no channel members", "post_id", post.Id, "channel_id", post.ChannelId)
		return
	}

	p.API.LogDebug("Auto-translate started", "post_id", post.Id, "members", len(userIDs))

	langToUsers := make(map[string][]string)
	for _, userID := range userIDs {
		lang := p.getUserTargetLanguage(userID)
		langToUsers[lang] = append(langToUsers[lang], userID)
	}

	var mu sync.Mutex
	var wg sync.WaitGroup

	for targetLang, users := range langToUsers {
		wg.Add(1)
		go func(to string, recipients []string) {
			defer wg.Done()

			hint := strings.TrimSpace(hintLanguage)
			if hint == "" && isMediaNotePost(post) {
				hint = normalizeLangCode(p.mediaLanguageHintFromPost(post))
			}
			if hint == "" {
				hint = p.getUserTargetLanguage(post.UserId)
			}

			result, cached, err := p.translateWithCache(text, "", to, hint)
			if err != nil {
				for _, userID := range recipients {
					p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
						"post_id": post.Id,
						"error":   err.Error(),
						"auto":    true,
					}, &model.WebsocketBroadcast{UserId: userID})
				}
				p.API.LogError("Auto-translation failed", "error", err.Error(), "post_id", post.Id, "to", to)
				return
			}

			sameLanguage := isSameLanguage(result.DetectedFrom, to)

			mu.Lock()
			for _, userID := range recipients {
				p.publishTranslationResult(userID, post.Id, result, cached, sameLanguage, true)
			}
			mu.Unlock()
		}(targetLang, users)
	}

	wg.Wait()
}

func (p *Plugin) getChannelMemberUserIDs(channelID string) []string {
	seen := make(map[string]struct{})
	var userIDs []string

	page := 0
	perPage := 200
	for {
		members, appErr := p.API.GetChannelMembers(channelID, page, perPage)
		if appErr != nil {
			p.API.LogError("Failed to get channel members", "channel_id", channelID, "error", appErr.Error())
			break
		}
		if len(members) == 0 {
			break
		}

		for _, member := range members {
			if _, ok := seen[member.UserId]; ok {
				continue
			}
			seen[member.UserId] = struct{}{}
			userIDs = append(userIDs, member.UserId)
		}

		if len(members) < perPage {
			break
		}
		page++
	}

	return userIDs
}

func isSameLanguage(detectedFrom, target string) bool {
	detected := normalizeLangCode(detectedFrom)
	targetCode := normalizeLangCode(target)
	if detected == "" || targetCode == "" {
		return false
	}
	return detected == targetCode
}

func normalizeLangCode(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if code == "" {
		return ""
	}
	if idx := strings.Index(code, "-"); idx > 0 {
		code = code[:idx]
	}
	return code
}

func (p *Plugin) translateWithCache(text, from, to, hintLanguage string) (*TranslationResult, bool, error) {
	cacheKey := p.cacheKey(text, from, to, hintLanguage)
	if cached, ok := p.getCachedTranslation(cacheKey); ok {
		return cached, true, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	result, err := p.callTranslationAPI(ctx, text, to, from, hintLanguage, false)
	if err != nil {
		return nil, false, err
	}

	p.storeCachedTranslation(cacheKey, result)
	return result, false, nil
}

func (p *Plugin) processMediaPost(post *model.Post) {
	if post == nil {
		return
	}

	transcribed, err := p.transcribeMediaPostDetailed(post)
	if err != nil {
		p.API.LogWarn("Media transcription unavailable", "post_id", post.Id, "error", err.Error())
		for _, userID := range p.getChannelMemberUserIDs(post.ChannelId) {
			p.API.PublishWebSocketEvent("translation_error", map[string]interface{}{
				"post_id": post.Id,
				"error":   "Could not transcribe this recording. Check microphone quality and speaking-language setting.",
				"auto":    true,
			}, &model.WebsocketBroadcast{UserId: userID})
		}
		return
	}

	text := strings.TrimSpace(transcribed.Text)
	if isPlaceholderMediaText(text, post) || text == "" {
		p.API.LogDebug("Media note has no transcript to translate", "post_id", post.Id)
		return
	}

	p.saveMediaTranscript(post, text)
	if transcribed.DetectedLanguage != "" {
		p.saveMediaDetectedLanguage(post, transcribed.DetectedLanguage)
	}

	p.autoTranslatePostTextWithHint(post, text, transcribed.DetectedLanguage)
}
