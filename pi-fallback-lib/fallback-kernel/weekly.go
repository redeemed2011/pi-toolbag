package main

import (
	"math"
	"strings"
	"time"
)

func freshWeekly(parsed map[string]any, accountID string, now float64) (float64, bool) {
	accounts, ok := parsed["accounts"].(map[string]any)
	if !ok {
		return 0, false
	}
	entry, ok := accounts[accountID].(map[string]any)
	if !ok {
		return 0, false
	}
	updatedText, _ := entry["updatedAt"].(string)
	updated, ok := parseTime(updatedText)
	if !ok || now-updated > 30*60_000 || updated > now+60_000 {
		return 0, false
	}
	weekly, ok := entry["weekly"].(map[string]any)
	if !ok {
		return 0, false
	}
	percent, ok := weekly["creditUsagePercent"].(float64)
	if !ok {
		return 0, false
	}
	endText, _ := weekly["billingPeriodEnd"].(string)
	end, ok := parseTime(endText)
	if !ok || end <= now {
		return 0, false
	}
	return percent, true
}

func parseTime(text string) (float64, bool) {
	if text == "" {
		return 0, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, text)
		if err != nil {
			return 0, false
		}
	}
	return float64(parsed.UnixMilli()), true
}

type vaultAccount struct {
	ID         string         `json:"id"`
	Credential map[string]any `json:"credential"`
}

const defaultGrokBase = "https://cli-chat-proxy.grok.com/v1"

func baseURL(credentialBase, piBase, grokBase string) (string, bool) {
	raw := credentialBase
	if raw == "" {
		raw = piBase
	}
	if raw == "" {
		raw = grokBase
	}
	if raw == "" {
		raw = defaultGrokBase
	}
	check := raw
	if strings.HasSuffix(raw, "/v1") || strings.Contains(raw, "://") {
		check = strings.TrimRight(raw, "/")
	}
	if !httpsURL(check) {
		return "", false
	}
	return strings.TrimRight(raw, "/"), true
}

func readVault(parsed any) (map[string]any, bool) {
	object, ok := parsed.(map[string]any)
	if !ok || object["version"] != float64(1) {
		return nil, false
	}
	items, ok := object["accounts"].([]any)
	if !ok {
		return nil, false
	}
	accounts := []any{}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := obj["id"].(string)
		if id == "" {
			continue
		}
		account := map[string]any{"id": id}
		if cred, ok := parseCredential(obj["credential"]); ok {
			account["credential"] = cred
		}
		accounts = append(accounts, account)
	}
	result := map[string]any{"accounts": accounts}
	if active, ok := object["activeAccountId"].(string); ok {
		result["activeAccountId"] = active
	}
	return result, true
}

func parseCredential(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	access, _ := object["access"].(string)
	if access == "" {
		return nil, false
	}
	expires, ok := object["expires"].(float64)
	if !ok || math.IsNaN(expires) || math.IsInf(expires, 0) {
		return nil, false
	}
	cred := map[string]any{"access": access, "expires": expires}
	if _, present := object["baseUrl"]; present {
		text, ok := object["baseUrl"].(string)
		if !ok {
			return nil, false
		}
		cred["baseUrl"] = text
	}
	return cred, true
}

func afterLive(ok, hasValue, requireUsable, usable bool) string {
	if ok {
		return "live"
	}
	if hasValue && (!requireUsable || usable) {
		return "cache"
	}
	return "live"
}

func tokenChoice(expires, now float64, cached bool) string {
	if expires > now {
		return "fetch"
	}
	if cached {
		return "cache"
	}
	return "token-expired"
}

func selectAccount(accounts []vaultAccount, active, session string) int {
	if session != "" {
		for i, account := range accounts {
			if account.ID == session && account.Credential != nil {
				return i
			}
		}
		return -1
	}
	first := -1
	for i, account := range accounts {
		if account.Credential == nil {
			continue
		}
		if first < 0 {
			first = i
		}
		if active != "" && account.ID == active {
			return i
		}
	}
	return first
}
