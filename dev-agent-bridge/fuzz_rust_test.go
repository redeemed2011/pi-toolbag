package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	cryptorand "crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func findRustBridge(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("DEV_AGENT_BRIDGE_RUST_BIN"); p != "" {
		if fileExists(p) {
			return p
		}
		t.Fatalf("DEV_AGENT_BRIDGE_RUST_BIN set to %q but file does not exist", p)
	}
	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(cwd, "target", "release", "dev-agent-bridge"),
		filepath.Join(cwd, "target", "debug", "dev-agent-bridge"),
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".cargo", "bin", "dev-agent-bridge"))
	}
	for _, c := range candidates {
		if fileExists(c) {
			// Verify it is actually the Rust binary (not already replaced by Go)
			out, _ := exec.Command("strings", c).Output()
			if bytes.Contains(out, []byte("rustc")) || bytes.Contains(out, []byte("clap")) {
				return c
			}
		}
	}
	if fileExists(filepath.Join(cwd, "Cargo.toml")) {
		cargoPath, err := exec.LookPath("cargo")
		if err != nil {
			if home, herr := os.UserHomeDir(); herr == nil {
				p := filepath.Join(home, ".cargo", "bin", "cargo")
				if fileExists(p) {
					cargoPath = p
				}
			}
		}
		if cargoPath != "" {
			cmd := exec.Command(cargoPath, "build")
			cmd.Dir = cwd
			if out, err := cmd.CombinedOutput(); err == nil {
				bin := filepath.Join(cwd, "target", "debug", "dev-agent-bridge")
				if fileExists(bin) {
					return bin
				}
			} else {
				t.Logf("cargo build failed: %s", out)
			}
		}
	}
	t.Skip("Rust dev-agent-bridge binary not found; set DEV_AGENT_BRIDGE_RUST_BIN to run differential fuzz against Rust")
	return ""
}

func buildGoBridge(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "dev-agent-bridge-go")
	cmd := exec.Command("go", "build", "-trimpath", "-o", bin, ".")
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("go build failed: %v\n%s", err, out)
	}
	return bin
}

type cmdRes struct {
	code   int
	stdout string
	stderr string
}

func runBin(bin string, args []string, env map[string]string, stdin string) cmdRes {
	cmd := exec.Command(bin, args...)
	baseEnv := make([]string, 0, len(env)+4)
	for _, k := range []string{"PATH", "SSL_CERT_FILE", "NO_PROXY"} {
		if v, ok := os.LookupEnv(k); ok {
			baseEnv = append(baseEnv, k+"="+v)
		}
	}
	for k, v := range env {
		baseEnv = append(baseEnv, k+"="+v)
	}
	cmd.Env = baseEnv
	cmd.Stdin = strings.NewReader(stdin)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	err := cmd.Run()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	return cmdRes{code: code, stdout: outBuf.String(), stderr: errBuf.String()}
}

var (
	sentAtRe = regexp.MustCompile(`"sent_at":\s*"[^"]*"`)
	tmpDirRe = regexp.MustCompile(`/tmp/[^"\s):]+`)
)

func normDryRun(s, dir string) string {
	s = strings.ReplaceAll(s, dir, "<DIR>")
	s = sentAtRe.ReplaceAllString(s, `"sent_at": "<TS>"`)
	return s
}

func randUUID(rng *rand.Rand) string {
	const hexChars = "0123456789abcdef"
	b := make([]byte, 36)
	for i := range b {
		switch i {
		case 8, 13, 18, 23:
			b[i] = '-'
		default:
			b[i] = hexChars[rng.Intn(16)]
		}
	}
	return string(b)
}

func TestDifferentialFuzzSendDryRunAgainstRust(t *testing.T) {
	rustBin := findRustBridge(t)
	goBin := buildGoBridge(t)

	rng := rand.New(rand.NewSource(42))
	kinds := []string{"ask", "reply", "note"}
	topics := []string{
		"t", "brazos-deploy", "  padded  ", "", "   ",
		"line1\nline2", strings.Repeat("a", 80), strings.Repeat("b", 81),
		strings.Repeat("é", 80), strings.Repeat("é", 81),
	}
	secretKey := "bridge-fuzz-key-9876543210abcdef"
	bodies := []string{
		"hello",
		"   ",
		"",
		"multi\nline\tbody with \"quotes\" and \\backslash and <tags> & stuff",
		strings.Repeat(`a"b\c<d>&é`, 300),
		strings.Repeat("\x01\x08\x0c\n\r\t\"\\", 250),
		"bearer abcdefghijklmnopqrstuvwxyz",
		"api_key=1234567890abcdef",
		"-----BEGIN RSA PRIVATE KEY-----",
		"sk-1234567890abcdefghijkl",
		"ghp_1234567890abcdefghijklmnopqrstuvwxyz",
		"AKIAIOSFODNN7EXAMPLE",
		"leaked " + secretKey + " here",
	}
	commits := []string{"", " ", "abc1234", "token=1234567890abcdef"}
	files := []string{"", "foo.go", "  bar.rs  "}

	for i := 0; i < 120; i++ {
		dirR := t.TempDir()
		dirG := t.TempDir()

		secMode := rng.Intn(6)
		setupSecrets := func(dir string) string {
			p := filepath.Join(dir, "secrets.json")
			switch secMode {
			case 0:
				return p // missing
			case 1:
				_ = os.WriteFile(p, []byte("{bad"), 0o600)
			case 2:
				_ = os.WriteFile(p, []byte(`{"url":"http://127.0.0.1/h","key":"`+secretKey+`"}`), 0o600)
			case 3:
				_ = os.WriteFile(p, []byte(`{"url":"https://127.0.0.1/h","key":"changeme"}`), 0o600)
			case 4:
				_ = os.WriteFile(p, []byte("\ufeff"+`{"url":"https://127.0.0.1/h","key":"`+secretKey+`"}`), 0o600)
			case 5:
				_ = os.WriteFile(p, []byte(`{"url":"https://127.0.0.1/h","key":"`+secretKey+`"}`), 0o600)
			}
			return p
		}
		secR := setupSecrets(dirR)
		secG := setupSecrets(dirG)

		kind := kinds[rng.Intn(len(kinds))]
		topic := topics[rng.Intn(len(topics))]
		body := bodies[rng.Intn(len(bodies))]
		id := randUUID(rng)
		if rng.Intn(8) == 0 {
			id = "NOT-A-UUID"
		}
		args := []string{"send", "--kind", kind, "--topic", topic, "--id", id, "--dry-run"}
		useStdin := rng.Intn(2) == 0
		stdin := ""
		if useStdin {
			args = append(args, "--body-file", "-")
			stdin = body
		} else if strings.HasPrefix(body, "-") {
			args = append(args, "--body="+body)
		} else {
			args = append(args, "--body", body)
		}
		switch rng.Intn(4) {
		case 1:
			args = append(args, "--reply-to", randUUID(rng))
		case 2:
			args = append(args, "--reply-to", "bad-id")
		case 3:
			args = append(args, "--reply-to", "   ")
		}
		if c := commits[rng.Intn(len(commits))]; c != "" {
			args = append(args, "--commit", c)
		}
		if f := files[rng.Intn(len(files))]; f != "" {
			args = append(args, "--file", f)
		}
		for n := rng.Intn(3); n > 0; n-- {
			args = append(args, "--ctx", []string{"c1", "  ", "c2 "}[rng.Intn(3)])
		}

		envR := map[string]string{"HOME": dirR, "DEV_AGENT_BRIDGE_SECRETS": secR, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirR, "state")}
		envG := map[string]string{"HOME": dirG, "DEV_AGENT_BRIDGE_SECRETS": secG, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirG, "state")}
		resR := runBin(rustBin, args, envR, stdin)
		resG := runBin(goBin, args, envG, stdin)

		if resR.code != resG.code {
			t.Fatalf("case %d args=%q: exit code rust=%d go=%d\nrust stderr: %s\ngo stderr: %s", i, args, resR.code, resG.code, resR.stderr, resG.stderr)
		}
		if resR.code == 0 {
			outR := normDryRun(resR.stdout, dirR)
			outG := normDryRun(resG.stdout, dirG)
			if outR != outG {
				t.Fatalf("case %d dry-run stdout mismatch:\n--- RUST ---\n%s\n--- GO ---\n%s", i, outR, outG)
			}
		} else {
			errR := strings.ReplaceAll(resR.stderr, dirR, "<DIR>")
			errG := strings.ReplaceAll(resG.stderr, dirG, "<DIR>")
			if errR != errG {
				t.Fatalf("case %d stderr mismatch:\nrust: %q\ngo:   %q", i, errR, errG)
			}
		}
	}
}

func TestDifferentialFuzzLiveSendAgainstRust(t *testing.T) {
	rustBin := findRustBridge(t)
	goBin := buildGoBridge(t)

	type reqRec struct {
		auth  string
		xKey  string
		ctype string
		body  Message
	}
	var mu sync.Mutex
	var rustReqs, goReqs []reqRec
	statusCode := 200
	respBody := `{"ok":true}`
	key := "live-fuzz-secret-key-0123456789"

	// Create a real CA cert (IsCA=true) and leaf server cert (IsCA=false) so both rustls and Go verify cleanly.
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), cryptorand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "bridge-fuzz-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(cryptorand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), cryptorand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  false,
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(cryptorand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	tlsCert := tls.Certificate{
		Certificate: [][]byte{leafDER, caDER},
		PrivateKey:  leafKey,
	}

	makeHook := func(dest *[]reqRec) *httptest.Server {
		ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var m Message
			_ = json.NewDecoder(r.Body).Decode(&m)
			mu.Lock()
			*dest = append(*dest, reqRec{
				auth:  r.Header.Get("Authorization"),
				xKey:  r.Header.Get("X-Automation-Key"),
				ctype: r.Header.Get("Content-Type"),
				body:  m,
			})
			code := statusCode
			rb := respBody
			mu.Unlock()
			w.WriteHeader(code)
			_, _ = w.Write([]byte(rb))
		}))
		ts.TLS = &tls.Config{Certificates: []tls.Certificate{tlsCert}}
		ts.StartTLS()
		return ts
	}
	srvR := makeHook(&rustReqs)
	defer srvR.Close()
	srvG := makeHook(&goReqs)
	defer srvG.Close()

	caFile := filepath.Join(t.TempDir(), "ca.pem")
	_ = os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0o644)
	t.Setenv("SSL_CERT_FILE", caFile)
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")

	dirR := t.TempDir()
	dirG := t.TempDir()
	secR := filepath.Join(dirR, "s.json")
	secG := filepath.Join(dirG, "s.json")
	_ = os.WriteFile(secR, []byte(fmt.Sprintf(`{"url":"%s/hook","key":"%s"}`, srvR.URL, key)), 0o600)
	_ = os.WriteFile(secG, []byte(fmt.Sprintf(`{"url":"%s/hook","key":"%s"}`, srvG.URL, key)), 0o600)

	envR := map[string]string{"HOME": dirR, "DEV_AGENT_BRIDGE_SECRETS": secR, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirR, "state"), "DEV_AGENT_BRIDGE_LOG": filepath.Join(dirR, "log.jsonl")}
	envG := map[string]string{"HOME": dirG, "DEV_AGENT_BRIDGE_SECRETS": secG, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirG, "state"), "DEV_AGENT_BRIDGE_LOG": filepath.Join(dirG, "log.jsonl")}

	rng := rand.New(rand.NewSource(99))
	askID := randUUID(rng)
	sameID := randUUID(rng)

	steps := []struct {
		name     string
		args     []string
		stdin    string
		httpCode int
		httpResp string
		sessEnv  string
	}{
		{"ask", []string{"send", "--kind", "ask", "--topic", "fuzz-t", "--body-file", "-", "--id", askID, "--session", "pi-1"}, "Hello ask", 200, `{}`, ""},
		{"dup-id", []string{"send", "--kind", "note", "--topic", "fuzz-t", "--body", "again", "--id", askID}, "", 200, `{}`, ""},
		{"reply-1", []string{"send", "--kind", "reply", "--topic", "fuzz-t", "--reply-to", askID, "--body", "answer", "--id", sameID}, "", 200, `{}`, "pi-2"},
		{"reply-dup", []string{"send", "--kind", "reply", "--topic", "fuzz-t", "--reply-to", askID, "--body", "second answer", "--id", randUUID(rng)}, "", 200, `{}`, ""},
		{"multipart", []string{"send", "--kind", "note", "--topic", "multi", "--body-file", "-", "--id", randUUID(rng)}, strings.Repeat(`x"y\z<>&`, 400), 200, `{}`, "pi-3"},
		{"http-500-redact", []string{"send", "--kind", "note", "--topic", "err", "--body", "fail me", "--id", randUUID(rng)}, "", 500, "err with " + key + " and Bearer tok1234567890", ""},
		{"http-302-no-redirect", []string{"send", "--kind", "note", "--topic", "redir", "--body", "no redirect", "--id", randUUID(rng)}, "", 302, "redirecting", ""},
	}
	// Fill up to rate limit 20 and trigger 21st
	for i := 0; i < 18; i++ {
		steps = append(steps, struct {
			name     string
			args     []string
			stdin    string
			httpCode int
			httpResp string
			sessEnv  string
		}{
			name:     fmt.Sprintf("cap-%d", i),
			args:     []string{"send", "--kind", "note", "--topic", fmt.Sprintf("t-%d", i), "--body", fmt.Sprintf("body %d", i), "--id", randUUID(rng)},
			httpCode: 200,
			httpResp: `{}`,
		})
	}

	for _, st := range steps {
		mu.Lock()
		statusCode = st.httpCode
		respBody = st.httpResp
		mu.Unlock()
		eR := copyMap(envR)
		eG := copyMap(envG)
		if st.sessEnv != "" {
			eR["DEV_AGENT_BRIDGE_SESSION"] = st.sessEnv
			eG["DEV_AGENT_BRIDGE_SESSION"] = st.sessEnv
		}
		resR := runBin(rustBin, st.args, eR, st.stdin)
		resG := runBin(goBin, st.args, eG, st.stdin)
		if resR.code != resG.code {
			t.Fatalf("step %s: exit rust=%d go=%d\nrust err: %s\ngo err: %s", st.name, resR.code, resG.code, resR.stderr, resG.stderr)
		}
		if strings.ReplaceAll(resR.stdout, dirR, "<DIR>") != strings.ReplaceAll(resG.stdout, dirG, "<DIR>") {
			t.Fatalf("step %s stdout mismatch:\nrust: %q\ngo:   %q", st.name, resR.stdout, resG.stdout)
		}
		if strings.ReplaceAll(resR.stderr, dirR, "<DIR>") != strings.ReplaceAll(resG.stderr, dirG, "<DIR>") {
			t.Fatalf("step %s stderr mismatch:\nrust: %q\ngo:   %q", st.name, resR.stderr, resG.stderr)
		}
		if strings.Contains(resG.stderr, key) || strings.Contains(resG.stdout, key) {
			t.Fatalf("step %s leaked secret key!", st.name)
		}
	}

	if len(rustReqs) != len(goReqs) {
		t.Fatalf("webhook request count mismatch: rust=%d go=%d", len(rustReqs), len(goReqs))
	}
	for i := range rustReqs {
		r, g := rustReqs[i], goReqs[i]
		r.body.SentAt = ""
		g.body.SentAt = ""
		rb, _ := marshalJSON(r.body)
		gb, _ := marshalJSON(g.body)
		if r.auth != g.auth || r.xKey != g.xKey || string(rb) != string(gb) {
			t.Fatalf("req %d mismatch:\nrust: %s\ngo:   %s", i, rb, gb)
		}
	}

	// Verify routes.json matches identically
	routesR, _ := os.ReadFile(filepath.Join(dirR, "state", "routes.json"))
	routesG, _ := os.ReadFile(filepath.Join(dirG, "state", "routes.json"))
	if string(routesR) != string(routesG) {
		t.Fatalf("routes.json mismatch:\nrust: %s\ngo:   %s", routesR, routesG)
	}
	// Verify from-dev-agent saved copies match identically (ignoring sent_at)
	savedR, _ := os.ReadDir(filepath.Join(dirR, "ResilioSync", "BnBShare", "grokbot", "engineering-lead", "dev-agent-bridge", "from-dev-agent"))
	savedG, _ := os.ReadDir(filepath.Join(dirG, "ResilioSync", "BnBShare", "grokbot", "engineering-lead", "dev-agent-bridge", "from-dev-agent"))
	if len(savedR) != len(savedG) {
		t.Fatalf("from-dev-agent file count mismatch: rust=%d go=%d", len(savedR), len(savedG))
	}
	for i := range savedR {
		if savedR[i].Name() != savedG[i].Name() {
			t.Fatalf("from-dev-agent filename mismatch: rust=%s go=%s", savedR[i].Name(), savedG[i].Name())
		}
		bR, _ := os.ReadFile(filepath.Join(dirR, "ResilioSync", "BnBShare", "grokbot", "engineering-lead", "dev-agent-bridge", "from-dev-agent", savedR[i].Name()))
		bG, _ := os.ReadFile(filepath.Join(dirG, "ResilioSync", "BnBShare", "grokbot", "engineering-lead", "dev-agent-bridge", "from-dev-agent", savedG[i].Name()))
		if sentAtRe.ReplaceAllString(string(bR), "") != sentAtRe.ReplaceAllString(string(bG), "") {
			t.Fatalf("from-dev-agent %s mismatch:\nrust: %s\ngo:   %s", savedR[i].Name(), bR, bG)
		}
	}
}

func TestDifferentialFuzzEdgeCasesAgainstRust(t *testing.T) {
	rustBin := findRustBridge(t)
	goBin := buildGoBridge(t)

	// 1. Unicode + control chars + U+2028/U+2029 multipart splitting exact boundary match
	rng := rand.New(rand.NewSource(777))
	alphabet := []rune{'a', 'b', '"', '\\', '\n', '\r', '\t', '\b', '\f', '\x00', '\x07', '\x1f', '<', '>', '&', 'é', '中', '🚀', '\u2028', '\u2029'}
	for i := 0; i < 40; i++ {
		var sb strings.Builder
		n := 1500 + rng.Intn(3000)
		for j := 0; j < n; j++ {
			sb.WriteRune(alphabet[rng.Intn(len(alphabet))])
		}
		body := sb.String()
		id := randUUID(rng)
		dirR, dirG := t.TempDir(), t.TempDir()
		bodyFileR := filepath.Join(dirR, "body.txt")
		bodyFileG := filepath.Join(dirG, "body.txt")
		prefix := ""
		if i%2 == 0 {
			prefix = "\ufeff"
		}
		_ = os.WriteFile(bodyFileR, []byte(prefix+body), 0o644)
		_ = os.WriteFile(bodyFileG, []byte(prefix+body), 0o644)

		envR := map[string]string{"HOME": dirR, "DEV_AGENT_BRIDGE_SECRETS": filepath.Join(dirR, "none.json")}
		envG := map[string]string{"HOME": dirG, "DEV_AGENT_BRIDGE_SECRETS": filepath.Join(dirG, "none.json")}
		resR := runBin(rustBin, []string{"send", "--kind", "note", "--topic", "unicode-split", "--id", id, "--body-file", bodyFileR, "--dry-run"}, envR, "")
		resG := runBin(goBin, []string{"send", "--kind", "note", "--topic", "unicode-split", "--id", id, "--body-file", bodyFileG, "--dry-run"}, envG, "")
		if resR.code != resG.code {
			t.Fatalf("unicode case %d exit rust=%d go=%d", i, resR.code, resG.code)
		}
		// Compare parts count line and body_bytes/body_sha256
		outR := normDryRun(resR.stdout, dirR)
		outG := normDryRun(resG.stdout, dirG)
		// Extract parts line, body_bytes, body_sha256 (note Go escapes \b/\f as \u0008/\u000c in JSON output, which is valid JSON; parse the JSON prefix!)
		jsonEndR := strings.Index(outR, "\nheaders:")
		jsonEndG := strings.Index(outG, "\nheaders:")
		if jsonEndR < 0 || jsonEndG < 0 {
			t.Fatalf("unicode case %d missing headers marker", i)
		}
		var mR, mG Message
		if err := json.Unmarshal([]byte(outR[:jsonEndR]), &mR); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(outG[:jsonEndG]), &mG); err != nil {
			t.Fatal(err)
		}
		if mR.Body != mG.Body || *mR.BodyBytes != *mG.BodyBytes || *mR.BodySHA256 != *mG.BodySHA256 {
			t.Fatalf("unicode case %d message body/hash mismatch", i)
		}
		if outR[jsonEndR:] != outG[jsonEndG:] {
			t.Fatalf("unicode case %d trailer/parts mismatch:\nrust: %s\ngo:   %s", i, outR[jsonEndR:], outG[jsonEndG:])
		}
	}

	// 2. Stale lease & stale presence & owner takeover
	dirR, dirG := t.TempDir(), t.TempDir()
	envR := map[string]string{"HOME": dirR, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirR, "state"), "DEV_AGENT_BRIDGE_INBOX": filepath.Join(dirR, "inbox"), "DEV_AGENT_BRIDGE_LOG": filepath.Join(dirR, "log.jsonl")}
	envG := map[string]string{"HOME": dirG, "DEV_AGENT_BRIDGE_STATE": filepath.Join(dirG, "state"), "DEV_AGENT_BRIDGE_INBOX": filepath.Join(dirG, "inbox"), "DEV_AGENT_BRIDGE_LOG": filepath.Join(dirG, "log.jsonl")}
	for _, d := range []string{dirR, dirG} {
		_ = os.MkdirAll(filepath.Join(d, "state", "present"), 0o755)
		_ = os.MkdirAll(filepath.Join(d, "inbox"), 0o755)
		stale := fmt.Sprintf(`{"session":"old-holder","cwd":"/old","heartbeat":%f}`, nowTS()-60)
		_ = os.WriteFile(filepath.Join(d, "state", "listener.json"), []byte(stale), 0o644)
		routes := `{"asks":[],"topics":[["stale-topic","gone-sess"]]}`
		_ = os.WriteFile(filepath.Join(d, "state", "routes.json"), []byte(routes), 0o644)
		msgID := "11111111-3899-4f2d-b1d3-f76908734e5b"
		msg := fmt.Sprintf(`{"v":1,"id":"%s","from":"engineering-lead","to":"dev-agent","topic":"stale-topic","kind":"note","reply_to":null,"body":"fallback","refs":{},"sent_at":"2026-11-21T13:20:00-06:00"}`, msgID)
		_ = os.WriteFile(filepath.Join(d, "inbox", msgID+".json"), []byte(msg), 0o644)
	}
	resR := runBin(rustBin, []string{"take", "--session", "new-holder", "--cwd", "/new"}, envR, "")
	resG := runBin(goBin, []string{"take", "--session", "new-holder", "--cwd", "/new"}, envG, "")
	var tR, tG Taken
	_ = json.Unmarshal([]byte(resR.stdout), &tR)
	_ = json.Unmarshal([]byte(resG.stdout), &tG)
	compareTaken(t, 99, 0, dirR, dirG, tR, tG)
	if !tG.Listener || len(tG.Messages) != 1 {
		t.Fatalf("expected new-holder to take stale-lease + stale-presence message, got %+v", tG)
	}

	// 3. Unwritable log path falls back to <state>/log.jsonl, and unwritable state dir returns exit 7
	dirR2, dirG2 := t.TempDir(), t.TempDir()
	envR2 := map[string]string{"HOME": dirR2, "DEV_AGENT_BRIDGE_STATE": "/dev/null/impossible"}
	envG2 := map[string]string{"HOME": dirG2, "DEV_AGENT_BRIDGE_STATE": "/dev/null/impossible"}
	stR := runBin(rustBin, []string{"status"}, envR2, "")
	stG := runBin(goBin, []string{"status"}, envG2, "")
	if stR.code != 7 || stG.code != 7 || stR.stderr != stG.stderr {
		t.Fatalf("unwritable state mismatch: rust=(%d,%q) go=(%d,%q)", stR.code, stR.stderr, stG.code, stG.stderr)
	}
}

func TestDifferentialFuzzInboxAgainstRust(t *testing.T) {
	rustBin := findRustBridge(t)
	goBin := buildGoBridge(t)

	rng := rand.New(rand.NewSource(2026))
	sessions := []string{"brazos@laptop:/home/bo/.brazos", "pi-1", "pi-2", "pi-3"}
	topics := []string{"t-alpha", "t-beta", "t-gamma", "unwritten"}

	for round := 0; round < 12; round++ {
		dirR := t.TempDir()
		dirG := t.TempDir()
		envR := map[string]string{
			"HOME":                     dirR,
			"DEV_AGENT_BRIDGE_STATE":   filepath.Join(dirR, "state"),
			"DEV_AGENT_BRIDGE_INBOX":   filepath.Join(dirR, "inbox"),
			"DEV_AGENT_BRIDGE_LOG":     filepath.Join(dirR, "log.jsonl"),
			"DEV_AGENT_BRIDGE_SECRETS": filepath.Join(dirR, "missing.json"),
		}
		envG := map[string]string{
			"HOME":                     dirG,
			"DEV_AGENT_BRIDGE_STATE":   filepath.Join(dirG, "state"),
			"DEV_AGENT_BRIDGE_INBOX":   filepath.Join(dirG, "inbox"),
			"DEV_AGENT_BRIDGE_LOG":     filepath.Join(dirG, "log.jsonl"),
			"DEV_AGENT_BRIDGE_SECRETS": filepath.Join(dirG, "missing.json"),
		}
		_ = os.MkdirAll(filepath.Join(dirR, "inbox"), 0o755)
		_ = os.MkdirAll(filepath.Join(dirG, "inbox"), 0o755)

		// Pre-seed identical routes.json
		ask1, ask2 := randUUID(rng), randUUID(rng)
		routes := Routes{
			Asks:   [][2]string{{ask1, "pi-1"}, {ask2, "pi-2"}},
			Topics: [][2]string{{"t-alpha", "pi-1"}, {"t-beta", "brazos@laptop:/home/bo/.brazos"}},
		}
		routesBytes, _ := marshalJSON(routes)
		_ = os.MkdirAll(filepath.Join(dirR, "state"), 0o755)
		_ = os.MkdirAll(filepath.Join(dirG, "state"), 0o755)
		_ = os.WriteFile(filepath.Join(dirR, "state", "routes.json"), routesBytes, 0o644)
		_ = os.WriteFile(filepath.Join(dirG, "state", "routes.json"), routesBytes, 0o644)

		dropBoth := func(name string, content []byte, old bool) {
			mt := time.Unix(1700000000+int64(round*100+rng.Intn(50)), 0)
			if !old {
				mt = time.Now()
			}
			for _, d := range []string{dirR, dirG} {
				p := filepath.Join(d, "inbox", name)
				_ = os.WriteFile(p, content, 0o644)
				_ = os.Chtimes(p, mt, mt)
			}
		}

		for step := 0; step < 25; step++ {
			op := rng.Intn(10)
			switch {
			case op < 4:
				// Drop a random inbox file (valid, invalid, partial, wrong id, bad hash, non-uuid)
				id := randUUID(rng)
				kind := []string{"note", "ask", "reply"}[rng.Intn(3)]
				topic := topics[rng.Intn(len(topics))]
				var replyTo any
				if kind == "reply" {
					switch rng.Intn(4) {
					case 0:
						replyTo = ask1
					case 1:
						replyTo = ask2
					case 2:
						replyTo = randUUID(rng)
					case 3:
						replyTo = nil // invalid reply
					}
				}
				switch rng.Intn(10) {
				case 0:
					dropBoth(id+".json", []byte("{partial"), false) // within grace period
				case 1:
					dropBoth(id+".json", []byte("{partial-old"), true) // past grace period
				case 2:
					dropBoth("notes.json", []byte(`{"ignored":true}`), true)
				case 3:
					dropBoth(id+".json", []byte(`{"v":1}`), true) // missing fields
				case 4:
					// Wrong filename vs id
					otherID := randUUID(rng)
					m := map[string]any{"v": 1, "id": otherID, "from": engLead, "to": devAgent, "topic": topic, "kind": "note", "reply_to": nil, "body": "mismatch", "refs": map[string]any{}, "sent_at": "2026-11-21T13:20:00-06:00"}
					b, _ := marshalJSON(m)
					dropBoth(id+".json", b, true)
				case 5:
					// Bad sha256
					m := map[string]any{"v": 1, "id": id, "from": engLead, "to": devAgent, "topic": topic, "kind": "note", "reply_to": nil, "body": "corrupt", "body_bytes": 7, "body_sha256": "deadbeef", "refs": map[string]any{}, "sent_at": "2026-11-21T13:20:00-06:00"}
					b, _ := marshalJSON(m)
					dropBoth(id+".json", b, true)
				case 6:
					// Bad body_bytes
					m := map[string]any{"v": 1, "id": id, "from": engLead, "to": devAgent, "topic": topic, "kind": "note", "reply_to": nil, "body": "corrupt", "body_bytes": 999, "refs": map[string]any{}, "sent_at": "2026-11-21T13:20:00-06:00"}
					b, _ := marshalJSON(m)
					dropBoth(id+".json", b, true)
				case 7:
					// Extra refs key
					m := map[string]any{"v": 1, "id": id, "from": engLead, "to": devAgent, "topic": topic, "kind": "note", "reply_to": nil, "body": "bad refs", "refs": map[string]any{"url": "nope"}, "sent_at": "2026-11-21T13:20:00-06:00"}
					b, _ := marshalJSON(m)
					dropBoth(id+".json", b, true)
				default:
					body := fmt.Sprintf("msg-%d-%d <tag> & \"q\"", round, step)
					m := map[string]any{"v": 1, "id": id, "from": engLead, "to": devAgent, "topic": topic, "kind": kind, "reply_to": replyTo, "body": body, "body_bytes": len(body), "body_sha256": sha256Hex([]byte(body)), "refs": map[string]any{}, "sent_at": "2026-11-21T13:20:00-06:00"}
					b, _ := marshalJSON(m)
					if rng.Intn(5) == 0 {
						b = append([]byte("\ufeff"), b...)
					}
					dropBoth(id+".json", b, true)
				}
				continue

			case op < 7:
				// take or take --hold
				sess := sessions[rng.Intn(len(sessions))]
				args := []string{"take", "--session", sess, "--cwd", "/work"}
				if op == 6 {
					args = append(args, "--hold")
				}
				resR := runBin(rustBin, args, envR, "")
				resG := runBin(goBin, args, envG, "")
				if resR.code != resG.code {
					t.Fatalf("round %d step %d %v: code rust=%d go=%d", round, step, args, resR.code, resG.code)
				}
				var tR, tG Taken
				if err := json.Unmarshal([]byte(resR.stdout), &tR); err != nil {
					t.Fatalf("rust take invalid json: %v\n%s", err, resR.stdout)
				}
				if err := json.Unmarshal([]byte(resG.stdout), &tG); err != nil {
					t.Fatalf("go take invalid json: %v\n%s", err, resG.stdout)
				}
				compareTaken(t, round, step, dirR, dirG, tR, tG)

			case op == 7:
				sess := sessions[rng.Intn(len(sessions))]
				args := []string{"listen", "--session", sess, "--cwd", "/work"}
				resR := runBin(rustBin, args, envR, "")
				resG := runBin(goBin, args, envG, "")
				if resR.code != resG.code || resR.stdout != resG.stdout {
					t.Fatalf("round %d step %d listen mismatch: rust=(%d,%q) go=(%d,%q)", round, step, resR.code, resR.stdout, resG.code, resG.stdout)
				}

			case op == 8:
				sess := sessions[rng.Intn(len(sessions))]
				args := []string{"release", "--session", sess}
				resR := runBin(rustBin, args, envR, "")
				resG := runBin(goBin, args, envG, "")
				if resR.code != resG.code || resR.stdout != resG.stdout {
					t.Fatalf("round %d step %d release mismatch: rust=(%d,%q) go=(%d,%q)", round, step, resR.code, resR.stdout, resG.code, resG.stdout)
				}

			case op == 9:
				resR := runBin(rustBin, []string{"status"}, envR, "")
				resG := runBin(goBin, []string{"status"}, envG, "")
				if resR.code != resG.code {
					t.Fatalf("round %d step %d status code rust=%d go=%d", round, step, resR.code, resG.code)
				}
				var sR, sG StatusReport
				_ = json.Unmarshal([]byte(resR.stdout), &sR)
				_ = json.Unmarshal([]byte(resG.stdout), &sG)
				if sR.Waiting != sG.Waiting || (sR.Listener == nil) != (sG.Listener == nil) || (sR.Owner == nil) != (sG.Owner == nil) {
					t.Fatalf("round %d step %d status mismatch:\nrust: %s\ngo:   %s", round, step, resR.stdout, resG.stdout)
				}
				if sR.Listener != nil && sR.Listener.Session != sG.Listener.Session {
					t.Fatalf("status listener session mismatch: rust=%q go=%q", sR.Listener.Session, sG.Listener.Session)
				}
				if sR.Owner != nil && sR.Owner.Session != sG.Owner.Session {
					t.Fatalf("status owner session mismatch: rust=%q go=%q", sR.Owner.Session, sG.Owner.Session)
				}
			}
		}
	}
}

func compareTaken(t *testing.T, round, step int, dirR, dirG string, r, g Taken) {
	t.Helper()
	if r.Listener != g.Listener {
		t.Fatalf("round %d step %d listener mismatch: rust=%v go=%v", round, step, r.Listener, g.Listener)
	}
	if (r.Holder == nil) != (g.Holder == nil) || (r.Holder != nil && r.Holder.Session != g.Holder.Session) {
		t.Fatalf("round %d step %d holder mismatch: rust=%+v go=%+v", round, step, r.Holder, g.Holder)
	}
	if len(r.Messages) != len(g.Messages) {
		t.Fatalf("round %d step %d messages len mismatch: rust=%d go=%d", round, step, len(r.Messages), len(g.Messages))
	}
	for i := range r.Messages {
		if r.Messages[i].ID != g.Messages[i].ID || r.Messages[i].Text != g.Messages[i].Text || r.Messages[i].Kind != g.Messages[i].Kind || r.Messages[i].Topic != g.Messages[i].Topic {
			t.Fatalf("round %d step %d message %d mismatch:\nrust: %+v\ngo:   %+v", round, step, i, r.Messages[i], g.Messages[i])
		}
	}
	if len(r.Rejected) != len(g.Rejected) {
		t.Fatalf("round %d step %d rejected len mismatch: rust=%+v go=%+v", round, step, r.Rejected, g.Rejected)
	}
	for i := range r.Rejected {
		rf := strings.ReplaceAll(r.Rejected[i].File, dirR, "<DIR>")
		gf := strings.ReplaceAll(g.Rejected[i].File, dirG, "<DIR>")
		rr := r.Rejected[i].Reason
		gr := g.Rejected[i].Reason
		// Both Rust serde_json and Go json report shape errors starting with the same prefix.
		if strings.HasPrefix(rr, "the message does not have the bridge shape:") && strings.HasPrefix(gr, "the message does not have the bridge shape:") {
			rr = "shape-error"
			gr = "shape-error"
		}
		if rf != gf || rr != gr {
			t.Fatalf("round %d step %d rejected %d mismatch: rust=(%q,%q) go=(%q,%q)", round, step, i, rf, rr, gf, gr)
		}
	}
}

func copyMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

var _ = tmpDirRe
