package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	rateLimit   = 20
	rateWindowS = 3600.0
	keepStateS  = 30.0 * 24.0 * 3600.0
)

type BridgeError struct {
	Code    int
	Message string
}

func (e *BridgeError) Error() string {
	return e.Message
}

func newError(code int, msg string) *BridgeError {
	return &BridgeError{Code: code, Message: msg}
}

type Env struct {
	Home string
	Vars map[string]string
}

func currentEnv() Env {
	vars := make(map[string]string)
	for _, kv := range os.Environ() {
		if k, v, ok := strings.Cut(kv, "="); ok {
			vars[k] = v
		}
	}
	home := vars["HOME"]
	if home == "" {
		home = "/"
	}
	return Env{Home: home, Vars: vars}
}

func (e Env) getVar(name string) string {
	return e.Vars[name]
}

func (e Env) shareRoot() string {
	return filepath.Join(e.Home, "ResilioSync", "BnBShare")
}

func (e Env) bridgeShare() string {
	return filepath.Join(e.shareRoot(), "grokbot", "engineering-lead", "dev-agent-bridge")
}

func (e Env) secretsPath() string {
	if v := e.getVar("DEV_AGENT_BRIDGE_SECRETS"); v != "" {
		return v
	}
	return filepath.Join(e.shareRoot(), "secrets", "dev-agent-bridge-webhook.json")
}

func (e Env) inbox() string {
	if v := e.getVar("DEV_AGENT_BRIDGE_INBOX"); v != "" {
		return v
	}
	return filepath.Join(e.bridgeShare(), "inbox")
}

func (e Env) sharedLog() string {
	if v := e.getVar("DEV_AGENT_BRIDGE_LOG"); v != "" {
		return v
	}
	return filepath.Join(e.bridgeShare(), "log.jsonl")
}

func (e Env) stateDir() (string, *BridgeError) {
	var candidates []string
	if v := e.getVar("DEV_AGENT_BRIDGE_STATE"); v != "" {
		candidates = []string{v}
	} else {
		xdg := e.getVar("XDG_STATE_HOME")
		if xdg == "" {
			xdg = filepath.Join(e.Home, ".local", "state")
		}
		candidates = []string{
			filepath.Join(e.Home, ".cache", "dev-agent-bridge"),
			filepath.Join(xdg, "dev-agent-bridge"),
		}
	}
	for _, dir := range candidates {
		if writableDir(dir) {
			return dir, nil
		}
	}
	return "", newError(7, "no writable state folder; set DEV_AGENT_BRIDGE_STATE")
}

func writableDir(dir string) bool {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false
	}
	probe := filepath.Join(dir, fmt.Sprintf(".probe-%d", os.Getpid()))
	err := os.WriteFile(probe, []byte("x"), 0o644)
	_ = os.Remove(probe)
	return err == nil
}

func nowTS() float64 {
	return float64(time.Now().UnixNano()) / 1e9
}

func writeAtomic(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

type Sent struct {
	ID      string  `json:"id"`
	TS      float64 `json:"ts"`
	Kind    string  `json:"kind"`
	ReplyTo *string `json:"reply_to"`
	Topic   string  `json:"topic"`
}

type SendState struct {
	Sent []Sent `json:"sent"`
}

func loadSendState(path string) SendState {
	raw, err := os.ReadFile(path)
	if err != nil {
		return SendState{Sent: []Sent{}}
	}
	text := strings.TrimPrefix(string(raw), "\ufeff")
	var st SendState
	if err := json.Unmarshal([]byte(text), &st); err != nil {
		return SendState{Sent: []Sent{}}
	}
	if st.Sent == nil {
		st.Sent = []Sent{}
	}
	return st
}

func (s *SendState) save(path string) *BridgeError {
	if s.Sent == nil {
		s.Sent = []Sent{}
	}
	data, err := marshalJSONIndent(s)
	if err != nil {
		return newError(7, err.Error())
	}
	if err := writeAtomic(path, data); err != nil {
		return newError(7, fmt.Sprintf("cannot save %s: %v", path, err))
	}
	return nil
}

func (s *SendState) prune(now float64) {
	kept := s.Sent[:0]
	for _, item := range s.Sent {
		if now-item.TS < keepStateS {
			kept = append(kept, item)
		}
	}
	s.Sent = kept
}

func (s *SendState) check(msg *Message, now float64) *BridgeError {
	recent := 0
	for _, item := range s.Sent {
		if item.ID == msg.ID {
			return newError(5, fmt.Sprintf("message %s was already sent; not sending it again", msg.ID))
		}
		if msg.Kind == "reply" && item.ReplyTo != nil && msg.ReplyTo != nil && *item.ReplyTo == *msg.ReplyTo {
			return newError(5, fmt.Sprintf("ask %s already has a reply; one reply per ask", *msg.ReplyTo))
		}
		if now-item.TS < rateWindowS {
			recent++
		}
	}
	if recent >= rateLimit {
		return newError(4, fmt.Sprintf("rate cap: %d messages in the last hour; try later", rateLimit))
	}
	return nil
}

func (s *SendState) record(msg *Message, now float64) {
	var replyCopy *string
	if msg.ReplyTo != nil {
		v := *msg.ReplyTo
		replyCopy = &v
	}
	s.Sent = append(s.Sent, Sent{
		ID:      msg.ID,
		TS:      now,
		Kind:    msg.Kind,
		ReplyTo: replyCopy,
		Topic:   msg.Topic,
	})
}

func appendLine(path string, line []byte) error {
	if parent := filepath.Dir(path); parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return err
		}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(line)
	return err
}

func appendLog(env Env, entry any) (string, *BridgeError) {
	encoded, err := marshalJSON(entry)
	if err != nil {
		return "", newError(7, err.Error())
	}
	line := append(encoded, '\n')
	shared := env.sharedLog()
	if appendLine(shared, line) == nil {
		return shared, nil
	}
	stateDir, berr := env.stateDir()
	if berr != nil {
		return "", berr
	}
	local := filepath.Join(stateDir, "log.jsonl")
	if err := appendLine(local, line); err != nil {
		return "", newError(7, fmt.Sprintf("cannot write %s: %v", local, err))
	}
	return local, nil
}
