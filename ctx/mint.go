package ctx

import (
	"crypto/rand"
	"strings"
	"time"
)

const (
	gateBodyTokens  = 3500
	gateBodyCount   = 20
	claimedSlotCS   = 1200
	claimedSlotGE   = 1500
	siblingReserve  = 200
)

type PutInput struct {
	Type       string
	Headline   string
	Body       string
	Directive  string
	AppliesTo  any
	Supersedes string
	Reason     string
	Asks       []string
	Conflicts  []string
	Session    string
	ID         string
	TS         string
}

type PutResult struct {
	OK       bool
	Error    string
	Conflict []string
	Record   Record
	GateGE   int
	GateCS   int
}

func Put(existing []Record, input PutInput, occupancy string, sibling int, claimed string) PutResult {
	headline := strings.TrimSpace(input.Headline)
	if headline == "" {
		return PutResult{Error: "headline required"}
	}
	if input.Type == "evidence" && input.Supersedes != "" {
		return PutResult{Error: "evidence cannot supersede"}
	}
	before := FoldLive(existing)
	if input.Supersedes != "" && input.Reason == "" {
		return PutResult{Error: "reason_class required"}
	}
	if input.Supersedes != "" {
		target, ok := before.ByID[input.Supersedes]
		if !ok || target.ID == "" {
			return PutResult{Error: "not_found"}
		}
		if !before.Live[input.Supersedes] {
			return PutResult{Error: "already_superseded"}
		}
	}
	for _, id := range input.Asks {
		rec, ok := before.ByID[id]
		if !ok || rec.Type != "question" || !before.Live[id] {
			return PutResult{Error: "asks not_found"}
		}
	}
	var applies any
	directive := strings.TrimSpace(input.Directive)
	if input.Type == "constraint" {
		if directive == "" {
			return PutResult{Error: "directive required"}
		}
		parsed, err := validateApplies(input.AppliesTo, before.Questions)
		if err != "" {
			return PutResult{Error: err}
		}
		applies = parsed
	}
	body := strings.TrimSpace(input.Body)
	if body == "" {
		if directive != "" {
			body = directive
		} else {
			body = headline
		}
	}
	if input.Type == "question" && textTokens(firstText(directive, body)) > slotCap(occupancy, sibling) {
		return PutResult{Error: "question_too_large"}
	}
	rec := Record{
		ID:         input.ID,
		Type:       input.Type,
		TS:         input.TS,
		Session:    input.Session,
		Headline:   headline,
		Body:       body,
		Directive:  directive,
		AppliesTo:  applies,
		Reason:     input.Reason,
		Supersedes: nil,
	}
	if rec.ID == "" {
		rec.ID = newID()
	}
	if rec.TS == "" {
		rec.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if input.Supersedes != "" {
		rec.Supersedes = []string{input.Supersedes}
	}
	if len(input.Asks) > 0 {
		rec.Asks = input.Asks
	}
	after := FoldLive(append(append([]Record{}, existing...), rec))
	ge, cs := gateFlags(after, claimed)
	if rec.Type == "constraint" {
		norm := normalize(rec.Headline)
		conflicts := []string{}
		for _, c := range after.Constraints {
			if c.ID == rec.ID {
				continue
			}
			if normalize(c.Headline) == norm {
				conflicts = append(conflicts, c.ID)
			}
		}
		for _, id := range input.Conflicts {
			if id != rec.ID && !contains(conflicts, id) {
				conflicts = append(conflicts, id)
			}
		}
		if len(conflicts) > 0 {
			return PutResult{Error: "live_conflict", Conflict: conflicts, GateGE: ge, GateCS: cs}
		}
		would := ge
		if occupancy == "claim-strip" {
			would = cs
		}
		if would == 1 {
			return PutResult{Error: "gate", GateGE: ge, GateCS: cs}
		}
	}
	return PutResult{OK: true, Record: rec, GateGE: ge, GateCS: cs}
}

func validateApplies(value any, questions []Record) (any, string) {
	if value == nil {
		return nil, "applies_to required"
	}
	parsed, ok := parseAppliesTo(value)
	if !ok {
		if items, isList := value.([]any); isList && len(items) == 0 {
			return nil, "applies_to empty refuses"
		}
		if items, isList := value.([]string); isList && len(items) == 0 {
			return nil, "applies_to empty refuses"
		}
		return nil, "applies_to required"
	}
	if parsed == "all" {
		return "all", ""
	}
	ids := parsed.([]string)
	live := map[string]bool{}
	for _, q := range questions {
		live[q.ID] = true
	}
	for _, id := range ids {
		if !live[id] {
			return nil, "applies_to dangling"
		}
	}
	return ids, ""
}

func gateFlags(live Live, claimed string) (int, int) {
	return gateOf(live.Constraints), gateOf(bodySetCS(live, claimed))
}

func bodySetCS(live Live, claimed string) []Record {
	out := []Record{}
	for _, c := range live.Constraints {
		if c.AppliesTo == "all" {
			out = append(out, c)
			continue
		}
		ids, ok := c.AppliesTo.([]string)
		if ok && claimed != "" && contains(ids, claimed) {
			out = append(out, c)
		}
	}
	return out
}

func gateOf(records []Record) int {
	tokens := 0
	for _, rec := range records {
		tokens += textTokens(firstText(rec.Directive, rec.Body))
	}
	if len(records) > gateBodyCount || tokens > gateBodyTokens {
		return 1
	}
	return 0
}

func textTokens(text string) int {
	if text == "" {
		return 0
	}
	return (len(text) + 3) / 4
}

func slotCap(occupancy string, sibling int) int {
	if occupancy == "claim-strip" {
		return claimedSlotCS
	}
	if sibling == 0 {
		return claimedSlotGE
	}
	return claimedSlotGE - siblingReserve
}

func firstText(directive, body string) string {
	if directive != "" {
		return directive
	}
	return body
}

func normalize(headline string) string {
	var b strings.Builder
	lastSpace := true
	for _, r := range strings.ToLower(headline) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastSpace = false
			continue
		}
		if !lastSpace {
			b.WriteByte(' ')
			lastSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

func contains(ids []string, id string) bool {
	for _, item := range ids {
		if item == id {
			return true
		}
	}
	return false
}

func newID() string {
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	const hex = "0123456789abcdef"
	out := make([]byte, 36)
	n := 0
	for i, b := range raw {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out[n] = '-'
			n++
		}
		out[n] = hex[b>>4]
		out[n+1] = hex[b&0x0f]
		n += 2
	}
	return string(out)
}
