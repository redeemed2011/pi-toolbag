package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

const usageText = `Messages between Sam's dev agents and Engineering Lead (bb-file's Grok Bot).

Usage: dev-agent-bridge <COMMAND>

Commands:
  send     Send one message to Engineering Lead's webhook.
  take     Take Engineering Lead's new inbox messages for this session, as JSON.
  listen   Make this session the one that receives Engineering Lead's messages.
  release  Give up the lease if this session holds it.
  status   Show which session receives messages and how many are waiting, as JSON.
`

type cliHelp struct {
	text string
}

func (h *cliHelp) Error() string { return h.text }

type cliError struct {
	msg string
}

func (e *cliError) Error() string { return e.msg }

func nextFlagValue(args []string, i int, name string) (string, int, error) {
	if i+1 >= len(args) {
		return "", i, &cliError{msg: fmt.Sprintf("error: a value is required for '%s' but none was supplied", name)}
	}
	return args[i+1], i + 1, nil
}

func splitFlag(arg string) (string, string, bool) {
	if strings.HasPrefix(arg, "--") {
		if k, v, ok := strings.Cut(arg, "="); ok {
			return k, v, true
		}
	}
	return arg, "", false
}

func runCLI(args []string, env Env, stdin io.Reader) (string, int, string) {
	if len(args) == 0 {
		return "", 2, usageText
	}
	cmd := args[0]
	if cmd == "-h" || cmd == "--help" || cmd == "help" {
		return usageText, 0, ""
	}
	rest := args[1:]
	switch cmd {
	case "send":
		sargs, err := parseSendArgs(rest)
		if err != nil {
			if h, ok := err.(*cliHelp); ok {
				return h.text, 0, ""
			}
			return "", 2, err.Error()
		}
		out, berr := runSend(env, sargs, stdin)
		if berr != nil {
			return "", berr.Code, "dev-agent-bridge: " + berr.Message
		}
		return out, 0, ""
	case "take":
		session, cwd, hold, err := parseTakeArgs(rest)
		if err != nil {
			if h, ok := err.(*cliHelp); ok {
				return h.text, 0, ""
			}
			return "", 2, err.Error()
		}
		var taken Taken
		var berr *BridgeError
		if hold {
			taken, berr = runHold(env, session, cwd)
		} else {
			taken, berr = runTake(env, session, cwd)
		}
		if berr != nil {
			return "", berr.Code, "dev-agent-bridge: " + berr.Message
		}
		encoded, _ := marshalJSON(&taken)
		return string(encoded), 0, ""
	case "listen":
		session, cwd, err := parseListenArgs(rest)
		if err != nil {
			if h, ok := err.(*cliHelp); ok {
				return h.text, 0, ""
			}
			return "", 2, err.Error()
		}
		out, berr := runListen(env, session, cwd)
		if berr != nil {
			return "", berr.Code, "dev-agent-bridge: " + berr.Message
		}
		return out, 0, ""
	case "release":
		session, err := parseReleaseArgs(rest)
		if err != nil {
			if h, ok := err.(*cliHelp); ok {
				return h.text, 0, ""
			}
			return "", 2, err.Error()
		}
		out, berr := runRelease(env, session)
		if berr != nil {
			return "", berr.Code, "dev-agent-bridge: " + berr.Message
		}
		return out, 0, ""
	case "status":
		for _, a := range rest {
			if a == "-h" || a == "--help" {
				return "Show which session receives messages and how many are waiting, as JSON.", 0, ""
			}
			return "", 2, fmt.Sprintf("error: unexpected argument '%s' found", a)
		}
		st, berr := runStatus(env)
		if berr != nil {
			return "", berr.Code, "dev-agent-bridge: " + berr.Message
		}
		encoded, _ := marshalJSON(&st)
		return string(encoded), 0, ""
	default:
		return "", 2, fmt.Sprintf("error: unrecognized subcommand '%s'", cmd)
	}
}

func parseSendArgs(args []string) (SendArgs, error) {
	var out SendArgs
	var hasKind, hasTopic bool
	for i := 0; i < len(args); i++ {
		flag, inline, hasEq := splitFlag(args[i])
		if flag == "-h" || flag == "--help" {
			return out, &cliHelp{text: "Usage: dev-agent-bridge send --kind <ask|reply|note> --topic <TOPIC> (--body <BODY> | --body-file <FILE>) [--reply-to <ID>] [--ctx <ID>]... [--commit <SHA>] [--file <FILE>] [--id <ID>] [--dry-run] [--session <SESSION>]"}
		}
		getVal := func() (string, error) {
			if hasEq {
				return inline, nil
			}
			v, ni, err := nextFlagValue(args, i, flag)
			i = ni
			return v, err
		}
		switch flag {
		case "--kind":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			if v != "ask" && v != "reply" && v != "note" {
				return out, &cliError{msg: fmt.Sprintf("error: invalid value '%s' for '--kind <KIND>'\n  [possible values: ask, reply, note]", v)}
			}
			out.Kind = v
			hasKind = true
		case "--topic":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.Topic = v
			hasTopic = true
		case "--body":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.Body = &v
		case "--body-file":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.BodyFile = &v
		case "--reply-to":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.ReplyTo = &v
		case "--ctx":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.Ctx = append(out.Ctx, v)
		case "--commit":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.Commit = &v
		case "--file":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.File = &v
		case "--id":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.ID = &v
		case "--session":
			v, err := getVal()
			if err != nil {
				return out, err
			}
			out.Session = &v
		case "--dry-run":
			if hasEq {
				return out, &cliError{msg: "error: unexpected value for '--dry-run'"}
			}
			out.DryRun = true
		default:
			return out, &cliError{msg: fmt.Sprintf("error: unexpected argument '%s' found", args[i])}
		}
	}
	if !hasKind {
		return out, &cliError{msg: "error: the following required arguments were not provided:\n  --kind <KIND>"}
	}
	if !hasTopic {
		return out, &cliError{msg: "error: the following required arguments were not provided:\n  --topic <TOPIC>"}
	}
	if out.Body != nil && out.BodyFile != nil {
		return out, &cliError{msg: "error: the argument '--body <BODY>' cannot be used with '--body-file <BODY_FILE>'"}
	}
	if out.Body == nil && out.BodyFile == nil {
		return out, &cliError{msg: "error: the following required arguments were not provided:\n  --body <BODY>"}
	}
	return out, nil
}

func parseTakeArgs(args []string) (string, string, bool, error) {
	var session, cwd string
	var hasSession, hold bool
	for i := 0; i < len(args); i++ {
		flag, inline, hasEq := splitFlag(args[i])
		if flag == "-h" || flag == "--help" {
			return "", "", false, &cliHelp{text: "Usage: dev-agent-bridge take --session <SESSION> [--cwd <CWD>] [--hold]"}
		}
		getVal := func() (string, error) {
			if hasEq {
				return inline, nil
			}
			v, ni, err := nextFlagValue(args, i, flag)
			i = ni
			return v, err
		}
		switch flag {
		case "--session":
			v, err := getVal()
			if err != nil {
				return "", "", false, err
			}
			session = v
			hasSession = true
		case "--cwd":
			v, err := getVal()
			if err != nil {
				return "", "", false, err
			}
			cwd = v
		case "--hold":
			if hasEq {
				return "", "", false, &cliError{msg: "error: unexpected value for '--hold'"}
			}
			hold = true
		default:
			return "", "", false, &cliError{msg: fmt.Sprintf("error: unexpected argument '%s' found", args[i])}
		}
	}
	if !hasSession {
		return "", "", false, &cliError{msg: "error: the following required arguments were not provided:\n  --session <SESSION>"}
	}
	return session, cwd, hold, nil
}

func parseListenArgs(args []string) (string, string, error) {
	var session, cwd string
	var hasSession bool
	for i := 0; i < len(args); i++ {
		flag, inline, hasEq := splitFlag(args[i])
		if flag == "-h" || flag == "--help" {
			return "", "", &cliHelp{text: "Usage: dev-agent-bridge listen --session <SESSION> [--cwd <CWD>]"}
		}
		getVal := func() (string, error) {
			if hasEq {
				return inline, nil
			}
			v, ni, err := nextFlagValue(args, i, flag)
			i = ni
			return v, err
		}
		switch flag {
		case "--session":
			v, err := getVal()
			if err != nil {
				return "", "", err
			}
			session = v
			hasSession = true
		case "--cwd":
			v, err := getVal()
			if err != nil {
				return "", "", err
			}
			cwd = v
		default:
			return "", "", &cliError{msg: fmt.Sprintf("error: unexpected argument '%s' found", args[i])}
		}
	}
	if !hasSession {
		return "", "", &cliError{msg: "error: the following required arguments were not provided:\n  --session <SESSION>"}
	}
	return session, cwd, nil
}

func parseReleaseArgs(args []string) (string, error) {
	var session string
	var hasSession bool
	for i := 0; i < len(args); i++ {
		flag, inline, hasEq := splitFlag(args[i])
		if flag == "-h" || flag == "--help" {
			return "", &cliHelp{text: "Usage: dev-agent-bridge release --session <SESSION>"}
		}
		getVal := func() (string, error) {
			if hasEq {
				return inline, nil
			}
			v, ni, err := nextFlagValue(args, i, flag)
			i = ni
			return v, err
		}
		switch flag {
		case "--session":
			v, err := getVal()
			if err != nil {
				return "", err
			}
			session = v
			hasSession = true
		default:
			return "", &cliError{msg: fmt.Sprintf("error: unexpected argument '%s' found", args[i])}
		}
	}
	if !hasSession {
		return "", &cliError{msg: "error: the following required arguments were not provided:\n  --session <SESSION>"}
	}
	return session, nil
}

func main() {
	out, code, errText := runCLI(os.Args[1:], currentEnv(), os.Stdin)
	if errText != "" {
		fmt.Fprintln(os.Stderr, errText)
	}
	if out != "" {
		fmt.Println(out)
	}
	os.Exit(code)
}
