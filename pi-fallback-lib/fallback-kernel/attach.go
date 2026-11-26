package main

func currentKey(provider, id string) (string, bool) {
	if provider == "" || id == "" {
		return "", false
	}
	return provider + "/" + id, true
}

func assistantEntryID(event any) (string, bool) {
	record, _ := event.(map[string]any)
	context, _ := record["context"].(map[string]any)
	entries, ok := context["contextEntries"].([]any)
	if !ok {
		return "", false
	}
	for i := len(entries) - 1; i >= 0; i-- {
		row, ok := entries[i].(map[string]any)
		if !ok {
			continue
		}
		source, ok := row["sourceEntry"].(map[string]any)
		if !ok {
			continue
		}
		if source["type"] != "message" {
			continue
		}
		message, _ := source["message"].(map[string]any)
		if message["role"] != "assistant" {
			continue
		}
		id, _ := source["id"].(string)
		if id != "" {
			return id, true
		}
	}
	return "", false
}

func modelFromEvent(value any) (string, string, bool) {
	record, ok := value.(map[string]any)
	if !ok {
		return "", "", false
	}
	provider, _ := record["provider"].(string)
	id, _ := record["id"].(string)
	if provider == "" || id == "" {
		return "", "", false
	}
	return provider, id, true
}

func refusalCategory(event any) (string, bool) {
	record, _ := event.(map[string]any)
	data, ok := record["data"].(map[string]any)
	if !ok || data["type"] != "message_delta" {
		return "", false
	}
	delta, ok := data["delta"].(map[string]any)
	if !ok {
		return "", false
	}
	details, ok := delta["stop_details"].(map[string]any)
	if !ok {
		return "", false
	}
	category, _ := details["category"].(string)
	if category == "" {
		return "", false
	}
	return category, true
}

func resumeInPlace(entry any) bool {
	record, ok := entry.(map[string]any)
	if !ok {
		return false
	}
	details, ok := record["details"].(map[string]any)
	if !ok {
		return false
	}
	return details["resumeInPlace"] == true
}

func newestCompaction(branch []any, fallback any) any {
	for i := len(branch) - 1; i >= 0; i-- {
		row, _ := branch[i].(map[string]any)
		if row["type"] == "compaction" {
			return branch[i]
		}
	}
	return fallback
}
