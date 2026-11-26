package main

import (
	"encoding/json"
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
