package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type usageGate struct {
	Models    *[]string `json:"models"`
	Provider  *string   `json:"provider"`
	Metric    string    `json:"metric"`
	Threshold float64   `json:"threshold"`
}

func reportedUsage(metric string, value float64, present bool) (float64, bool) {
	if !present || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	if metric == "percent" {
		if value < 0 || value > 100.5 {
			return 0, false
		}
		rounded := math.Round(math.Min(100, value))
		return rounded, true
	}
	if value < 0 {
		return 0, false
	}
	return value, true
}

func thresholdCrossed(gate usageGate, value float64, present bool) bool {
	reported, ok := reportedUsage(gate.Metric, value, present)
	if !ok {
		return false
	}
	return reported >= gate.Threshold
}

func usageRecovered(gate usageGate, value float64, present bool) bool {
	reported, ok := reportedUsage(gate.Metric, value, present)
	if !ok {
		return false
	}
	if gate.Metric == "percent" {
		return reported <= gate.Threshold-20
	}
	return reported < gate.Threshold
}

func matchingGate(gates []usageGate, model string) int {
	slash := stringsIndex(model)
	if slash <= 0 || slash >= len(model)-1 {
		return -1
	}
	provider := model[:slash]
	for i, gate := range gates {
		modelMatch := gate.Models == nil || contains(*gate.Models, model)
		providerMatch := gate.Provider == nil || *gate.Provider == provider
		if modelMatch && providerMatch && (gate.Models != nil || gate.Provider != nil) {
			return i
		}
	}
	return -1
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func readJsonNumber(payload json.RawMessage, path string) (float64, bool) {
	if path == "" || strings.HasPrefix(path, ".") || strings.HasSuffix(path, ".") || strings.Contains(path, "..") {
		return 0, false
	}
	var current any
	if err := json.Unmarshal(payload, &current); err != nil {
		return 0, false
	}
	for _, part := range strings.Split(path, ".") {
		if part == "" {
			return 0, false
		}
		object, ok := current.(map[string]any)
		if !ok {
			return 0, false
		}
		next, ok := object[part]
		if !ok {
			return 0, false
		}
		current = next
	}
	number, ok := current.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
		return 0, false
	}
	return number, true
}

func httpsURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Host == "" {
		return false
	}
	if parsed.User != nil {
		return false
	}
	return true
}

var envName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func isEnvName(value string) bool {
	return envName.MatchString(value)
}

type usageRequest struct {
	Op      string          `json:"op"`
	Metric  string          `json:"metric"`
	Value   *float64        `json:"value"`
	Gate    usageGate       `json:"gate"`
	Gates   []usageGate     `json:"gates"`
	Model   string          `json:"model"`
	Payload json.RawMessage `json:"payload"`
	Path    string          `json:"path"`
	URL     string          `json:"url"`
	Name    string          `json:"name"`
}

func runUsage(request usageRequest) string {
	present := request.Value != nil && !math.IsNaN(*request.Value) && !math.IsInf(*request.Value, 0)
	value := 0.0
	if present {
		value = *request.Value
	}
	switch request.Op {
	case "reported":
		n, ok := reportedUsage(request.Metric, value, present)
		if !ok {
			return "null"
		}
		return trimFloat(n)
	case "threshold":
		return fmtBool(thresholdCrossed(request.Gate, value, present))
	case "recovered":
		return fmtBool(usageRecovered(request.Gate, value, present))
	case "match":
		return fmt.Sprint(matchingGate(request.Gates, request.Model))
	case "json":
		n, ok := readJsonNumber(request.Payload, request.Path)
		if !ok {
			return "null"
		}
		return trimFloat(n)
	case "https":
		return fmtBool(httpsURL(request.URL))
	case "env":
		return fmtBool(isEnvName(request.Name))
	default:
		return "null"
	}
}

func fmtBool(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func trimFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
