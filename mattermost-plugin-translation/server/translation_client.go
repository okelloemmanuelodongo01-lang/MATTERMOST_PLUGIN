package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type TranslationResult struct {
	Origin         string  `json:"origin"`
	To             string  `json:"to"`
	From           string  `json:"from"`
	DetectedFrom   string  `json:"detected_from"`
	Translated     string  `json:"translated"`
	Engine         string  `json:"engine"`
	Reversed       string  `json:"reversed"`
	Score          float64 `json:"score"`
	SemanticScore  float64 `json:"semantic_score"`
	EmbeddingScore float64 `json:"embedding_score"`
	QualityScore   float64 `json:"quality_score"`
}

type translateRequestBody struct {
	Text         string `json:"text,omitempty"`
	To           string `json:"to"`
	From         string `json:"from,omitempty"`
	HintLanguage string `json:"hint_language,omitempty"`
	Fast         bool   `json:"fast,omitempty"`
	Phase        string `json:"phase,omitempty"`
	Origin       string `json:"origin,omitempty"`
	Translated   string `json:"translated,omitempty"`
	DetectedFrom string `json:"detected_from,omitempty"`
	Engine       string `json:"engine,omitempty"`
}

func (r *TranslationResult) HasEvaluation() bool {
	return strings.TrimSpace(r.Reversed) != "" && (r.QualityScore > 0 || r.Score > 0)
}

func (r *TranslationResult) MergeEvaluation(other *TranslationResult) {
	if other == nil {
		return
	}
	if other.Reversed != "" {
		r.Reversed = other.Reversed
	}
	if other.Score > 0 {
		r.Score = other.Score
	}
	if other.SemanticScore > 0 {
		r.SemanticScore = other.SemanticScore
	}
	if other.EmbeddingScore > 0 {
		r.EmbeddingScore = other.EmbeddingScore
	}
	if other.QualityScore > 0 {
		r.QualityScore = other.QualityScore
	}
	if other.Engine != "" && !strings.Contains(r.Engine, ":evaluate") {
		r.Engine = other.Engine
	}
}

func (p *Plugin) callTranslationAPI(ctx context.Context, text, to, from, hintLanguage string, fast bool) (*TranslationResult, error) {
	phase := ""
	if fast {
		return p.postTranslationAPI(ctx, translateRequestBody{
			Text:         text,
			To:           to,
			From:         from,
			HintLanguage: hintLanguage,
			Fast:         true,
		}, 120*time.Second)
	}
	return p.postTranslationAPI(ctx, translateRequestBody{
		Text:         text,
		To:           to,
		From:         from,
		HintLanguage: hintLanguage,
		Phase:        phase,
	}, 90*time.Second)
}

func (p *Plugin) callTranslationDeliverAPI(ctx context.Context, text, to, from, hintLanguage string) (*TranslationResult, error) {
	return p.postTranslationAPI(ctx, translateRequestBody{
		Text:         text,
		To:           to,
		From:         from,
		HintLanguage: hintLanguage,
		Phase:        "deliver",
	}, 45*time.Second)
}

func (p *Plugin) callTranslationEvaluateAPI(ctx context.Context, deliver *TranslationResult) (*TranslationResult, error) {
	if deliver == nil {
		return nil, fmt.Errorf("deliver result is required")
	}
	origin := strings.TrimSpace(deliver.Origin)
	if origin == "" {
		origin = strings.TrimSpace(deliver.Translated)
	}
	engine := deliver.Engine
	engine = strings.TrimSuffix(engine, ":deliver")
	return p.postTranslationAPI(ctx, translateRequestBody{
		To:           deliver.To,
		From:         deliver.From,
		DetectedFrom: deliver.DetectedFrom,
		Engine:       engine,
		Phase:        "evaluate",
		Origin:       origin,
		Translated:   deliver.Translated,
	}, 90*time.Second)
}

func (p *Plugin) postTranslationAPI(ctx context.Context, body translateRequestBody, timeout time.Duration) (*TranslationResult, error) {
	config := p.getConfiguration()

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	baseURL := strings.TrimRight(config.TranslationAPIURL, "/")
	endpoint := baseURL + "/translate"
	if body.Phase == "deliver" {
		endpoint = baseURL + "/translate/deliver"
		body.Phase = ""
		payload, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	} else if body.Phase == "evaluate" {
		endpoint = baseURL + "/translate/evaluate"
		evalBody := map[string]string{
			"origin":        body.Origin,
			"translated":    body.Translated,
			"to":            body.To,
			"from":          body.From,
			"detected_from": body.DetectedFrom,
			"engine":        body.Engine,
		}
		payload, err = json.Marshal(evalBody)
		if err != nil {
			return nil, err
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", config.TranslationAPIKey)

	client := &http.Client{Timeout: timeout}
	resp, err := p.doHTTPWithRetry(client, req, 2)
	if err != nil {
		return nil, fmt.Errorf("translation API unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("translation API rejected the API key")
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("translation API quota exceeded")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respBody, &apiErr)
		if apiErr.Error != "" {
			return nil, fmt.Errorf("translation API error: %s", apiErr.Error)
		}
		return nil, fmt.Errorf("translation API error: HTTP %d", resp.StatusCode)
	}

	var result TranslationResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (p *Plugin) doHTTPWithRetry(client *http.Client, req *http.Request, retries int) (*http.Response, error) {
	var lastErr error
	bodyBytes, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}

	for attempt := 0; attempt <= retries; attempt++ {
		reqCopy := req.Clone(req.Context())
		reqCopy.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		resp, err := client.Do(reqCopy)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}

		if resp != nil {
			if resp.StatusCode < 500 {
				return resp, nil
			}
			_ = resp.Body.Close()
		}

		lastErr = err
		if attempt < retries {
			time.Sleep(time.Duration(700*(attempt+1)) * time.Millisecond)
		}
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("translation API request failed after retries")
}
