package ctx

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

type SyncPaths struct {
	Store string
	Git   string
	State string
}

var readyPath = regexp.MustCompile(`^projects/([^/]+)/(project\.json|logs/[^/]+\.jsonl|blobs/([0-9a-f]{64}))$`)

func Sync(paths SyncPaths, device string) error {
	if device == "" {
		name, err := os.Hostname()
		if err != nil {
			return err
		}
		device = name
	}
	if err := os.MkdirAll(paths.State, 0o700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(paths.State, "lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	run := &syncRun{paths: paths, device: device}
	if st, err := os.Stat(paths.Git); err != nil || !st.IsDir() {
		return run.finish(fmt.Sprintf("No sync repository at %s. Run the ctx-sync install script.", paths.Git))
	}
	if err := os.MkdirAll(filepath.Join(paths.Store, "projects"), 0o755); err != nil {
		return err
	}
	if err := run.stage(); err != nil {
		return run.finish("Local records could not be committed.")
	}
	for attempt := 1; attempt <= 3; attempt++ {
		if out, err := run.git("fetch", "-q", "origin"); err != nil {
			return run.finish("ctx-store could not be reached: " + oneLine(out) + ". Local records are kept and go next run.")
		}
		if message, err := run.mergeRemote(); err != nil {
			return run.finish(message)
		}
		if !run.has("HEAD") {
			return run.finish("")
		}
		if run.has("refs/remotes/origin/master") && run.rev("HEAD") == run.rev("refs/remotes/origin/master") {
			return run.finish("")
		}
		if out, err := run.git("push", "-q", "--no-verify", "origin", "HEAD:refs/heads/master"); err == nil {
			_, _ = run.git("fetch", "-q", "origin")
			return run.finish("")
		} else if attempt == 3 {
			return run.finish("ctx-store refused the push 3 times: " + oneLine(out) + ". Local records are kept and go next run.")
		}
	}
	return run.finish("")
}

type syncRun struct {
	paths   SyncPaths
	device  string
	skipped []string
}

func (s *syncRun) git(args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{
		"--git-dir", s.paths.Git,
		"--work-tree", s.paths.Store,
		"--literal-pathspecs",
		"-c", "core.hooksPath=/dev/null",
		"-c", "core.excludesFile=/dev/null",
		"-c", "core.fsmonitor=false",
	}, args...)...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (s *syncRun) has(ref string) bool {
	_, err := s.git("rev-parse", "-q", "--verify", ref)
	return err == nil
}

func (s *syncRun) rev(ref string) string {
	out, _ := s.git("rev-parse", ref)
	return strings.TrimSpace(out)
}

func (s *syncRun) stage() error {
	out, err := s.git("ls-files", "-z", "--others", "--modified", "--", "projects")
	if err != nil {
		if s.has("HEAD") {
			return err
		}
		out = ""
	}
	paths := strings.Split(out, "\x00")
	ready := []string{}
	for _, path := range paths {
		if path == "" {
			continue
		}
		if s.ready(path) {
			ready = append(ready, path)
		}
	}
	if len(ready) > 0 {
		list := filepath.Join(s.paths.State, "stage.list")
		if err := os.WriteFile(list, []byte(strings.Join(ready, "\x00")+"\x00"), 0o600); err != nil {
			return err
		}
		if _, err := s.git("add", "-f", "--pathspec-from-file="+list, "--pathspec-file-nul"); err != nil {
			return err
		}
	}
	if _, err := s.git("diff", "--cached", "--quiet"); err != nil {
		if _, err := s.git("commit", "-q", "--no-verify", "-m", "ctx-sync: "+s.device+" "+time.Now().UTC().Format("2006-01-02T15:04:05Z")); err != nil {
			return err
		}
	}
	return nil
}

func (s *syncRun) ready(path string) bool {
	match := readyPath.FindStringSubmatch(path)
	if match == nil {
		return false
	}
	full := filepath.Join(s.paths.Store, path)
	info, err := os.Lstat(full)
	if err != nil || info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	parent, err := os.Lstat(filepath.Dir(full))
	if err != nil || parent.Mode()&os.ModeSymlink != 0 {
		return false
	}
	if !s.projectSynced(match[1]) {
		return false
	}
	if strings.HasSuffix(path, ".jsonl") {
		raw, err := os.ReadFile(full)
		if err != nil {
			return false
		}
		if len(raw) > 0 && raw[len(raw)-1] != '\n' {
			s.skipped = append(s.skipped, path+" (its last line is unfinished)")
			return false
		}
		if !s.logGrows(path) {
			s.skipped = append(s.skipped, path+" (it was rewritten, not appended)")
			return false
		}
	}
	if blob := match[3]; blob != "" {
		sum, err := fileSHA(full)
		if err != nil || sum != blob {
			s.skipped = append(s.skipped, path+" (its bytes do not match its name yet)")
			return false
		}
	}
	return true
}

func (s *syncRun) projectSynced(id string) bool {
	meta := filepath.Join(s.paths.Store, "projects", id, "project.json")
	info, err := os.Lstat(meta)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	dir, err := os.Lstat(filepath.Join(s.paths.Store, "projects", id))
	if err != nil || dir.Mode()&os.ModeSymlink != 0 {
		return false
	}
	raw, err := os.ReadFile(meta)
	if err != nil {
		return false
	}
	return !regexp.MustCompile(`"sync"[[:space:]]*:[[:space:]]*false`).Match(raw)
}

func (s *syncRun) logGrows(path string) bool {
	if !s.has("HEAD:" + path) {
		return true
	}
	old, err := s.git("cat-file", "blob", "HEAD:"+path)
	if err != nil {
		return true
	}
	raw, err := os.ReadFile(filepath.Join(s.paths.Store, path))
	if err != nil || len(raw) < len(old) {
		return false
	}
	return bytes.Equal([]byte(old), raw[:len(old)])
}

func (s *syncRun) mergeRemote() (string, error) {
	if !s.has("refs/remotes/origin/master") {
		return "", nil
	}
	if !s.has("HEAD") {
		if out, err := s.git("merge", "-q", "--ff-only", "refs/remotes/origin/master"); err != nil {
			return "The first merge from ctx-store stopped: " + oneLine(out), err
		}
		return "", nil
	}
	out, err := s.git("merge", "-q", "--no-edit", "--no-verify", "--allow-unrelated-histories", "refs/remotes/origin/master")
	if err == nil {
		return "", nil
	}
	clash, _ := s.git("diff", "--name-only", "--diff-filter=U")
	if s.has("MERGE_HEAD") {
		_, _ = s.git("merge", "--abort")
	}
	clash = strings.TrimSpace(strings.ReplaceAll(clash, "\n", " "))
	if clash != "" {
		return "The merge from ctx-store stopped on a clash in " + clash + ". Nothing was forced. Local records are kept and still unpushed.", err
	}
	return "The merge from ctx-store stopped: " + oneLine(out), err
}

func (s *syncRun) finish(message string) error {
	stamp := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	successPath := filepath.Join(s.paths.State, "last-success")
	if message == "" {
		_ = os.WriteFile(successPath, []byte(stamp+"\n"), 0o644)
	}
	success := ""
	if raw, err := os.ReadFile(successPath); err == nil {
		success = strings.TrimSpace(string(raw))
	}
	note := ""
	if len(s.skipped) > 0 {
		note = "Not synced this run: " + strings.Join(s.skipped, " ")
	}
	body, err := json.Marshal(map[string]any{
		"device":       s.device,
		"last_run":     stamp,
		"last_success": success,
		"last_error":   message,
		"unpushed":     s.unpushed(),
		"held_back":    note,
	})
	if err != nil {
		return err
	}
	status := filepath.Join(s.paths.State, "status.json")
	if err := os.WriteFile(status+".tmp", append(body, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Rename(status+".tmp", status); err != nil {
		return err
	}
	if message != "" {
		return fmt.Errorf("%s", message)
	}
	return nil
}

func (s *syncRun) unpushed() int {
	if !s.has("HEAD") {
		return 0
	}
	ref := "HEAD"
	if s.has("refs/remotes/origin/master") {
		ref = "refs/remotes/origin/master..HEAD"
	}
	out, err := s.git("rev-list", "--count", ref)
	if err != nil {
		return 0
	}
	n := 0
	fmt.Sscan(strings.TrimSpace(out), &n)
	return n
}

func fileSHA(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func oneLine(text string) string {
	text = strings.ReplaceAll(text, "\n", " ")
	return strings.TrimSpace(text)
}
