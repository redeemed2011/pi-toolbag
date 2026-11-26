package ctx

import (
	"strings"
	"testing"
)

func rec(id, kind, ts string, supersedes ...string) Record {
	return Record{ID: id, Type: kind, TS: ts, Session: "s", Headline: id, Body: id, Supersedes: supersedes}
}

func TestFoldDropsASupersededQuestion(t *testing.T) {
	live := FoldLive([]Record{rec("a", "question", "1"), rec("b", "decision", "2", "a")})
	if live.Live["a"] || !live.Live["b"] {
		t.Fatal(live.Live)
	}
	if len(Frontier(live, "")) != 0 {
		t.Fatal(Frontier(live, ""))
	}
}

func TestTwoLiveSuccessorsStayInConflict(t *testing.T) {
	live := FoldLive([]Record{rec("a", "question", "1"), rec("b", "decision", "2", "a"), rec("c", "decision", "3", "a")})
	if !live.Live["b"] || !live.Live["c"] || live.Live["a"] {
		t.Fatal(live.Live)
	}
	if len(live.LiveConflict) != 1 || live.LiveConflict[0] != "a" {
		t.Fatal(live.LiveConflict)
	}
}

func TestFrontierSkipsBlockedAskedAndClaimed(t *testing.T) {
	blocker := rec("block", "constraint", "2")
	blocker.Blocks = []string{"q2"}
	blocker.AppliesTo = "all"
	ask := rec("ask", "decision", "3")
	ask.Headline = "Ask the operator"
	ask.Asks = []string{"q3"}
	live := FoldLive([]Record{rec("q1", "question", "1"), rec("q2", "question", "1b"), rec("q3", "question", "1c"), blocker, ask})
	got := Frontier(live, "q1")
	if len(got) != 0 {
		t.Fatal(got)
	}
}

func TestFollowClaimWalksToTheOneOpenQuestion(t *testing.T) {
	live := FoldLive([]Record{rec("old", "question", "1"), rec("mid", "decision", "2", "old"), rec("next", "question", "3", "mid")})
	if got := FollowClaim(live, "old"); got != "next" {
		t.Fatal(got)
	}
	if got := FollowClaim(live, "next"); got != "next" {
		t.Fatal(got)
	}
}

func TestParseJSONLSkipsABadLineAndAConstraintWithoutAppliesTo(t *testing.T) {
	text := strings.Join([]string{
		"{",
		`{"id":"q","type":"question","ts":"1","session":"s","headline":"h","body":"b"}`,
		`{"id":"c","type":"constraint","ts":"2","session":"s","headline":"h","body":"b"}`,
		`{"id":"q","type":"question","ts":"3","session":"s","headline":"again","body":"b"}`,
		`{"id":"ok","type":"constraint","ts":"4","session":"s","headline":"h","body":"b","applies_to":["all"]}`,
	}, "\n")
	got := ParseJSONL(strings.NewReader(text))
	if len(got) != 2 || got[0].ID != "q" || got[1].ID != "ok" || got[1].AppliesTo != "all" {
		t.Fatal(got)
	}
}

func TestDestinationsStayInMintOrder(t *testing.T) {
	live := FoldLive([]Record{rec("d2", "destination", "2"), rec("d1", "destination", "1")})
	if live.Destinations[0].ID != "d1" || live.Destinations[1].ID != "d2" {
		t.Fatal(live.Destinations)
	}
}
