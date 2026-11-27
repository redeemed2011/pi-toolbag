package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
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
	if len(os.Args) == 2 && os.Args[1] == "bind" {
		var request struct {
			Phase           string `json:"phase"`
			HasRegistration bool   `json:"hasRegistration"`
			SameSession     bool   `json:"sameSession"`
			HasSession      bool   `json:"hasSession"`
			HasAPI          bool   `json:"hasAPI"`
		}
		if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(childBind(request.Phase, request.HasRegistration, request.SameSession, request.HasSession, request.HasAPI))
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "warn" {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(childWarning(string(raw)))
		return
	}
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

func childBind(phase string, hasRegistration, sameSession, hasSession, hasAPI bool) string {
	if phase == "before" {
		if hasRegistration && sameSession {
			return "keep"
		}
		if !hasSession {
			return "skip"
		}
		return "load"
	}
	if !hasAPI {
		return "skip"
	}
	if !sameSession {
		return "replace"
	}
	return "register"
}

func childWarning(message string) string {
	if strings.Contains(message, "already registered") {
		return "pi-auto-fallback: child sessions will not fail over; another extension already registered required child extensions"
	}
	return "pi-auto-fallback: child sessions will not fail over; " + message
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
