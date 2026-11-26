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
