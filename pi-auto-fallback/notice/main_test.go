package main

import "testing"

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
