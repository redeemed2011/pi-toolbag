package ctx

type Record struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	TS         string   `json:"ts"`
	Session    string   `json:"session"`
	Headline   string   `json:"headline"`
	Body       string   `json:"body"`
	AppliesTo  any      `json:"applies_to,omitempty"`
	Supersedes []string `json:"supersedes,omitempty"`
	Blocks     []string `json:"blocks,omitempty"`
	Asks       []string `json:"asks,omitempty"`
}

func judgmentType(value string) bool {
	switch value {
	case "constraint", "decision", "question", "fog", "destination", "out_of_scope",
		"finding", "tombstone", "citation", "evidence", "pending_replace":
		return true
	default:
		return false
	}
}
