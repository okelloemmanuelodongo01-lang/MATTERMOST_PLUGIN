package main

import (
	"context"
	"strings"
	"time"
)

func (p *Plugin) ensureEvaluated(text, from, to, hintLanguage string, deliver *TranslationResult) *TranslationResult {
	if deliver == nil {
		return nil
	}

	if deliver.HasEvaluation() {
		return deliver
	}

	full := *deliver
	if strings.TrimSpace(full.Origin) == "" {
		full.Origin = strings.TrimSpace(text)
	}

	if isSameLanguage(full.DetectedFrom, to) || isSameLanguage(full.From, to) {
		origin := strings.TrimSpace(full.Origin)
		if origin == "" {
			origin = strings.TrimSpace(text)
		}
		full.Reversed = origin
		full.Score = 1
		full.SemanticScore = 1
		full.EmbeddingScore = 1
		full.QualityScore = 1
		p.storeCachedTranslation(p.cacheKey(text, from, to, hintLanguage), &full)
		return &full
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	evaluated, err := p.callTranslationEvaluateAPI(ctx, &full)
	if err != nil {
		p.API.LogWarn("Translation evaluation failed", "to", to, "error", err.Error())
		return deliver
	}

	full.MergeEvaluation(evaluated)
	p.storeCachedTranslation(p.cacheKey(text, from, to, hintLanguage), &full)
	return &full
}
