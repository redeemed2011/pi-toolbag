package main

import (
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
