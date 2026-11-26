package ctx

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
)

func ParseJSONL(r io.Reader) []Record {
	out := []Record{}
	seen := map[string]bool{}
	scan := bufio.NewScanner(r)
	scan.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if line == "" {
			continue
		}
		sum := sha256.Sum256([]byte(line))
		hash := hex.EncodeToString(sum[:])
		var raw map[string]any
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		rec, ok := lineToJudgment(raw)
		if !ok {
			continue
		}
		if seen[hash] || seen[rec.ID] {
			continue
		}
		seen[hash] = true
		seen[rec.ID] = true
		out = append(out, rec)
	}
	return out
}

func lineToJudgment(raw map[string]any) (Record, bool) {
	id, _ := raw["id"].(string)
	kind, _ := raw["type"].(string)
	ts, _ := raw["ts"].(string)
	session, _ := raw["session"].(string)
	if id == "" || kind == "" || ts == "" || session == "" || !judgmentType(kind) {
		return Record{}, false
	}
	headline, _ := raw["headline"].(string)
	body, _ := raw["body"].(string)
	if headline == "" && body == "" {
		return Record{}, false
	}
	if headline == "" {
		if len(body) > 80 {
			headline = body[:80]
		} else {
			headline = body
		}
	}
	if body == "" {
		body = headline
	}
	var applies any
	if kind == "constraint" {
		parsed, ok := parseAppliesTo(raw["applies_to"])
		if !ok {
			return Record{}, false
		}
		applies = parsed
	}
	return Record{
		ID:         id,
		Type:       kind,
		TS:         ts,
		Session:    session,
		Headline:   headline,
		Body:       body,
		AppliesTo:  applies,
		Supersedes: parseIDList(raw["supersedes"]),
		Blocks:     parseIDList(raw["blocks"]),
		Asks:       parseIDList(raw["asks"]),
	}, true
}

func parseAppliesTo(value any) (any, bool) {
	if value == "all" {
		return "all", true
	}
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return nil, false
	}
	if len(items) == 1 && items[0] == "all" {
		return "all", true
	}
	ids := []string{}
	for _, item := range items {
		text, ok := item.(string)
		if !ok || text == "" {
			return nil, false
		}
		ids = append(ids, text)
	}
	return ids, true
}

func parseIDList(value any) []string {
	if text, ok := value.(string); ok && text != "" {
		return []string{text}
	}
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range items {
		text, ok := item.(string)
		if ok && text != "" {
			out = append(out, text)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
