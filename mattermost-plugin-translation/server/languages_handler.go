package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

const languagesCatalogCacheKey = "languages_catalog_v1"
const languagesCatalogCacheTTL = 7 * 24 * 3600

type cachedLanguagesCatalog struct {
	Body      []byte `json:"body"`
	CachedAt  int64  `json:"cached_at"`
	ExpiresAt int64  `json:"expires_at"`
}

func (p *Plugin) getCachedLanguagesCatalog() ([]byte, bool) {
	data, err := p.API.KVGet(languagesCatalogCacheKey)
	if err != nil || len(data) == 0 {
		return nil, false
	}

	var cached cachedLanguagesCatalog
	if err := json.Unmarshal(data, &cached); err != nil {
		return nil, false
	}
	if len(cached.Body) == 0 {
		return nil, false
	}
	if cached.ExpiresAt > 0 && time.Now().Unix() > cached.ExpiresAt {
		_ = p.API.KVDelete(languagesCatalogCacheKey)
		return nil, false
	}

	return cached.Body, true
}

func (p *Plugin) storeCachedLanguagesCatalog(body []byte) {
	if len(body) == 0 {
		return
	}

	now := time.Now().Unix()
	cached := cachedLanguagesCatalog{
		Body:      body,
		CachedAt:  now,
		ExpiresAt: now + languagesCatalogCacheTTL,
	}
	data, err := json.Marshal(cached)
	if err != nil {
		return
	}
	if err := p.API.KVSet(languagesCatalogCacheKey, data); err != nil {
		p.API.LogWarn("Failed to cache languages catalog", "error", err.Error())
	}
}

func (p *Plugin) handleLanguages(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	baseURL := strings.TrimRight(config.TranslationAPIURL, "/")

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, baseURL+"/languages", nil)
	if err != nil {
		if body, ok := p.getCachedLanguagesCatalog(); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Translation-Languages-Source", "cache")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
			return
		}
		http.Error(w, "failed to create languages request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("X-API-Key", config.TranslationAPIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		if body, ok := p.getCachedLanguagesCatalog(); ok {
			p.API.LogWarn("Translation API unreachable for languages; serving cached catalog", "error", err.Error())
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Translation-Languages-Source", "cache")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
			return
		}
		http.Error(w, "translation API unreachable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if cached, ok := p.getCachedLanguagesCatalog(); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Translation-Languages-Source", "cache")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(cached)
			return
		}
		http.Error(w, "failed to read languages response", http.StatusBadGateway)
		return
	}

	if resp.StatusCode >= 200 && resp.StatusCode < 300 && len(body) > 0 {
		p.storeCachedLanguagesCatalog(body)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}
