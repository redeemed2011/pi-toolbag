package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type SendArgs struct {
	Kind     string
	Topic    string
	Body     *string
	BodyFile *string
	ReplyTo  *string
	Ctx      []string
	Commit   *string
	File     *string
	ID       *string
	DryRun   bool
	Session  *string
}

type Secrets struct {
	URL string
	Key string
}

var bearerPattern = regexp.MustCompile(`(?i)(bearer)\s+\S+`)

func loadSecrets(path string) (Secrets, *BridgeError) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return Secrets{}, newError(3, fmt.Sprintf("secrets file not found: %s", path))
	}
	invalid := func() *BridgeError {
		return newError(3, fmt.Sprintf("secrets file is not valid JSON: %s", path))
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Secrets{}, invalid()
	}
	text := strings.TrimPrefix(string(raw), "\ufeff")
	var val any
	if err := json.Unmarshal([]byte(text), &val); err != nil {
		return Secrets{}, invalid()
	}
	obj, _ := val.(map[string]any)
	field := func(name string) string {
		if obj == nil {
			return ""
		}
		s, _ := obj[name].(string)
		return strings.TrimSpace(s)
	}
	u, k := field("url"), field("key")
	low := strings.ToLower(k)
	if !strings.HasPrefix(u, "https://") || k == "" || low == "replace" || low == "replace-me" || low == "changeme" {
		return Secrets{}, newError(3, fmt.Sprintf("secrets file needs an https url and a key: %s", path))
	}
	return Secrets{URL: u, Key: k}, nil
}

func redact(text string, key string) string {
	out := text
	if key != "" {
		out = strings.ReplaceAll(out, key, "<redacted>")
	}
	out = bearerPattern.ReplaceAllString(out, "${1} <redacted>")
	runes := []rune(out)
	if len(runes) > 300 {
		return string(runes[:300])
	}
	return out
}

func readBody(args SendArgs, stdin io.Reader) (string, *BridgeError) {
	if args.Body != nil && args.BodyFile == nil {
		return *args.Body, nil
	}
	if args.Body == nil && args.BodyFile != nil {
		if *args.BodyFile == "-" {
			data, err := io.ReadAll(stdin)
			if err != nil {
				return "", newError(2, fmt.Sprintf("cannot read stdin: %v", err))
			}
			return string(data), nil
		}
		data, err := os.ReadFile(*args.BodyFile)
		if err != nil {
			return "", newError(2, fmt.Sprintf("cannot read --body-file: %v", err))
		}
		return strings.TrimPrefix(string(data), "\ufeff"), nil
	}
	return "", newError(2, "give exactly one of --body or --body-file")
}

func postWebhook(secrets Secrets, msg *Message) (int, *BridgeError) {
	body, err := marshalJSON(msg)
	if err != nil {
		return 0, newError(2, err.Error())
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequest(http.MethodPost, secrets.URL, bytes.NewReader(body))
	if err != nil {
		return 0, newError(6, fmt.Sprintf("webhook POST failed: %s", redact(err.Error(), secrets.Key)))
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+secrets.Key)
	req.Header.Set("X-Automation-Key", secrets.Key)
	resp, err := client.Do(req)
	if err != nil {
		return 0, newError(6, fmt.Sprintf("webhook POST failed: %s", redact(err.Error(), secrets.Key)))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return 0, newError(6, fmt.Sprintf("webhook answered HTTP %d: %s", resp.StatusCode, redact(string(raw), secrets.Key)))
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

func runSend(env Env, args SendArgs, stdin io.Reader) (string, *BridgeError) {
	body, berr := readBody(args, stdin)
	if berr != nil {
		return "", berr
	}
	msg := buildMessage(Draft{
		From:    devAgent,
		To:      engLead,
		Topic:   args.Topic,
		Kind:    args.Kind,
		Body:    body,
		ReplyTo: args.ReplyTo,
		Ctx:     args.Ctx,
		Commit:  args.Commit,
		File:    args.File,
		ID:      args.ID,
	})
	if errs := validateMessage(&msg); len(errs) > 0 {
		return "", newError(2, fmt.Sprintf("invalid message: %s", strings.Join(errs, "; ")))
	}
	secretsPath := env.secretsPath()
	serialized, _ := marshalJSON(&msg)
	carriesKey := func(key string) bool {
		return key != "" && strings.Contains(string(serialized), key)
	}
	pieces := splitBody(msg.Body)
	if args.DryRun {
		secrets, serr := loadSecrets(secretsPath)
		if serr == nil && carriesKey(secrets.Key) {
			return "", newError(2, "message contains the sender key; remove it")
		}
		statusLine := fmt.Sprintf("secrets: ok (%s)", secretsPath)
		if serr != nil {
			statusLine = fmt.Sprintf("secrets: %s", serr.Message)
		}
		pretty, _ := marshalJSONIndent(&msg)
		return fmt.Sprintf(
			"%s\nheaders: Authorization=Bearer <redacted>; X-Automation-Key=<redacted>\n%s\nparts: %d\ndry run: nothing sent or recorded",
			string(pretty),
			statusLine,
			len(pieces),
		), nil
	}
	secrets, serr := loadSecrets(secretsPath)
	if serr != nil {
		return "", serr
	}
	if carriesKey(secrets.Key) {
		return "", newError(2, "message contains the sender key; remove it")
	}
	stateDir, berr := env.stateDir()
	if berr != nil {
		return "", berr
	}
	stateFile := filepath.Join(stateDir, "send-state.json")
	state := loadSendState(stateFile)
	now := nowTS()
	state.prune(now)
	if berr := state.check(&msg, now); berr != nil {
		return "", berr
	}
	saved := msg
	copyPath := filepath.Join(env.bridgeShare(), "from-dev-agent", saved.ID+".json")
	if err := os.MkdirAll(filepath.Dir(copyPath), 0o755); err != nil {
		return "", newError(7, fmt.Sprintf("cannot save the full message: %v", err))
	}
	savedBytes, _ := marshalJSON(&saved)
	if err := writeAtomic(copyPath, savedBytes); err != nil {
		return "", newError(7, fmt.Sprintf("cannot save the full message: %v", err))
	}
	count := uint32(len(pieces))
	status := 0
	for i, piece := range pieces {
		part := saved
		part.Body = piece
		if count > 1 {
			p := uint32(i + 1)
			c := count
			part.Part = &p
			part.Parts = &c
		}
		st, perr := postWebhook(secrets, &part)
		if perr != nil {
			return "", perr
		}
		status = st
	}
	state.record(&saved, now)
	if berr := state.save(stateFile); berr != nil {
		return "", berr
	}
	var sessionPtr *string
	rawSession := ""
	if args.Session != nil {
		rawSession = *args.Session
	} else {
		rawSession = env.getVar("DEV_AGENT_BRIDGE_SESSION")
	}
	if trimmed := strings.TrimSpace(rawSession); trimmed != "" {
		sessionPtr = &trimmed
		if berr := rememberRoute(env, trimmed, msg.ID, msg.Topic); berr != nil {
			return "", berr
		}
	}
	entry := map[string]any{
		"logged_at": nowISO(),
		"direction": "to-engineering-lead",
		"status":    status,
		"session":   sessionPtr,
		"message":   msg,
	}
	logPath, berr := appendLog(env, entry)
	if berr != nil {
		return "", berr
	}
	return fmt.Sprintf("sent %s kind=%s topic=%s http=%d log=%s", msg.ID, msg.Kind, msg.Topic, status, logPath), nil
}
