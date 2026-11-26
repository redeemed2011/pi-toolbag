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
