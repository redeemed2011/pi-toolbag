package main

import (
	"regexp"
	"strings"
)

var (
	authNeedles     = []string{"invalid api key", "authentication", "unauthorized", "forbidden"}
	invalidModel    = []string{"invalid model", "model not found"}
	overflowNeedles = []string{
		"context_length_exceeded", "context window", "maximum context length", "prompt too long",
		"request_too_large", "exceeds context window", "maximum prompt length", "model_context_window_exceeded",
	}
	quotaNeedles = []string{
		"usage balance exhausted", "balance exhausted", "insufficient_quota", "quota exceeded", "out of budget",
		"quota", "available credits", "spending limit", "monthly spending", "billing",
	}
	transientNeedles = []string{
		"timeout", "timed out", "origin_response_timeout", "rate limit", "too many requests", "overloaded",
		"unavailable", "resource_exhausted", "econnreset", "econnrefused", "etimedout", "socket hang up",
		"fetch failed", "connection reset", "connection refused", "server_busy", "servers are currently busy",
		"currently experiencing high demand", "at capacity", "provider returned an error", "provider returned error",
		"server error",
	}
	safetyStops = map[string]bool{
		"refusal": true, "sensitive": true, "content_filtered": true, "guardrail_intervened": true,
		"content_filter": true, "incomplete.content_filter": true, "SAFETY": true, "PROHIBITED_CONTENT": true,
		"BLOCKLIST": true, "SPII": true, "RECITATION": true, "IMAGE_SAFETY": true,
		"IMAGE_PROHIBITED_CONTENT": true, "IMAGE_RECITATION": true,
	}
	safetyPhrases = []string{
		"Output blocked by content filtering policy",
		"The request was rejected due to inappropriate content",
		"guardrail_blocked",
	}
	labeledStatus   = regexp.MustCompile(`(?i)(?:status|http|error(?:\s+code)?|code)\s*[:=]?\s*([45]\d{2})\b`)
	bareStatus      = regexp.MustCompile(`\b([45]\d{2})\b`)
	quota402        = regexp.MustCompile(`(?i)\b402\b`)
	transientStatus = map[int]bool{408: true, 409: true, 425: true, 429: true}
)

type failoverError struct {
	Status        *int    `json:"status"`
	Text          string  `json:"text"`
	StopReason    *string `json:"stopReason"`
	RawStopReason *string `json:"rawStopReason"`
	Category      *string `json:"category"`
}

func classifyError(err failoverError) string {
	if err.StopReason != nil && *err.StopReason == "aborted" {
		return "aborted"
	}
	if err.StopReason != nil && *err.StopReason != "error" {
		return "other"
	}
	if err.RawStopReason != nil && safetyStops[*err.RawStopReason] {
		if *err.RawStopReason == "refusal" && err.Category != nil && *err.Category == "reasoning_extraction" {
			return "other"
		}
		return "safety"
	}
	text := err.Text
	var status *int
	if err.Status != nil {
		status = err.Status
	} else if parsed, ok := parseStatus(text); ok {
		status = &parsed
	}
	if strings.TrimSpace(text) == "" && status == nil {
		return "other"
	}
	if (status != nil && *status == 401) || includesAny(text, authNeedles) {
		return "auth"
	}
	if (status != nil && *status == 404) || includesAny(text, invalidModel) {
		return "invalid-model"
	}
	if includesAny(text, overflowNeedles) {
		return "overflow"
	}
	if (status != nil && *status == 402) || quota402.MatchString(text) || includesAny(text, quotaNeedles) {
		return "quota"
	}
	if status != nil && (transientStatus[*status] || (*status >= 500 && *status <= 599)) || includesAny(text, transientNeedles) {
		return "transient"
	}
	for _, phrase := range safetyPhrases {
		if strings.Contains(text, phrase) {
			return "safety"
		}
	}
	return "other"
}

func parseStatus(text string) (int, bool) {
	if match := labeledStatus.FindStringSubmatch(text); match != nil {
		return atoi(match[1]), true
	}
	if match := bareStatus.FindStringSubmatch(text); match != nil {
		return atoi(match[1]), true
	}
	return 0, false
}

func atoi(text string) int {
	n := 0
	for _, r := range text {
		n = n*10 + int(r-'0')
	}
	return n
}

func includesAny(text string, needles []string) bool {
	lower := strings.ToLower(text)
	for _, needle := range needles {
		if strings.Contains(lower, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func isFailoverWorthy(class string) bool {
	return class == "quota" || class == "transient" || class == "safety"
}
