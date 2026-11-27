package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	leaseS           = 30.0
	presentS         = 30.0
	unreadableGraceS = 60.0
	routesKept       = 500
)

type Routes struct {
	Asks   [][2]string `json:"asks"`
	Topics [][2]string `json:"topics"`
}

func findRoute(list [][2]string, key string) (string, bool) {
	for i := len(list) - 1; i >= 0; i-- {
		if list[i][0] == key {
			return list[i][1], true
		}
	}
	return "", false
}

func (r Routes) addressee(msg *Message) (string, bool) {
	if msg.ReplyTo != nil {
		if s, ok := findRoute(r.Asks, *msg.ReplyTo); ok {
			return s, true
		}
	}
	return findRoute(r.Topics, msg.Topic)
}

func putRoute(list [][2]string, key, session string) [][2]string {
	out := make([][2]string, 0, len(list)+1)
	for _, pair := range list {
		if pair[0] != key {
			out = append(out, pair)
		}
	}
	out = append(out, [2]string{key, session})
	if len(out) > routesKept {
		out = out[len(out)-routesKept:]
	}
	return out
}

type Lease struct {
	Session   string  `json:"session"`
	Cwd       string  `json:"cwd"`
	Heartbeat float64 `json:"heartbeat"`
}

type Owner struct {
	Session string `json:"session"`
}

type Delivered struct {
	ID      string  `json:"id"`
	Kind    string  `json:"kind"`
	Topic   string  `json:"topic"`
	Text    string  `json:"text"`
	Message Message `json:"message"`
}

type Rejected struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

type Taken struct {
	Listener bool        `json:"listener"`
	Holder   *Lease      `json:"holder,omitempty"`
	Messages []Delivered `json:"messages"`
	Rejected []Rejected  `json:"rejected"`
}

type inboxPaths struct {
	inbox     string
	lease     string
	owner     string
	delivered string
	rejected  string
	routes    string
	present   string
}

func getInboxPaths(env Env) (inboxPaths, *BridgeError) {
	state, berr := env.stateDir()
	if berr != nil {
		return inboxPaths{}, berr
	}
	delivered := filepath.Join(state, "delivered")
	rejected := filepath.Join(state, "rejected")
	present := filepath.Join(state, "present")
	for _, dir := range []string{delivered, rejected, present} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return inboxPaths{}, newError(7, fmt.Sprintf("cannot create %s: %v", dir, err))
		}
	}
	return inboxPaths{
		inbox:     env.inbox(),
		lease:     filepath.Join(state, "listener.json"),
		owner:     filepath.Join(state, "owner.json"),
		delivered: delivered,
		rejected:  rejected,
		routes:    filepath.Join(state, "routes.json"),
		present:   present,
	}, nil
}

func readJSONFile[T any](path string) (T, bool) {
	var zero T
	raw, err := os.ReadFile(path)
	if err != nil {
		return zero, false
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return zero, false
	}
	return out, true
}

func saveJSONFile(path string, value any) *BridgeError {
	data, _ := marshalJSON(value)
	if err := writeAtomic(path, data); err != nil {
		return newError(7, fmt.Sprintf("cannot write %s: %v", path, err))
	}
	return nil
}

func readRoutes(path string) Routes {
	r, ok := readJSONFile[Routes](path)
	if !ok {
		return Routes{Asks: [][2]string{}, Topics: [][2]string{}}
	}
	if r.Asks == nil {
		r.Asks = [][2]string{}
	}
	if r.Topics == nil {
		r.Topics = [][2]string{}
	}
	return r
}

func rememberRoute(env Env, session, id, topic string) *BridgeError {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return berr
	}
	routes := readRoutes(p.routes)
	routes.Asks = putRoute(routes.Asks, id, session)
	routes.Topics = putRoute(routes.Topics, topic, session)
	return saveJSONFile(p.routes, &routes)
}

func presenceFile(p inboxPaths, session string) string {
	name := hex.EncodeToString([]byte(session))
	if len(name) > 200 {
		name = name[:200]
	}
	return filepath.Join(p.present, name+".json")
}

func markPresent(p inboxPaths, session, cwd string, now float64) *BridgeError {
	return saveJSONFile(presenceFile(p, session), &Lease{Session: session, Cwd: cwd, Heartbeat: now})
}

func isPresent(p inboxPaths, session string, now float64) bool {
	seen, ok := readJSONFile[Lease](presenceFile(p, session))
	return ok && seen.Session == session && now-seen.Heartbeat <= presentS
}

func claimMarker(dir, id, note string) (bool, *BridgeError) {
	f, err := os.OpenFile(filepath.Join(dir, id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return false, nil
		}
		return false, newError(7, fmt.Sprintf("cannot record %s in %s: %v", id, dir, err))
	}
	defer f.Close()
	_, _ = f.WriteString(note)
	return true, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func mayHold(lease *Lease, owner *Owner, session string, now float64) bool {
	if lease == nil {
		return true
	}
	return lease.Session == session || now-lease.Heartbeat > leaseS || (owner != nil && owner.Session == session)
}

func runListen(env Env, session, cwd string) (string, *BridgeError) {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return "", berr
	}
	if berr := saveJSONFile(p.owner, &Owner{Session: session}); berr != nil {
		return "", berr
	}
	if berr := saveJSONFile(p.lease, &Lease{Session: session, Cwd: cwd, Heartbeat: nowTS()}); berr != nil {
		return "", berr
	}
	return fmt.Sprintf("Engineering Lead messages now arrive in session %s (%s).", session, cwd), nil
}

func runRelease(env Env, session string) (string, *BridgeError) {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return "", berr
	}
	_ = os.Remove(presenceFile(p, session))
	if lease, ok := readJSONFile[Lease](p.lease); ok && lease.Session == session {
		_ = os.Remove(p.lease)
		return "released", nil
	}
	return "not the listener", nil
}

type inboxFile struct {
	mtime int64
	id    string
	path  string
}

func listInboxFiles(inboxDir string) []inboxFile {
	entries, err := os.ReadDir(inboxDir)
	if err != nil {
		return nil
	}
	var files []inboxFile
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !isMessageID(id) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, inboxFile{
			mtime: info.ModTime().UnixNano(),
			id:    id,
			path:  filepath.Join(inboxDir, name),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].mtime != files[j].mtime {
			return files[i].mtime < files[j].mtime
		}
		return files[i].id < files[j].id
	})
	return files
}

func fileAgeS(path string, now float64) float64 {
	info, err := os.Stat(path)
	if err != nil {
		return math.MaxFloat64
	}
	return now - float64(info.ModTime().UnixNano())/1e9
}

type StatusReport struct {
	Inbox    string `json:"inbox"`
	Listener *Lease `json:"listener"`
	Owner    *Owner `json:"owner"`
	Waiting  int    `json:"waiting"`
}

func runStatus(env Env) (StatusReport, *BridgeError) {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return StatusReport{}, berr
	}
	now := nowTS()
	var leasePtr *Lease
	if lease, ok := readJSONFile[Lease](p.lease); ok && now-lease.Heartbeat <= leaseS {
		l := lease
		leasePtr = &l
	}
	var ownerPtr *Owner
	if owner, ok := readJSONFile[Owner](p.owner); ok {
		o := owner
		ownerPtr = &o
	}
	waiting := 0
	for _, f := range listInboxFiles(p.inbox) {
		if !fileExists(filepath.Join(p.delivered, f.id)) && !fileExists(filepath.Join(p.rejected, f.id)) {
			waiting++
		}
	}
	return StatusReport{
		Inbox:    p.inbox,
		Listener: leasePtr,
		Owner:    ownerPtr,
		Waiting:  waiting,
	}, nil
}

func runHold(env Env, session, cwd string) (Taken, *BridgeError) {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return Taken{}, berr
	}
	now := nowTS()
	if berr := markPresent(p, session, cwd, now); berr != nil {
		return Taken{}, berr
	}
	var leasePtr *Lease
	if lease, ok := readJSONFile[Lease](p.lease); ok {
		l := lease
		leasePtr = &l
	}
	var ownerPtr *Owner
	if owner, ok := readJSONFile[Owner](p.owner); ok {
		o := owner
		ownerPtr = &o
	}
	if !mayHold(leasePtr, ownerPtr, session, now) {
		return Taken{Listener: false, Holder: leasePtr, Messages: []Delivered{}, Rejected: []Rejected{}}, nil
	}
	if berr := saveJSONFile(p.lease, &Lease{Session: session, Cwd: cwd, Heartbeat: now}); berr != nil {
		return Taken{}, berr
	}
	return Taken{Listener: true, Messages: []Delivered{}, Rejected: []Rejected{}}, nil
}

func runTake(env Env, session, cwd string) (Taken, *BridgeError) {
	p, berr := getInboxPaths(env)
	if berr != nil {
		return Taken{}, berr
	}
	now := nowTS()
	if berr := markPresent(p, session, cwd, now); berr != nil {
		return Taken{}, berr
	}
	var leasePtr *Lease
	if lease, ok := readJSONFile[Lease](p.lease); ok {
		l := lease
		leasePtr = &l
	}
	var ownerPtr *Owner
	if owner, ok := readJSONFile[Owner](p.owner); ok {
		o := owner
		ownerPtr = &o
	}
	holds := mayHold(leasePtr, ownerPtr, session, now)
	if holds {
		if berr := saveJSONFile(p.lease, &Lease{Session: session, Cwd: cwd, Heartbeat: now}); berr != nil {
			return Taken{}, berr
		}
	}
	routes := readRoutes(p.routes)
	var holder *Lease
	if !holds {
		holder = leasePtr
	}
	taken := Taken{
		Listener: holds,
		Holder:   holder,
		Messages: []Delivered{},
		Rejected: []Rejected{},
	}
	for _, f := range listInboxFiles(p.inbox) {
		if fileExists(filepath.Join(p.delivered, f.id)) || fileExists(filepath.Join(p.rejected, f.id)) {
			continue
		}
		rawBytes, err := os.ReadFile(f.path)
		if err != nil {
			continue
		}
		raw := strings.TrimPrefix(string(rawBytes), "\ufeff")
		msg, reason := parseIncoming(raw)
		if reason == "" && msg.ID != f.id {
			reason = fmt.Sprintf("the file name does not match its id %s", msg.ID)
		}
		if reason != "" {
			if !holds {
				continue
			}
			if reason == "the file is not valid JSON" && fileAgeS(f.path, now) < unreadableGraceS {
				continue
			}
			claimed, cerr := claimMarker(p.rejected, f.id, reason)
			if cerr != nil {
				return Taken{}, cerr
			}
			if claimed {
				taken.Rejected = append(taken.Rejected, Rejected{File: f.path, Reason: reason})
			}
			continue
		}
		if intErr := integrityError(&msg); intErr != "" {
			if holds {
				claimed, cerr := claimMarker(p.rejected, f.id, intErr)
				if cerr != nil {
					return Taken{}, cerr
				}
				if claimed {
					taken.Rejected = append(taken.Rejected, Rejected{File: f.path, Reason: intErr})
					bodyCopy := intErr
					sessCopy := session
					_, _ = runSend(env, SendArgs{
						Kind:    "note",
						Topic:   "bridge-body",
						Body:    &bodyCopy,
						Session: &sessCopy,
					}, bytes.NewReader(nil))
				}
			}
			continue
		}
		mine := false
		if to, ok := routes.addressee(&msg); ok {
			if to == session {
				mine = true
			} else if msg.Kind == "reply" {
				mine = false
			} else {
				mine = holds && !isPresent(p, to, now)
			}
		} else {
			mine = holds
		}
		if !mine {
			continue
		}
		claimed, cerr := claimMarker(p.delivered, f.id, session)
		if cerr != nil {
			return Taken{}, cerr
		}
		if !claimed {
			continue
		}
		entry := map[string]any{
			"logged_at": nowISO(),
			"direction": "to-dev-agent",
			"via":       "inbox",
			"session":   session,
			"message":   msg,
		}
		_, _ = appendLog(env, entry)
		taken.Messages = append(taken.Messages, Delivered{
			ID:      msg.ID,
			Kind:    msg.Kind,
			Topic:   msg.Topic,
			Text:    frameMessage(&msg),
			Message: msg,
		})
	}
	return taken, nil
}
