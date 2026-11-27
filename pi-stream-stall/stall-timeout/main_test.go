package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os/exec"
	"strings"
	"testing"
)

func TestFailureKeepsPartialText(t *testing.T) {
	message := failureMessage(map[string]any{
		"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "partial"}},
	}, "boom", 5)
	if message["errorMessage"] != "boom" || message["stopReason"] != "error" || message["timestamp"] != int64(5) {
		t.Fatalf("%#v", message)
	}
	content := message["content"].([]any)
	if content[0].(map[string]any)["text"] != "partial" {
		t.Fatal(content)
	}
}

func TestMatchesJavaScript(t *testing.T) {
	script := `function parseIdleTimeoutMs(flag, env) {
  const raw = flag !== undefined && String(flag).trim() !== "" ? String(flag) : env;
  if (raw === undefined) return 180000;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return 180000;
  if (trimmed === "0" || trimmed === "off" || trimmed === "false") return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 180000;
  return Math.floor(parsed);
}
const input = JSON.parse(process.argv[1]);
const flag = input.flag === null ? undefined : input.flag;
const env = input.env === null ? undefined : input.env;
process.stdout.write(String(parseIdleTimeoutMs(flag, env)));
`
	cases := []string{
		`{"flag":"1000","env":"50"}`,
		`{"flag":null,"env":"50"}`,
		`{"flag":null,"env":null}`,
		`{"flag":"0","env":null}`,
		`{"flag":"off","env":null}`,
		`{"flag":null,"env":"false"}`,
		`{"flag":"  OFF ","env":"9"}`,
		`{"flag":"","env":"12"}`,
		`{"flag":true,"env":null}`,
		`{"flag":false,"env":"9"}`,
		`{"flag":"1.9","env":null}`,
		`{"flag":"-3","env":null}`,
		`{"flag":"0x10","env":null}`,
		`{"flag":"Infinity","env":null}`,
		`{"flag":"1e2","env":null}`,
	}
	rng := rand.New(rand.NewSource(1))
	words := []string{"", " ", "0", "off", "false", "true", "1.2", "-1", "0x10", "0b11", "0o10", "nan", "Infinity", "  42 ", "1e3"}
	for i := 0; i < 40; i++ {
		flag := words[rng.Intn(len(words))]
		env := words[rng.Intn(len(words))]
		cases = append(cases, fmt.Sprintf(`{"flag":%q,"env":%q}`, flag, env))
	}
	for _, input := range cases {
		cmd := exec.Command("node", "-e", script, input)
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(input, err)
		}
		var decoded struct {
			Flag any     `json:"flag"`
			Env  *string `json:"env"`
		}
		if err := json.Unmarshal([]byte(input), &decoded); err != nil {
			t.Fatal(err)
		}
		got := fmt.Sprint(parseIdleTimeoutMs(decoded.Flag, decoded.Env))
		if got != strings.TrimSpace(string(out)) {
			t.Fatalf("%s go %s js %s", input, got, out)
		}
	}
}

func TestFuzzWatchdogMatchesJavaScript(t *testing.T) {
	script := `
const mode = process.argv[1];
const d = JSON.parse(process.argv[2]);
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
if (mode === "race") {
  process.stdout.write(d.kind === "timeout" ? "abandon" : "cancel-sleep");
} else if (mode === "pump") {
  if (d.kind === "timeout") process.stdout.write("timeout");
  else if (d.kind === "error") process.stdout.write("fail-error");
  else if (d.iteratorDone) process.stdout.write("finish");
  else if (d.eventType === "error" || d.eventType === "done") process.stdout.write("stop");
  else process.stdout.write("continue");
} else if (mode === "finish") {
  if (!d.hasResult) process.stdout.write("missing");
  else if (d.kind === "timeout") process.stdout.write("timeout");
  else if (d.kind === "error") process.stdout.write("fail-error");
  else if (d.stopReason === "error") process.stdout.write("fail-message");
  else process.stdout.write("end");
} else if (mode === "partial") {
  let out = null;
  if (d.type === "error") out = d.error ?? null;
  else if (d.type === "done") out = d.message ?? null;
  else if ("partial" in d) out = d.partial;
  process.stdout.write(JSON.stringify(out));
} else if (mode === "message") {
  const text = "Provider stream timeout (" + d.provider + "/" + d.id + "): no data for " + d.idleMs + "ms";
  const out = d.partial
    ? { ...d.partial, stopReason: "error", errorMessage: text, timestamp: d.timestamp }
    : { role: "assistant", content: [], api: d.api, provider: d.provider, model: d.id, usage: zeroUsage(), stopReason: "error", errorMessage: text, timestamp: d.timestamp };
  process.stdout.write(JSON.stringify(out));
}
`
	rng := rand.New(rand.NewSource(23))
	kinds := []string{"timeout", "value", "error"}
	evTypes := []string{"", "text_delta", "error", "done", "start"}
	stops := []string{"", "stop", "error", "aborted"}
	for _, kind := range kinds {
		raw, _ := json.Marshal(map[string]any{"kind": kind})
		out, err := exec.Command("node", "-e", script, "race", string(raw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", out, err)
		}
		if raceAftermath(kind) != strings.TrimSpace(string(out)) {
			t.Fatalf("race %s: go=%q js=%q", kind, raceAftermath(kind), out)
		}
	}
	for i := 0; i < 60; i++ {
		kind := kinds[rng.Intn(len(kinds))]
		evType := evTypes[rng.Intn(len(evTypes))]
		done := rng.Intn(2) == 0
		raw, _ := json.Marshal(map[string]any{"kind": kind, "eventType": evType, "iteratorDone": done})
		out, err := exec.Command("node", "-e", script, "pump", string(raw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", out, err)
		}
		if pumpStep(kind, evType, done) != strings.TrimSpace(string(out)) {
			t.Fatalf("pump %d: go=%q js=%q", i, pumpStep(kind, evType, done), out)
		}

		hasRes := rng.Intn(2) == 0
		stop := stops[rng.Intn(len(stops))]
		fRaw, _ := json.Marshal(map[string]any{"hasResult": hasRes, "kind": kind, "stopReason": stop})
		fOut, err := exec.Command("node", "-e", script, "finish", string(fRaw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", fOut, err)
		}
		if finishStep(hasRes, kind, stop) != strings.TrimSpace(string(fOut)) {
			t.Fatalf("finish %d: go=%q js=%q", i, finishStep(hasRes, kind, stop), fOut)
		}
	}
	for i := 0; i < 40; i++ {
		ev := map[string]any{"type": evTypes[rng.Intn(len(evTypes))]}
		if rng.Intn(2) == 0 {
			ev["error"] = map[string]any{"role": "assistant", "stopReason": "error"}
		}
		if rng.Intn(2) == 0 {
			ev["message"] = map[string]any{"role": "assistant", "stopReason": "stop"}
		}
		if rng.Intn(2) == 0 {
			ev["partial"] = map[string]any{"role": "assistant", "content": []any{"hi"}}
		}
		raw, _ := json.Marshal(ev)
		gotB, _ := json.Marshal(partialFrom(ev))
		out, err := exec.Command("node", "-e", script, "partial", string(raw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", out, err)
		}
		var gotV, wantV any
		_ = json.Unmarshal(gotB, &gotV)
		_ = json.Unmarshal(out, &wantV)
		gotNorm, _ := json.Marshal(gotV)
		wantNorm, _ := json.Marshal(wantV)
		if string(gotNorm) != string(wantNorm) {
			t.Fatalf("partial %d %s\ngo %s\njs %s", i, raw, gotNorm, wantNorm)
		}

		var partial json.RawMessage
		if rng.Intn(2) == 0 {
			partial = json.RawMessage(`{"role":"assistant","content":[{"type":"text","text":"ok"}]}`)
		} else {
			partial = json.RawMessage("null")
		}
		msgReq := map[string]any{
			"api": "openai-responses", "provider": "grok", "id": "grok-4.7",
			"idleMs": 1000 + rng.Intn(9000), "timestamp": int64(1700000000 + i),
			"partial": partial,
		}
		mRaw, _ := json.Marshal(msgReq)
		mGotB, _ := json.Marshal(timeoutMessage("openai-responses", "grok", "grok-4.7", msgReq["idleMs"].(int), msgReq["timestamp"].(int64), partial))
		mOut, err := exec.Command("node", "-e", script, "message", string(mRaw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", mOut, err)
		}
		var mgV, mwV any
		_ = json.Unmarshal(mGotB, &mgV)
		_ = json.Unmarshal(mOut, &mwV)
		mgNorm, _ := json.Marshal(mgV)
		mwNorm, _ := json.Marshal(mwV)
		if string(mgNorm) != string(mwNorm) {
			t.Fatalf("message %d %s\ngo %s\njs %s", i, mRaw, mgNorm, mwNorm)
		}
	}
}
