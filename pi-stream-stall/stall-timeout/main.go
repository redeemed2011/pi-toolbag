package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

func main() {
	var input struct {
		Flag      any             `json:"flag"`
		Env       *string         `json:"env"`
		Provider  string          `json:"provider"`
		ID        string          `json:"id"`
		API       string          `json:"api"`
		IdleMs    int             `json:"idleMs"`
		Timestamp int64           `json:"timestamp"`
		Partial   json.RawMessage `json:"partial"`
		Event     map[string]any  `json:"event"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(os.Args) == 2 && os.Args[1] == "text" {
		fmt.Printf("Provider stream timeout (%s/%s): no data for %dms\n", input.Provider, input.ID, input.IdleMs)
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "message" {
		raw, err := json.Marshal(timeoutMessage(input.API, input.Provider, input.ID, input.IdleMs, input.Timestamp, input.Partial))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "partial" {
		raw, err := json.Marshal(partialFrom(input.Event))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
		return
	}
	fmt.Println(parseIdleTimeoutMs(input.Flag, input.Env))
}

func timeoutMessage(api, provider, id string, idleMs int, timestamp int64, partial json.RawMessage) map[string]any {
	text := fmt.Sprintf("Provider stream timeout (%s/%s): no data for %dms", provider, id, idleMs)
	if len(partial) > 0 && string(partial) != "null" {
		var message map[string]any
		if err := json.Unmarshal(partial, &message); err == nil && message != nil {
			message["stopReason"] = "error"
			message["errorMessage"] = text
			message["timestamp"] = timestamp
			return message
		}
	}
	return map[string]any{
		"role":         "assistant",
		"content":      []any{},
		"api":          api,
		"provider":     provider,
		"model":        id,
		"usage":        zeroUsage(),
		"stopReason":   "error",
		"errorMessage": text,
		"timestamp":    timestamp,
	}
}

func zeroUsage() map[string]any {
	return map[string]any{
		"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
		"cost": map[string]any{"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0},
	}
}

func partialFrom(event map[string]any) any {
	switch event["type"] {
	case "error":
		return event["error"]
	case "done":
		return event["message"]
	default:
		if partial, ok := event["partial"]; ok {
			return partial
		}
		return nil
	}
}

func parseIdleTimeoutMs(flag any, env *string) int {
	raw, ok := chosen(flag)
	if !ok {
		if env == nil {
			return 180000
		}
		raw = *env
	}
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return 180000
	}
	if trimmed == "0" || trimmed == "off" || trimmed == "false" {
		return 0
	}
	parsed, ok := jsNumber(trimmed)
	if !ok || parsed < 0 {
		return 180000
	}
	return int(math.Floor(parsed))
}

func chosen(flag any) (string, bool) {
	switch typed := flag.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return "", false
		}
		return typed, true
	case bool:
		if typed {
			return "true", true
		}
		return "false", true
	default:
		return "", false
	}
}

func jsNumber(text string) (float64, bool) {
	if len(text) > 2 && text[0] == '0' {
		base := 0
		switch text[1] {
		case 'x':
			base = 16
		case 'b':
			base = 2
		case 'o':
			base = 8
		}
		if base != 0 {
			n, err := strconv.ParseInt(text[2:], base, 64)
			if err != nil {
				return 0, false
			}
			return float64(n), true
		}
	}
	n, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}
