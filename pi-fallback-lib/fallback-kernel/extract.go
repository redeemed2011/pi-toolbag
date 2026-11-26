package main

type branchEntry struct {
	Type    string         `json:"type"`
	Message *branchMessage `json:"message"`
}

type branchMessage struct {
	Role          string `json:"role"`
	StopReason    string `json:"stopReason"`
	ErrorMessage  string `json:"errorMessage"`
	RawStopReason string `json:"rawStopReason"`
	Provider      string `json:"provider"`
	Model         string `json:"model"`
}

type extracted struct {
	Text          string `json:"text"`
	StopReason    string `json:"stopReason"`
	RawStopReason string `json:"rawStopReason,omitempty"`
	Provider      string `json:"provider,omitempty"`
	Model         string `json:"model,omitempty"`
}

func extractLastAssistantError(branch []branchEntry) *extracted {
	for i := len(branch) - 1; i >= 0; i-- {
		entry := branch[i]
		if entry.Type != "message" || entry.Message == nil || entry.Message.Role != "assistant" {
			continue
		}
		msg := entry.Message
		if msg.StopReason == "aborted" {
			return withModel(&extracted{Text: msg.ErrorMessage, StopReason: "aborted"}, msg)
		}
		if msg.StopReason != "error" {
			return nil
		}
		out := &extracted{Text: msg.ErrorMessage, StopReason: "error"}
		if msg.RawStopReason != "" {
			out.RawStopReason = msg.RawStopReason
		}
		return withModel(out, msg)
	}
	return nil
}

func withModel(out *extracted, msg *branchMessage) *extracted {
	if msg.Provider != "" && msg.Model != "" {
		out.Provider = msg.Provider
		out.Model = msg.Model
	}
	return out
}
