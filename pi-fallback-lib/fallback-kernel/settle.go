package main

type settleInput struct {
	Enabled         bool   `json:"enabled"`
	InFlight        bool   `json:"inFlight"`
	Mode            string `json:"mode"`
	Idle            bool   `json:"idle"`
	HasError        bool   `json:"hasError"`
	Classification  string `json:"classification"`
	Worthy          bool   `json:"worthy"`
	RetryAfterTools bool   `json:"retryAfterTools"`
	ToolsThisTurn   bool   `json:"toolsThisTurn"`
	Virtual         string `json:"virtual"`
	Physical        string `json:"physical"`
	ReplayTarget    string `json:"replayTarget"`
}

func settleGate(input settleInput) map[string]any {
	if !input.Enabled || input.InFlight {
		return map[string]any{"action": "return", "clearTools": false}
	}
	if input.Mode == "safety" && !input.Idle {
		return skip("not-idle", "", false)
	}
	if !input.HasError {
		return map[string]any{"action": "return", "clearTools": input.Mode == "safety"}
	}
	if !input.Worthy {
		if input.Mode == "safety" {
			return skip("not-failover-worthy", input.Classification, true)
		}
		return map[string]any{"action": "return", "clearTools": false}
	}
	if input.Mode != "replay" {
		return map[string]any{"action": "return", "clearTools": false}
	}
	if !input.RetryAfterTools && input.ToolsThisTurn {
		return skip("tools-already-started", "", true)
	}
	current := input.Physical
	if current == "" {
		current = input.Virtual
	}
	if current == "" {
		return skip("no-current-model", "", true)
	}
	preferred := input.Virtual
	if preferred == "" {
		preferred = current
	}
	if input.ReplayTarget == "" {
		return skip("no-assistant-entry", "", true)
	}
	return map[string]any{
		"action":       "continue",
		"clearTools":   false,
		"current":      current,
		"preferred":    preferred,
		"replayTarget": input.ReplayTarget,
	}
}

func sessionAccountID(branch []any) (string, bool) {
	for i := len(branch) - 1; i >= 0; i-- {
		row, ok := branch[i].(map[string]any)
		if !ok || row["type"] != "custom" || row["customType"] != "grok-cli-active-account-v1" {
			continue
		}
		data, ok := row["data"].(map[string]any)
		if !ok {
			continue
		}
		id, _ := data["accountId"].(string)
		if id != "" {
			return id, true
		}
	}
	return "", false
}

func preferredKind(hasPreferred, hasGates, hasGate, readingOK, recovered bool) string {
	if !hasPreferred || !hasGates || !hasGate {
		return "ungated"
	}
	if !readingOK {
		return "unavailable"
	}
	if !recovered {
		return "usage-held"
	}
	return "recovered"
}

func chainBound(lengths []int) int {
	bound := 1
	for _, length := range lengths {
		if length > bound {
			bound = length
		}
	}
	return bound
}

func switchBook(kind string, budget float64) map[string]any {
	switch kind {
	case "none":
		return map[string]any{"action": "stop", "clearTools": true}
	case "missing":
		return map[string]any{"action": "skip", "reason": "not-in-registry", "remember": true}
	case "rejected":
		return map[string]any{"action": "skip", "remember": true}
	case "replay":
		return map[string]any{"action": "replay", "budget": budget - 1, "clearTools": true}
	default:
		return map[string]any{"action": "continue"}
	}
}

func skip(reason, classification string, clear bool) map[string]any {
	out := map[string]any{"action": "skip", "reason": reason, "clearTools": clear}
	if classification != "" {
		out["classification"] = classification
	}
	return out
}
