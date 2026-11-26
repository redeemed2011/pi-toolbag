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
