package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"pi-toolbag/ctx"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "fold":
		fold(os.Args[2:])
	case "mint":
		mint(os.Args[2:])
	case "sync":
		if err := ctx.Sync(ctx.SyncPaths{
			Store: envOr("CTX_SYNC_STORE", os.Getenv("HOME")+"/.brazos/ctx"),
			Git:   envOr("CTX_SYNC_GIT", os.Getenv("HOME")+"/.local/share/ctx-sync/git"),
			State: envOr("CTX_SYNC_STATE", os.Getenv("HOME")+"/.local/state/ctx-sync"),
		}, os.Getenv("CTX_SYNC_DEVICE")); err != nil {
			fmt.Fprintf(os.Stderr, "ctx-sync: %s\n", err)
			os.Exit(1)
		}
	default:
		usage()
	}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ctx fold <log.jsonl>")
	fmt.Fprintln(os.Stderr, "       ctx mint --log <log.jsonl> --type <type> --headline <text> --session <id>")
	os.Exit(2)
}

func fold(args []string) {
	if len(args) != 1 {
		usage()
	}
	file, err := os.Open(args[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer file.Close()
	live := ctx.FoldLive(ctx.ParseJSONL(file))
	liveIDs := make([]string, 0, len(live.Live))
	for id := range live.Live {
		liveIDs = append(liveIDs, id)
	}
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

func mint(args []string) {
	log := flag(args, "--log")
	kind := flag(args, "--type")
	headline := flag(args, "--headline")
	session := flag(args, "--session")
	if log == "" || kind == "" || headline == "" || session == "" {
		usage()
	}
	applies := flag(args, "--applies-to")
	var appliesTo any
	if applies == "all" {
		appliesTo = "all"
	} else if applies != "" {
		appliesTo = strings.Split(applies, ",")
	}
	result, err := ctx.MintFile(log, ctx.PutInput{
		Type:       kind,
		Headline:   headline,
		Body:       flag(args, "--body"),
		Directive:  flag(args, "--directive"),
		AppliesTo:  appliesTo,
		Supersedes: flag(args, "--supersedes"),
		Reason:     flag(args, "--reason"),
		Session:    session,
	}, "gated-edge", 0, flag(args, "--claimed"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if !result.OK {
		fmt.Fprintln(os.Stderr, result.Error)
		os.Exit(1)
	}
	raw, err := json.Marshal(result.Record)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(raw))
}

func flag(args []string, name string) string {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	return ""
}
