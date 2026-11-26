package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"pi-toolbag/ctx"
)

func main() {
	if len(os.Args) < 3 || os.Args[1] != "fold" {
		fmt.Fprintln(os.Stderr, "usage: ctx fold <log.jsonl>")
		os.Exit(2)
	}
	file, err := os.Open(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer file.Close()
	live := ctx.FoldLive(ctx.ParseJSONL(file))
	ids := func(set map[string]bool) []string {
		out := []string{}
		for id := range set {
			out = append(out, id)
		}
		return out
	}
	liveIDs := ids(live.Live)
	sort.Strings(liveIDs)
	frontier := []string{}
	for _, rec := range ctx.Frontier(live, "") {
		frontier = append(frontier, rec.ID)
	}
	raw, err := json.Marshal(map[string]any{
		"live":      liveIDs,
		"frontier":  frontier,
		"conflicts": live.LiveConflict,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(raw))
}
