package ctx

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"
)

func AppendRecord(path string, rec Record) error {
	if err := os.MkdirAll(dirOf(path), 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(raw, '\n'))
	return err
}

func ReadLog(path string) ([]Record, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()
	return ParseJSONL(file), nil
}

func MintFile(path string, input PutInput, occupancy string, sibling int, claimed string) (PutResult, error) {
	existing, err := ReadLog(path)
	if err != nil {
		return PutResult{}, err
	}
	result := Put(existing, input, occupancy, sibling, claimed)
	if !result.OK {
		return result, nil
	}
	if err := AppendRecord(path, result.Record); err != nil {
		return PutResult{}, err
	}
	return result, nil
}

func dirOf(path string) string {
	if i := strings.LastIndex(path, "/"); i > 0 {
		return path[:i]
	}
	return "."
}

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
	if texts, ok := value.([]string); ok {
		items := make([]any, len(texts))
		for i, text := range texts {
			items[i] = text
		}
		value = items
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
