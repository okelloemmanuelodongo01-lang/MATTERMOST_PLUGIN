package main

import (
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

func (p *Plugin) getPostWithRetry(postID string, attempts int) (*model.Post, *model.AppError) {
	if attempts < 1 {
		attempts = 1
	}

	var lastErr *model.AppError
	for attempt := 0; attempt < attempts; attempt++ {
		post, appErr := p.API.GetPost(postID)
		if appErr == nil && post != nil {
			return post, nil
		}
		lastErr = appErr
		if attempt < attempts-1 {
			time.Sleep(time.Duration(150*(attempt+1)) * time.Millisecond)
		}
	}

	return nil, lastErr
}
