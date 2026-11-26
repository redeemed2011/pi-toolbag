package ctx

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFoldMatchesTheServer(t *testing.T) {
	server, err := filepath.Abs(filepath.Join("..", "..", "brazos-worktrees", "hub-ask", "server"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(server, "src", "memory", "fold.ts")); err != nil {
		t.Skip(err)
	}
	cases := []struct {
		name    string
		lines   []string
		claimed string
	}{
		{"supersede", []string{
			`{"id":"a","type":"question","ts":"1","session":"s","headline":"a","body":"a"}`,
			`{"id":"b","type":"decision","ts":"2","session":"s","headline":"b","body":"b","supersedes":["a"]}`,
		}, "a"},
		{"conflict", []string{
			`{"id":"a","type":"question","ts":"1","session":"s","headline":"a","body":"a"}`,
			`{"id":"b","type":"decision","ts":"2","session":"s","headline":"b","body":"b","supersedes":["a"]}`,
			`{"id":"c","type":"decision","ts":"3","session":"s","headline":"c","body":"c","supersedes":["a"]}`,
		}, ""},
		{"frontier", []string{
			`{"id":"q1","type":"question","ts":"1","session":"s","headline":"q1","body":"q1"}`,
			`{"id":"q2","type":"question","ts":"2","session":"s","headline":"q2","body":"q2"}`,
			`{"id":"q3","type":"question","ts":"3","session":"s","headline":"q3","body":"q3"}`,
			`{"id":"block","type":"constraint","ts":"4","session":"s","headline":"block","body":"block","directive":"block","applies_to":"all","blocks":["q2"]}`,
			`{"id":"ask","type":"decision","ts":"5","session":"s","headline":"Ask the operator","body":"ask","asks":["q3"]}`,
		}, "q1"},
		{"destinations", []string{
			`{"id":"d2","type":"destination","ts":"2","session":"s","headline":"d2","body":"d2"}`,
			`{"id":"d1","type":"destination","ts":"1","session":"s","headline":"d1","body":"d1"}`,
		}, ""},
		{"follow", []string{
			`{"id":"old","type":"question","ts":"1","session":"s","headline":"old","body":"old"}`,
			`{"id":"mid","type":"decision","ts":"2","session":"s","headline":"mid","body":"mid","supersedes":["old"]}`,
			`{"id":"next","type":"question","ts":"3","session":"s","headline":"next","body":"next","supersedes":["mid"]}`,
		}, "old"},
	}
	script := filepath.Join(t.TempDir(), "folddiff.ts")
	if err := os.WriteFile(script, []byte(foldDiffScript(server)), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "log.jsonl")
			body := ""
			for _, line := range item.lines {
				body += line + "\n"
			}
			if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			records := ParseJSONL(file)
			file.Close()
			live := FoldLive(records)
			got := foldView(live, item.claimed)
			cmd := exec.Command("npx", "tsx", script, path, item.claimed)
			cmd.Dir = server
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatal(string(out), err)
			}
			var want foldSnapshot
			if err := json.Unmarshal(out, &want); err != nil {
				t.Fatal(string(out), err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("go %#v\nserver %#v", got, want)
			}
		})
	}
}

type foldSnapshot struct {
	Live         []string `json:"live"`
	Frontier     []string `json:"frontier"`
	Conflicts    []string `json:"conflicts"`
	Destinations []string `json:"destinations"`
	Followed     string   `json:"followed"`
}

func foldView(live Live, claimed string) foldSnapshot {
	ids := []string{}
	for id := range live.Live {
		ids = append(ids, id)
	}
	sortStrings(ids)
	frontier := []string{}
	for _, rec := range Frontier(live, claimed) {
		frontier = append(frontier, rec.ID)
	}
	destinations := []string{}
	for _, rec := range live.Destinations {
		destinations = append(destinations, rec.ID)
	}
	conflicts := append([]string{}, live.LiveConflict...)
	return foldSnapshot{Live: ids, Frontier: frontier, Conflicts: conflicts, Destinations: destinations, Followed: FollowClaim(live, claimed)}
}

func sortStrings(ids []string) {
	for i := 0; i < len(ids); i++ {
		for j := i + 1; j < len(ids); j++ {
			if ids[j] < ids[i] {
				ids[i], ids[j] = ids[j], ids[i]
			}
		}
	}
}

func foldDiffScript(server string) string {
	return `import { readFileSync } from "node:fs";
import { foldLive, frontierItems, followClaim } from "` + server + `/src/memory/fold.ts";
const records = readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const live = foldLive(records);
const sort = (xs) => [...xs].sort();
const claimed = process.argv[3] || null;
console.log(JSON.stringify({
  live: sort(live.live),
  frontier: frontierItems(live, claimed).map((item) => item.id),
  conflicts: sort(live.liveConflict),
  destinations: live.destinations.map((item) => item.id),
  followed: followClaim(live, claimed) ?? "",
}));
`
}
