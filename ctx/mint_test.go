package ctx

import "testing"

func TestMintFileAppendsAQuestionAndFoldsItBack(t *testing.T) {
	path := t.TempDir() + "/log.jsonl"
	got, err := MintFile(path, PutInput{Type: "question", Headline: "Ship the store", Body: "One store.", Session: "s", ID: "q1", TS: "1"}, "gated-edge", 0, "")
	if err != nil || !got.OK {
		t.Fatal(got, err)
	}
	records, err := ReadLog(path)
	if err != nil || len(records) != 1 || records[0].ID != "q1" {
		t.Fatal(records, err)
	}
	live := FoldLive(records)
	if !live.Live["q1"] || len(Frontier(live, "")) != 1 {
		t.Fatal(live.Live)
	}
	refused, err := MintFile(path, PutInput{Type: "constraint", Headline: "No directive", AppliesTo: "all", Session: "s"}, "gated-edge", 0, "")
	if err != nil || refused.OK || refused.Error != "directive required" {
		t.Fatal(refused, err)
	}
	again, err := ReadLog(path)
	if err != nil || len(again) != 1 {
		t.Fatal(again, err)
	}
}

func TestMintRefusesAConstraintWithoutADirective(t *testing.T) {
	got := Put(nil, PutInput{Type: "constraint", Headline: "Keep the gate", AppliesTo: "all", Session: "s"}, "gated-edge", 0, "")
	if got.OK || got.Error != "directive required" {
		t.Fatal(got)
	}
}

func TestMintRefusesADanglingAppliesTo(t *testing.T) {
	got := Put(nil, PutInput{Type: "constraint", Headline: "Keep the gate", Directive: "Keep it.", AppliesTo: []any{"missing"}, Session: "s"}, "gated-edge", 0, "")
	if got.OK || got.Error != "applies_to dangling" {
		t.Fatal(got)
	}
}

func TestMintAcceptsAllAsAList(t *testing.T) {
	got := Put(nil, PutInput{Type: "constraint", Headline: "Keep the gate", Directive: "Keep it.", AppliesTo: []any{"all"}, Session: "s", ID: "c", TS: "1"}, "gated-edge", 0, "")
	if !got.OK || got.Record.AppliesTo != "all" {
		t.Fatal(got)
	}
}

func TestMintRefusesASecondLiveHeadline(t *testing.T) {
	first := rec("c1", "constraint", "1")
	first.Directive = "Keep it."
	first.AppliesTo = "all"
	first.Headline = "Keep the gate"
	got := Put([]Record{first}, PutInput{Type: "constraint", Headline: "Keep the gate!", Directive: "Again.", AppliesTo: "all", Session: "s", ID: "c2", TS: "2"}, "gated-edge", 0, "")
	if got.OK || got.Error != "live_conflict" || len(got.Conflict) != 1 || got.Conflict[0] != "c1" {
		t.Fatal(got)
	}
}

func TestMintRefusesASupersedeWithoutAReason(t *testing.T) {
	got := Put([]Record{rec("q", "question", "1")}, PutInput{Type: "decision", Headline: "Done", Supersedes: "q", Session: "s"}, "gated-edge", 0, "")
	if got.OK || got.Error != "reason_class required" {
		t.Fatal(got)
	}
}

func TestMintRefusesAnAlreadySupersededTarget(t *testing.T) {
	got := Put([]Record{rec("q", "question", "1"), rec("d", "decision", "2", "q")}, PutInput{Type: "decision", Headline: "Again", Supersedes: "q", Reason: "decision_change", Session: "s"}, "gated-edge", 0, "")
	if got.OK || got.Error != "already_superseded" {
		t.Fatal(got)
	}
}

func TestMintRefusesAQuestionThatDoesNotFit(t *testing.T) {
	got := Put(nil, PutInput{Type: "question", Headline: "Big", Body: stringsRepeat("x", 1501*4), Session: "s"}, "gated-edge", 0, "")
	if got.OK || got.Error != "question_too_large" {
		t.Fatal(got)
	}
}

func stringsRepeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}
