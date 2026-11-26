package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

func main() {
	var input struct {
		Flag any     `json:"flag"`
		Env  *string `json:"env"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(parseIdleTimeoutMs(input.Flag, input.Env))
}

func parseIdleTimeoutMs(flag any, env *string) int {
	raw, ok := chosen(flag)
	if !ok {
		if env == nil {
			return 180000
		}
		raw = *env
	}
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return 180000
	}
	if trimmed == "0" || trimmed == "off" || trimmed == "false" {
		return 0
	}
	parsed, ok := jsNumber(trimmed)
	if !ok || parsed < 0 {
		return 180000
	}
	return int(math.Floor(parsed))
}

func chosen(flag any) (string, bool) {
	switch typed := flag.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return "", false
		}
		return typed, true
	case bool:
		if typed {
			return "true", true
		}
		return "false", true
	default:
		return "", false
	}
}

func jsNumber(text string) (float64, bool) {
	if len(text) > 2 && text[0] == '0' {
		base := 0
		switch text[1] {
		case 'x':
			base = 16
		case 'b':
			base = 2
		case 'o':
			base = 8
		}
		if base != 0 {
			n, err := strconv.ParseInt(text[2:], base, 64)
			if err != nil {
				return 0, false
			}
			return float64(n), true
		}
	}
	n, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}
