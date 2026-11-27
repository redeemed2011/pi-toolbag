package main

import (
	"encoding/json"
	"math/rand"
	"os/exec"
	"strings"
	"testing"
)

func TestMatchesJavaScript(t *testing.T) {
	classes := []string{
		`{"text":"","stopReason":"aborted"}`,
		`{"text":"quota exceeded"}`,
		`{"text":"status: 500"}`,
		`{"text":"HTTP 403 forbidden"}`,
		`{"text":"plain 403"}`,
		`{"text":"context window exceeded"}`,
		`{"text":"","status":401}`,
		`{"text":"model not found"}`,
		`{"text":"Output blocked by content filtering policy"}`,
		`{"text":"nothing here"}`,
		`{"text":"x","rawStopReason":"refusal","category":"reasoning_extraction"}`,
		`{"text":"x","rawStopReason":"SAFETY"}`,
		`{"text":"code 402 billing"}`,
	}
	for _, item := range classes {
		if classifyOf(t, item) != js(t, "classify", item) {
			t.Fatalf("classify %s go %s js %s", item, classifyOf(t, item), js(t, "classify", item))
		}
	}
	decides := []string{
		`{"config":{"enabled":false,"chains":[]},"current":"a/b","error":{"text":"quota"},"attempted":[],"remainingBudget":1}`,
		`{"config":{"enabled":true,"chains":[{"models":["a/b","c/d"]}]},"current":"a/b","error":{"text":"quota exceeded"},"attempted":[],"remainingBudget":1}`,
		`{"config":{"enabled":true,"chains":[{"models":["a/b","c/d"]}]},"current":"a/b","error":{"text":"quota exceeded"},"attempted":["c/d"],"remainingBudget":1,"blocked":["a/b"]}`,
		`{"config":{"enabled":true,"chains":[{"models":["a/b"]}]},"current":"a/b","error":{"text":"timeout"},"attempted":[],"remainingBudget":0}`,
		`{"config":{"enabled":true,"chains":[{"models":["a/b"]}]},"current":"nope","error":{"text":"timeout"},"attempted":[],"remainingBudget":1}`,
		`{"config":{"enabled":true,"chains":[{"models":["a/b"]}]},"current":"z/z","error":{"text":"timeout"},"attempted":[],"remainingBudget":1}`,
	}
	for _, item := range decides {
		got := decideOf(t, item)
		want := js(t, "decide", item)
		if got != want {
			t.Fatalf("decide %s\ngo %s\njs %s", item, got, want)
		}
	}
	extracts := []string{
		`[{"type":"message","message":{"role":"assistant","stopReason":"error","errorMessage":"quota","provider":"grok","model":"g"}}]`,
		`[{"type":"message","message":{"role":"assistant","stopReason":"stop","errorMessage":"no"}}]`,
		`[{"type":"message","message":{"role":"user","stopReason":"error"}},{"type":"message","message":{"role":"assistant","stopReason":"aborted","rawStopReason":"refusal","provider":"a"}}]`,
		`[]`,
	}
	for _, item := range extracts {
		got := extractOf(t, item)
		want := jsExtract(t, item)
		if got != want {
			t.Fatalf("extract %s\ngo %s\njs %s", item, got, want)
		}
	}
}

func TestFuzzMatchesJavaScript(t *testing.T) {
	rng := rand.New(rand.NewSource(99))
	texts := []string{
		"", "   ", "quota exceeded", "status: 500", "HTTP 403 forbidden", "plain 403",
		"context window exceeded", "model not found", "Output blocked by content filtering policy",
		"timeout", "rate limit", "code 402 billing", "error code: 503", "429 too many",
		"nothing matches here", "guardrail_blocked", "invalid api key", "status=404",
	}
	stopReasons := []string{"", "error", "aborted", "stop", "length"}
	rawStops := []string{"", "refusal", "SAFETY", "content_filter", "other"}
	categories := []string{"", "reasoning_extraction", "policy"}
	statuses := []int{0, 401, 402, 403, 404, 408, 429, 500, 502, 503}

	for i := 0; i < 100; i++ {
		payload := map[string]any{"text": texts[rng.Intn(len(texts))]}
		if s := stopReasons[rng.Intn(len(stopReasons))]; s != "" {
			payload["stopReason"] = s
		}
		if r := rawStops[rng.Intn(len(rawStops))]; r != "" {
			payload["rawStopReason"] = r
		}
		if c := categories[rng.Intn(len(categories))]; c != "" {
			payload["category"] = c
		}
		if st := statuses[rng.Intn(len(statuses))]; st != 0 {
			payload["status"] = st
		}
		raw, _ := json.Marshal(payload)
		got := classifyOf(t, string(raw))
		want := js(t, "classify", string(raw))
		if got != want {
			t.Fatalf("fuzz classify %d %s: go=%s js=%s", i, raw, got, want)
		}
	}

	models := []string{"a/b", "c/d", "e/f", "g/h", "invalid", "z/z"}
	for i := 0; i < 80; i++ {
		chain := []string{}
		for _, m := range []string{"a/b", "c/d", "e/f", "g/h"} {
			if rng.Intn(2) == 0 {
				chain = append(chain, m)
			}
		}
		attempted := []string{}
		blocked := []string{}
		for _, m := range []string{"a/b", "c/d", "e/f", "g/h"} {
			if rng.Intn(4) == 0 {
				attempted = append(attempted, m)
			}
			if rng.Intn(4) == 0 {
				blocked = append(blocked, m)
			}
		}
		errObj := map[string]any{"text": texts[rng.Intn(len(texts))]}
		if st := statuses[rng.Intn(len(statuses))]; st != 0 {
			errObj["status"] = st
		}
		payload := map[string]any{
			"config":          map[string]any{"enabled": rng.Intn(5) != 0, "chains": []any{map[string]any{"models": chain}}},
			"current":         models[rng.Intn(len(models))],
			"error":           errObj,
			"attempted":       attempted,
			"blocked":         blocked,
			"remainingBudget": rng.Intn(4),
		}
		raw, _ := json.Marshal(payload)
		got := decideOf(t, string(raw))
		want := js(t, "decide", string(raw))
		if got != want {
			t.Fatalf("fuzz decide %d %s\ngo %s\njs %s", i, raw, got, want)
		}
	}

	roles := []string{"user", "assistant", "tool"}
	types := []string{"message", "custom"}
	for i := 0; i < 60; i++ {
		n := rng.Intn(6)
		branch := make([]map[string]any, 0, n)
		for j := 0; j < n; j++ {
			msg := map[string]any{
				"role":         roles[rng.Intn(len(roles))],
				"stopReason":   stopReasons[rng.Intn(len(stopReasons))],
				"errorMessage": texts[rng.Intn(len(texts))],
			}
			if r := rawStops[rng.Intn(len(rawStops))]; r != "" {
				msg["rawStopReason"] = r
			}
			if rng.Intn(2) == 0 {
				msg["provider"] = "grok"
			}
			if rng.Intn(2) == 0 {
				msg["model"] = "g"
			}
			branch = append(branch, map[string]any{
				"type":    types[rng.Intn(len(types))],
				"message": msg,
			})
		}
		raw, _ := json.Marshal(branch)
		got := extractOf(t, string(raw))
		want := jsExtract(t, string(raw))
		if got != want {
			t.Fatalf("fuzz extract %d %s\ngo %s\njs %s", i, raw, got, want)
		}
	}
}

func extractOf(t *testing.T, raw string) string {
	t.Helper()
	var branch []branchEntry
	if err := json.Unmarshal([]byte(raw), &branch); err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(extractLastAssistantError(branch))
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func jsExtract(t *testing.T, raw string) string {
	t.Helper()
	script := `const branch = JSON.parse(process.argv[1]);
function physical(msg){ if(!msg.provider || !msg.model) return {}; return {provider:msg.provider, model:msg.model}; }
function extract(branch){
 for (let i = branch.length - 1; i >= 0; i--) {
  const entry = branch[i];
  if (entry?.type !== "message") continue;
  const msg = entry.message;
  if (msg?.role !== "assistant") continue;
  if (msg.stopReason === "aborted") return {text: msg.errorMessage ?? "", stopReason: "aborted", ...physical(msg)};
  if (msg.stopReason !== "error") return null;
  const rawStopReason = typeof msg.rawStopReason === "string" && msg.rawStopReason ? msg.rawStopReason : undefined;
  return {text: msg.errorMessage ?? "", stopReason: "error", ...(rawStopReason ? {rawStopReason} : {}), ...physical(msg)};
 }
 return null;
}
process.stdout.write(JSON.stringify(extract(branch)));`
	cmd := exec.Command("node", "-e", script, raw)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %v", out, err)
	}
	return strings.TrimSpace(string(out))
}

func classifyOf(t *testing.T, raw string) string {
	t.Helper()
	var err failoverError
	if e := json.Unmarshal([]byte(raw), &err); e != nil {
		t.Fatal(e)
	}
	return classifyError(err)
}

func decideOf(t *testing.T, raw string) string {
	t.Helper()
	var input decideInput
	if e := json.Unmarshal([]byte(raw), &input); e != nil {
		t.Fatal(e)
	}
	out, e := json.Marshal(decideFailover(input))
	if e != nil {
		t.Fatal(e)
	}
	return string(out)
}

func js(t *testing.T, kind, raw string) string {
	t.Helper()
	cmd := exec.Command("node", "oracle.mjs", raw, kind)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %v", out, err)
	}
	return strings.TrimSpace(string(out))
}
