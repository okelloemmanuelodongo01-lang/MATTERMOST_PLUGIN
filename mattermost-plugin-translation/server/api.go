package main

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()
	router.Use(p.MattermostAuthorizationRequired)

	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	apiRouter.HandleFunc("/translate", p.handleTranslate).Methods(http.MethodPost)
	apiRouter.HandleFunc("/speak", p.handleSpeak).Methods(http.MethodPost)
	apiRouter.HandleFunc("/speak/resolve", p.handleSpeakResolve).Methods(http.MethodPost)
	apiRouter.HandleFunc("/sync", p.handleSync).Methods(http.MethodPost)
	apiRouter.HandleFunc("/evaluate", p.handleEvaluate).Methods(http.MethodPost)
	apiRouter.HandleFunc("/author-summary", p.handleAuthorSummary).Methods(http.MethodGet, http.MethodPost)
	apiRouter.HandleFunc("/preview", p.handlePreview).Methods(http.MethodPost)
	apiRouter.HandleFunc("/config", p.handleGetConfig).Methods(http.MethodGet)
	apiRouter.HandleFunc("/languages", p.handleLanguages).Methods(http.MethodGet)
	apiRouter.HandleFunc("/channel-languages", p.handleChannelLanguages).Methods(http.MethodGet)
	apiRouter.HandleFunc("/user-language", p.handleGetUserPublicLanguage).Methods(http.MethodGet)
	apiRouter.HandleFunc("/language", p.handleGetLanguage).Methods(http.MethodGet)
	apiRouter.HandleFunc("/language", p.handleSetLanguage).Methods(http.MethodPost)

	return router
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

func (p *Plugin) MattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-ID")
		if userID == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
