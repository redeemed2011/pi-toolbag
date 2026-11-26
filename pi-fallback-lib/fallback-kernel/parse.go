package main

import "math"

func parseFallbackConfig(value any) map[string]any {
	object, ok := asObject(value)
	if !ok {
		return fail("not-object")
	}
	if _, present := object["enabled"]; present {
		if _, ok := object["enabled"].(bool); !ok {
			return fail("not-object")
		}
	}
	enabled := true
	if flag, ok := object["enabled"].(bool); ok {
		enabled = flag
	}
	budget, ok := parseBudget(object["maxFailoversPerRequest"], has(object, "maxFailoversPerRequest"))
	if !ok {
		return fail("invalid-budget")
	}
	chains, reason, ok := parseChains(object["chains"], has(object, "chains"), enabled)
	if !ok {
		return fail(reason)
	}
	gates, reason, ok := parseUsageGates(object["usageGates"], has(object, "usageGates"))
	if !ok {
		return fail(reason)
	}
	config := map[string]any{
		"enabled":                 enabled,
		"chains":                  chains,
		"maxFailoversPerRequest": budget,
	}
	if gates != nil {
		config["usageGates"] = gates
	}
	return map[string]any{"ok": true, "config": config}
}

func fail(reason string) map[string]any {
	return map[string]any{"ok": false, "reason": reason}
}

func has(object map[string]any, key string) bool {
	_, ok := object[key]
	return ok
}

func asObject(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	return object, ok
}

func parseBudget(raw any, present bool) (int, bool) {
	if !present {
		return 1, true
	}
	number, ok := raw.(float64)
	if !ok || math.Trunc(number) != number || number < 0 || number > 20 {
		return 0, false
	}
	return int(number), true
}

func parseChains(raw any, present, requireNonEmpty bool) ([]any, string, bool) {
	if !present || raw == nil {
		if requireNonEmpty {
			return nil, "no-chains", false
		}
		return []any{}, "", true
	}
	items, ok := raw.([]any)
	if !ok || (requireNonEmpty && len(items) == 0) {
		return nil, "no-chains", false
	}
	chains := []any{}
	names := map[string]bool{}
	keys := map[string]bool{}
	for index, item := range items {
		object, ok := asObject(item)
		if !ok {
			return nil, "invalid-chain", false
		}
		modelsRaw, ok := object["models"].([]any)
		if !ok || len(modelsRaw) < 2 {
			return nil, "invalid-chain", false
		}
		models := []string{}
		for _, model := range modelsRaw {
			key, ok := model.(string)
			if !ok || !validKey(key) {
				return nil, "invalid-model-key", false
			}
			if keys[key] {
				return nil, "duplicate-key", false
			}
			keys[key] = true
			models = append(models, key)
		}
		name := ""
		if !has(object, "name") || object["name"] == nil {
			name = "chain-" + itoa(index)
		} else if text, ok := object["name"].(string); ok && text != "" {
			name = text
		} else {
			return nil, "invalid-chain", false
		}
		if names[name] {
			return nil, "invalid-chain", false
		}
		names[name] = true
		chains = append(chains, map[string]any{"name": name, "models": models})
	}
	return chains, "", true
}

func parseUsageGates(raw any, present bool) ([]any, string, bool) {
	if !present {
		return nil, "", true
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, "invalid-usage-gate", false
	}
	gates := []any{}
	for _, item := range items {
		object, ok := asObject(item)
		if !ok {
			return nil, "invalid-usage-gate", false
		}
		metric, _ := object["metric"].(string)
		if metric != "percent" && metric != "tokens" {
			return nil, "invalid-usage-gate", false
		}
		threshold, ok := object["threshold"].(float64)
		if !ok || math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || (metric == "percent" && threshold > 100) {
			return nil, "invalid-usage-gate", false
		}
		var models []string
		if has(object, "models") {
			list, ok := object["models"].([]any)
			if !ok || len(list) == 0 {
				return nil, "invalid-usage-gate", false
			}
			for _, model := range list {
				key, ok := model.(string)
				if !ok || !validKey(key) {
					return nil, "invalid-usage-gate", false
				}
				models = append(models, key)
			}
		}
		provider := ""
		if has(object, "provider") {
			text, ok := object["provider"].(string)
			if !ok || text == "" || stringsContains(text, "/") {
				return nil, "invalid-usage-gate", false
			}
			provider = text
		}
		if models == nil && provider == "" {
			return nil, "invalid-usage-gate", false
		}
		source, ok := parseUsageSource(object["source"], metric)
		if !ok {
			return nil, "invalid-usage-gate", false
		}
		gate := map[string]any{"metric": metric, "threshold": threshold, "source": source}
		if models != nil {
			gate["models"] = models
		}
		if provider != "" {
			gate["provider"] = provider
		}
		gates = append(gates, gate)
	}
	return gates, "", true
}

func parseUsageSource(raw any, metric string) (map[string]any, bool) {
	if raw == "grok-cli" {
		if metric != "percent" {
			return nil, false
		}
		return map[string]any{"kind": "grok-cli"}, true
	}
	object, ok := asObject(raw)
	if !ok {
		return nil, false
	}
	url, _ := object["url"].(string)
	path, _ := object["path"].(string)
	if !httpsURL(url) || !jsonPath(path) {
		return nil, false
	}
	auth, _ := object["auth"].(string)
	if auth == "bearer-env" {
		env, _ := object["env"].(string)
		if !isEnvName(env) {
			return nil, false
		}
		return map[string]any{"kind": "http", "url": url, "path": path, "auth": "bearer-env", "env": env}, true
	}
	if auth != "none" {
		return nil, false
	}
	return map[string]any{"kind": "http", "url": url, "path": path, "auth": "none"}, true
}

func jsonPath(path string) bool {
	if path == "" || stringsHasPrefix(path, ".") || stringsHasSuffix(path, ".") || stringsContains(path, "..") {
		return false
	}
	for _, part := range stringsSplit(path, ".") {
		if part == "" {
			return false
		}
	}
	return true
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

func stringsContains(text, part string) bool { return len(part) == 0 || indexOf(text, part) >= 0 }
func stringsHasPrefix(text, part string) bool { return len(text) >= len(part) && text[:len(part)] == part }
func stringsHasSuffix(text, part string) bool {
	return len(text) >= len(part) && text[len(text)-len(part):] == part
}
func stringsSplit(text, sep string) []string {
	out := []string{}
	for {
		at := indexOf(text, sep)
		if at < 0 {
			return append(out, text)
		}
		out = append(out, text[:at])
		text = text[at+len(sep):]
	}
}
func indexOf(text, part string) int {
	for i := 0; i+len(part) <= len(text); i++ {
		if text[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
