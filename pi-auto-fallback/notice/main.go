package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

type event struct {
	Type      string   `json:"type"`
	From      string   `json:"from"`
	To        string   `json:"to"`
	Reason    string   `json:"reason"`
	Budget    *float64 `json:"budget"`
	Metric    *string  `json:"metric"`
	Value     *float64 `json:"value"`
	Threshold *float64 `json:"threshold"`
	Model     *string  `json:"model"`
	Detail    *string  `json:"detail"`
}

func main() {
	var input event
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	text, level, ok := notice(input)
	if !ok {
		fmt.Println("null")
		return
	}
	raw, err := json.Marshal(map[string]string{"text": text, "level": level})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(raw))
}

func notice(input event) (string, string, bool) {
	switch input.Type {
	case "failover":
		return fmt.Sprintf("failover %s -> %s reason=%s budget=%s", input.From, input.To, input.Reason, num(input.Budget)), "warning", true
	case "usage-switch":
		return fmt.Sprintf("usage %s %s >= %s %s -> %s", str(input.Metric), num(input.Value), num(input.Threshold), input.From, input.To), "warning", true
	case "usage-return":
		detail := ""
		if input.Metric != nil && input.Value != nil && input.Threshold != nil {
			detail = fmt.Sprintf(" %s %s threshold=%s", *input.Metric, num(input.Value), num(input.Threshold))
		}
		return fmt.Sprintf("usage return %s -> %s%s", input.From, input.To, detail), "info", true
	case "usage-skip":
		if input.Reason != "unavailable" && input.Reason != "no-target" && input.Reason != "not-in-chain" {
			return "", "", false
		}
		model := "model"
		if input.Model != nil && *input.Model != "" {
			model = *input.Model
		}
		extra := ""
		if input.Detail != nil && *input.Detail != "" {
			extra = ": " + *input.Detail
		}
		return fmt.Sprintf("usage check %s for %s%s", input.Reason, model, extra), "warning", true
	default:
		return "", "", false
	}
}

func num(value *float64) string {
	if value == nil {
		return "undefined"
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}

func str(value *string) string {
	if value == nil {
		return "undefined"
	}
	return *value
}
