package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: fallback-kernel classify|decide|extract|usage|parse|weekly|account")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "weekly":
		var request struct {
			Parsed    map[string]any `json:"parsed"`
			AccountID string         `json:"accountId"`
			Now       float64        `json:"now"`
		}
		if decode(&request) {
			return
		}
		if percent, ok := freshWeekly(request.Parsed, request.AccountID, request.Now); ok {
			fmt.Println(trimFloat(percent))
		} else {
			fmt.Println("null")
		}
	case "attach":
		var request struct {
			Op       string `json:"op"`
			Provider string `json:"provider"`
			ID       string `json:"id"`
			Event    any    `json:"event"`
			Value    any    `json:"value"`
			Entry    any    `json:"entry"`
			Branch   []any  `json:"branch"`
			Fallback any    `json:"fallback"`
		}
		if decode(&request) {
			return
		}
		switch request.Op {
		case "current":
			if key, ok := currentKey(request.Provider, request.ID); ok {
				fmt.Println(key)
			} else {
				fmt.Println("null")
			}
		case "entry":
			if id, ok := assistantEntryID(request.Event); ok {
				fmt.Println(id)
			} else {
				fmt.Println("null")
			}
		case "model":
			if provider, id, ok := modelFromEvent(request.Value); ok {
				raw, _ := json.Marshal(map[string]string{"provider": provider, "id": id})
				fmt.Println(string(raw))
			} else {
				fmt.Println("null")
			}
		case "refusal":
			if category, ok := refusalCategory(request.Event); ok {
				fmt.Println(category)
			} else {
				fmt.Println("null")
			}
		case "resume":
			fmt.Println(fmtBool(resumeInPlace(request.Entry)))
		case "compaction":
			raw, err := json.Marshal(newestCompaction(request.Branch, request.Fallback))
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			fmt.Println(string(raw))
		default:
			fmt.Println("null")
		}
	case "vault":
		var parsed any
		if decode(&parsed) {
			return
		}
		if vault, ok := readVault(parsed); ok {
			raw, err := json.Marshal(vault)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			fmt.Println(string(raw))
		} else {
			fmt.Println("null")
		}
	case "base":
		var request struct {
			Credential string `json:"credential"`
			Pi         string `json:"pi"`
			Grok       string `json:"grok"`
		}
		if decode(&request) {
			return
		}
		if root, ok := baseURL(request.Credential, request.Pi, request.Grok); ok {
			fmt.Println(root)
		} else {
			fmt.Println("null")
		}
	case "account":
		var request struct {
			Accounts []vaultAccount `json:"accounts"`
			Active   string         `json:"active"`
			Session  string         `json:"session"`
		}
		if decode(&request) {
			return
		}
		fmt.Println(selectAccount(request.Accounts, request.Active, request.Session))
	case "reading":
		var reading struct {
			OK      bool `json:"ok"`
			Crossed bool `json:"crossed"`
			InChain bool `json:"inChain"`
		}
		if decode(&reading) {
			return
		}
		fmt.Println(usageReading(reading.OK, reading.Crossed, reading.InChain))
	case "candidate":
		var candidate struct {
			SameOrHeld bool `json:"sameOrHeld"`
			HasGate    bool `json:"hasGate"`
			ReadingOK  bool `json:"readingOK"`
			Crossed    bool `json:"crossed"`
		}
		if decode(&candidate) {
			return
		}
		fmt.Println(usageCandidate(candidate.SameOrHeld, candidate.HasGate, candidate.ReadingOK, candidate.Crossed))
	case "compact":
		var request struct {
			Op         string `json:"op"`
			Enabled    bool   `json:"enabled"`
			Reason     string `json:"reason"`
			WillRetry  bool   `json:"willRetry"`
			Resume     bool   `json:"resume"`
			CheckUsage bool   `json:"checkUsage"`
			Held       bool   `json:"held"`
			Blocked    bool   `json:"blocked"`
		}
		if decode(&request) {
			return
		}
		switch request.Op {
		case "resume":
			fmt.Println(compactResume(request.Reason, request.Resume))
		case "switch":
			fmt.Println(compactSwitch(request.CheckUsage, request.Held, request.Blocked))
		default:
			fmt.Println(compactStart(request.Enabled, request.Reason, request.WillRetry))
		}
	case "before":
		var request struct {
			MessageType string `json:"messageType"`
			CheckUsage  bool   `json:"checkUsage"`
			Enabled     bool   `json:"enabled"`
			InFlight    bool   `json:"inFlight"`
			HasCurrent  bool   `json:"hasCurrent"`
		}
		if decode(&request) {
			return
		}
		fmt.Println(beforeAgent(request.MessageType, request.CheckUsage, request.Enabled, request.InFlight, request.HasCurrent))
	case "select":
		var picked struct {
			Key          string `json:"key"`
			Source       string `json:"source"`
			Ignore       string `json:"ignore"`
			HasPreferred bool   `json:"hasPreferred"`
		}
		if decode(&picked) {
			return
		}
		raw, err := json.Marshal(modelSelect(picked.Key, picked.Source, picked.Ignore, picked.HasPreferred))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "model-switch":
		var request struct {
			Parsed     bool `json:"parsed"`
			Found      bool `json:"found"`
			Called     bool `json:"called"`
			SetOK      bool `json:"setOK"`
			Threw      bool `json:"threw"`
			SameIgnore bool `json:"sameIgnore"`
		}
		if decode(&request) {
			return
		}
		raw, err := json.Marshal(modelSwitch(request.Parsed, request.Found, request.Called, request.SetOK, request.Threw, request.SameIgnore))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "session":
		var branch []any
		if decode(&branch) {
			return
		}
		if id, ok := sessionAccountID(branch); ok {
			fmt.Println(id)
		} else {
			fmt.Println("null")
		}
	case "preferred":
		var request struct {
			HasPreferred bool `json:"hasPreferred"`
			HasGates     bool `json:"hasGates"`
			HasGate      bool `json:"hasGate"`
			ReadingOK    bool `json:"readingOK"`
			Recovered    bool `json:"recovered"`
		}
		if decode(&request) {
			return
		}
		fmt.Println(preferredKind(request.HasPreferred, request.HasGates, request.HasGate, request.ReadingOK, request.Recovered))
	case "bound":
		var lengths struct {
			Lengths []int `json:"lengths"`
		}
		if decode(&lengths) {
			return
		}
		fmt.Println(chainBound(lengths.Lengths))
	case "switch":
		var request struct {
			Kind   string  `json:"kind"`
			Budget float64 `json:"budget"`
		}
		if decode(&request) {
			return
		}
		raw, err := json.Marshal(switchBook(request.Kind, request.Budget))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "settle":
		var request settleInput
		if decode(&request) {
			return
		}
		raw, err := json.Marshal(settleGate(request))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "after":
		var request struct {
			OK            bool `json:"ok"`
			HasValue      bool `json:"hasValue"`
			RequireUsable bool `json:"requireUsable"`
			Usable        bool `json:"usable"`
		}
		if decode(&request) {
			return
		}
		fmt.Println(afterLive(request.OK, request.HasValue, request.RequireUsable, request.Usable))
	case "token":
		var request struct {
			Expires float64 `json:"expires"`
			Now     float64 `json:"now"`
			Cached  bool    `json:"cached"`
		}
		if decode(&request) {
			return
		}
		fmt.Println(tokenChoice(request.Expires, request.Now, request.Cached))
	case "headers":
		var request struct {
			Kind  string `json:"kind"`
			Auth  string `json:"auth"`
			Name  string `json:"name"`
			Token string `json:"token"`
		}
		if decode(&request) {
			return
		}
		var headers map[string]string
		reason := ""
		if request.Kind == "grok" {
			headers = grokHeaders(request.Token)
		} else {
			headers, reason = httpHeaders(request.Auth, request.Name, request.Token)
		}
		raw, err := json.Marshal(map[string]any{"headers": headers, "reason": reason})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "chain":
		var request struct {
			Config  fallbackConfig `json:"config"`
			Current string         `json:"current"`
		}
		if decode(&request) {
			return
		}
		if chain := findChain(request.Config, request.Current); chain != nil {
			raw, err := json.Marshal(chain)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			fmt.Println(string(raw))
		} else {
			fmt.Println("null")
		}
	case "split":
		var request struct {
			Key string `json:"key"`
		}
		if decode(&request) {
			return
		}
		if provider, id, ok := splitModelKey(request.Key); ok {
			raw, err := json.Marshal(map[string]string{"provider": provider, "id": id})
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			fmt.Println(string(raw))
		} else {
			fmt.Println("null")
		}
	case "parse":
		var value any
		if decode(&value) {
			return
		}
		raw, err := json.Marshal(parseFallbackConfig(value))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "usage":
		var request usageRequest
		if decode(&request) {
			return
		}
		fmt.Println(runUsage(request))
	case "extract":
		var branch []branchEntry
		if decode(&branch) {
			return
		}
		raw, err := json.Marshal(extractLastAssistantError(branch))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	case "classify":
		var err failoverError
		if decode(&err) {
			return
		}
		fmt.Println(classifyError(err))
	case "decide":
		var input decideInput
		if decode(&input) {
			return
		}
		raw, err := json.Marshal(decideFailover(input))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	default:
		fmt.Fprintln(os.Stderr, "usage: fallback-kernel classify|decide|extract|usage|parse|weekly|account")
		os.Exit(2)
	}
}

func decode(dest any) bool {
	if err := json.NewDecoder(os.Stdin).Decode(dest); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
		return true
	}
	return false
}
