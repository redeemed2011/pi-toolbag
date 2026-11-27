package main

import (
	"encoding/json"
	"math/rand"
	"os/exec"
	"strings"
	"testing"
)

func TestChildWarning(t *testing.T) {
	if childWarning("extension already registered") != "pi-auto-fallback: child sessions will not fail over; another extension already registered required child extensions" {
		t.Fatal("registered")
	}
	if childWarning("disk full") != "pi-auto-fallback: child sessions will not fail over; disk full" {
		t.Fatal("other")
	}
}

func TestNotice(t *testing.T) {
	budget := 2.0
	metric := "percent"
	value := 92.2
	threshold := 80.0
	text, level, ok := notice(event{Type: "failover", From: "a/b", To: "c/d", Reason: "quota", Budget: &budget})
	if !ok || level != "warning" || text != "failover a/b -> c/d reason=quota budget=2" {
		t.Fatal(text, level, ok)
	}
	text, level, ok = notice(event{Type: "usage-switch", From: "a/b", To: "c/d", Metric: &metric, Value: &value, Threshold: &threshold})
	if !ok || text != "usage percent 92.2 >= 80 a/b -> c/d" {
		t.Fatal(text)
	}
	text, _, ok = notice(event{Type: "usage-return", From: "a/b", To: "c/d"})
	if !ok || text != "usage return a/b -> c/d" {
		t.Fatal(text)
	}
	detail := "down"
	text, _, ok = notice(event{Type: "usage-skip", Reason: "usage-held", Detail: &detail})
	if ok {
		t.Fatal("held should be silent")
	}
	model := "grok/x"
	text, _, ok = notice(event{Type: "usage-skip", Reason: "no-target", Model: &model, Detail: &detail})
	if !ok || text != "usage check no-target for grok/x: down" {
		t.Fatal(text, ok)
	}
}

func TestFuzzMatchesJavaScript(t *testing.T) {
	script := `
const mode = process.argv[1];
const raw = process.argv[2];
if (mode === "warn") {
  process.stdout.write(raw.includes("already registered")
    ? "pi-auto-fallback: child sessions will not fail over; another extension already registered required child extensions"
    : "pi-auto-fallback: child sessions will not fail over; " + raw);
} else if (mode === "bind") {
  const r = JSON.parse(raw);
  if (r.phase === "before") {
    if (r.hasRegistration && r.sameSession) process.stdout.write("keep");
    else if (!r.hasSession) process.stdout.write("skip");
    else process.stdout.write("load");
  } else if (!r.hasAPI) process.stdout.write("skip");
  else if (!r.sameSession) process.stdout.write("replace");
  else process.stdout.write("register");
} else {
  const e = JSON.parse(raw);
  let res = null;
  if (e.type === "failover") {
    res = { text: "failover " + (e.from ?? "") + " -> " + (e.to ?? "") + " reason=" + (e.reason ?? "") + " budget=" + (e.budget ?? "undefined"), level: "warning" };
  } else if (e.type === "usage-switch") {
    res = { text: "usage " + (e.metric ?? "undefined") + " " + (e.value ?? "undefined") + " >= " + (e.threshold ?? "undefined") + " " + (e.from ?? "") + " -> " + (e.to ?? ""), level: "warning" };
  } else if (e.type === "usage-return") {
    const detail = (e.metric != null && e.value != null && e.threshold != null) ? (" " + e.metric + " " + e.value + " threshold=" + e.threshold) : "";
    res = { text: "usage return " + (e.from ?? "") + " -> " + (e.to ?? "") + detail, level: "info" };
  } else if (e.type === "usage-skip" && (e.reason === "unavailable" || e.reason === "no-target" || e.reason === "not-in-chain")) {
    const model = e.model ? e.model : "model";
    const extra = e.detail ? (": " + e.detail) : "";
    res = { text: "usage check " + e.reason + " for " + model + extra, level: "warning" };
  }
  process.stdout.write(JSON.stringify(res));
}
`
	rng := rand.New(rand.NewSource(17))
	for _, phase := range []string{"before", "after"} {
		for mask := 0; mask < 16; mask++ {
			req := map[string]any{
				"phase":           phase,
				"hasRegistration": mask&1 != 0,
				"sameSession":     mask&2 != 0,
				"hasSession":      mask&4 != 0,
				"hasAPI":          mask&8 != 0,
			}
			raw, _ := json.Marshal(req)
			got := childBind(phase, mask&1 != 0, mask&2 != 0, mask&4 != 0, mask&8 != 0)
			out, err := exec.Command("node", "-e", script, "bind", string(raw)).CombinedOutput()
			if err != nil {
				t.Fatalf("%s %v", out, err)
			}
			if got != strings.TrimSpace(string(out)) {
				t.Fatalf("bind %s: go=%q js=%q", raw, got, out)
			}
		}
	}
	msgs := []string{"extension already registered", "disk full", "x already registered y", "", "timeout"}
	for _, msg := range msgs {
		got := childWarning(msg)
		out, err := exec.Command("node", "-e", script, "warn", msg).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", out, err)
		}
		if got != string(out) {
			t.Fatalf("warn %q: go=%q js=%q", msg, got, out)
		}
	}
	evTypes := []string{"failover", "usage-switch", "usage-return", "usage-skip", "unknown"}
	reasons := []string{"quota", "transient", "unavailable", "no-target", "not-in-chain", "usage-held"}
	metrics := []string{"percent", "dollars"}
	models := []string{"a/b", "grok/x", ""}
	details := []string{"down", "timeout", ""}
	nums := []float64{0, 2, 80, 92.25, 100}
	for i := 0; i < 80; i++ {
		ev := event{
			Type:   evTypes[rng.Intn(len(evTypes))],
			From:   models[rng.Intn(len(models))],
			To:     models[rng.Intn(len(models))],
			Reason: reasons[rng.Intn(len(reasons))],
		}
		if rng.Intn(2) == 0 {
			v := nums[rng.Intn(len(nums))]
			ev.Budget = &v
		}
		if rng.Intn(2) == 0 {
			m := metrics[rng.Intn(len(metrics))]
			ev.Metric = &m
		}
		if rng.Intn(2) == 0 {
			v := nums[rng.Intn(len(nums))]
			ev.Value = &v
		}
		if rng.Intn(2) == 0 {
			v := nums[rng.Intn(len(nums))]
			ev.Threshold = &v
		}
		if rng.Intn(2) == 0 {
			m := models[rng.Intn(len(models))]
			ev.Model = &m
		}
		if rng.Intn(2) == 0 {
			d := details[rng.Intn(len(details))]
			ev.Detail = &d
		}
		raw, _ := json.Marshal(ev)
		text, level, ok := notice(ev)
		var got string
		if !ok {
			got = "null"
		} else {
			b, _ := json.Marshal(map[string]string{"text": text, "level": level})
			got = string(b)
		}
		out, err := exec.Command("node", "-e", script, "notice", string(raw)).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v", out, err)
		}
		var gotV, wantV any
		_ = json.Unmarshal([]byte(got), &gotV)
		_ = json.Unmarshal(out, &wantV)
		gotNorm, _ := json.Marshal(gotV)
		wantNorm, _ := json.Marshal(wantV)
		if string(gotNorm) != string(wantNorm) {
			t.Fatalf("notice %d %s\ngo %s\njs %s", i, raw, gotNorm, wantNorm)
		}
	}
}
