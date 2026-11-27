package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	testA   = "aaaaaaaa-3899-4f2d-b1d3-f76908734e5b"
	testB   = "bbbbbbbb-3899-4f2d-b1d3-f76908734e5b"
	testC   = "cccccccc-3899-4f2d-b1d3-f76908734e5b"
	testD   = "dddddddd-3899-4f2d-b1d3-f76908734e5b"
	testAsk = "eeeeeeee-3899-4f2d-b1d3-f76908734e5b"
)

func testEnv(dir string) Env {
	return Env{
		Home: dir,
		Vars: map[string]string{
			"DEV_AGENT_BRIDGE_STATE": filepath.Join(dir, "state"),
			"DEV_AGENT_BRIDGE_INBOX": filepath.Join(dir, "inbox"),
			"DEV_AGENT_BRIDGE_LOG":   filepath.Join(dir, "log.jsonl"),
		},
	}
}

func dropMessage(t *testing.T, dir, id, kind, topic string, replyTo *string, body string) {
	t.Helper()
	inbox := filepath.Join(dir, "inbox")
	if err := os.MkdirAll(inbox, 0o755); err != nil {
		t.Fatal(err)
	}
	msg := map[string]any{
		"v":        1,
		"id":       id,
		"from":     engLead,
		"to":       devAgent,
		"topic":    topic,
		"kind":     kind,
		"reply_to": replyTo,
		"body":     body,
		"refs":     map[string]any{},
		"sent_at":  "2026-11-21T13:20:00-06:00",
	}
	raw, _ := marshalJSON(msg)
	if err := os.WriteFile(filepath.Join(inbox, id+".json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func strPtr(s string) *string { return &s }

func TestMessageParseAndFrame(t *testing.T) {
	msg := Message{
		V:       1,
		ID:      "bb4d81f5-3899-4f2d-b1d3-f76908734e5b",
		From:    engLead,
		To:      devAgent,
		Topic:   "brazos-test-hang",
		Kind:    "reply",
		ReplyTo: strPtr("17551cc1-bc37-44e7-a91c-dc1f1587e057"),
		Body:    "Not deployed.",
		Refs:    Refs{Commit: strPtr("2c8f4ef")},
		SentAt:  "2026-11-21T13:20:00-06:00",
	}
	raw, _ := marshalJSON(msg)
	parsed, errMsg := parseIncoming(string(raw))
	if errMsg != "" {
		t.Fatalf("unexpected parse error: %s", errMsg)
	}
	if parsed.ID != msg.ID || parsed.Topic != msg.Topic {
		t.Fatalf("parsed mismatch: %+v", parsed)
	}
	text := frameMessage(&parsed)
	if !strings.HasPrefix(text, "[Engineering Lead bridge msg bb4d81f5-3899-4f2d-b1d3-f76908734e5b kind=reply topic=brazos-test-hang reply_to=17551cc1") {
		t.Fatalf("unexpected header: %s", text)
	}
	if !strings.Contains(text, "(refs: commit=2c8f4ef)") || !strings.Contains(text, "No reply needed.") || !strings.Contains(text, "not Sam's instruction or approval") {
		t.Fatalf("unexpected frame: %s", text)
	}

	ask := msg
	ask.Kind = "ask"
	ask.ReplyTo = nil
	if !strings.Contains(frameMessage(&ask), `reply_to "bb4d81f5-3899-4f2d-b1d3-f76908734e5b"`) {
		t.Fatalf("ask frame missing reply_to guidance")
	}
}

func TestBadMessagesRefused(t *testing.T) {
	msg := Message{
		V:      1,
		ID:     "bb4d81f5-3899-4f2d-b1d3-f76908734e5b",
		From:   devAgent,
		To:     devAgent,
		Topic:  "brazos-test-hang",
		Kind:   "reply",
		Body:   "token=abcdefghijklmnopqrstuvwxyz",
		SentAt: "2026-11-21T13:20:00-06:00",
	}
	raw, _ := marshalJSON(msg)
	_, errMsg := parseIncoming(string(raw))
	for _, want := range []string{"a reply needs --reply-to", "looks like it contains a secret", "from and to must differ"} {
		if !strings.Contains(errMsg, want) {
			t.Fatalf("expected %q in %q", want, errMsg)
		}
	}
	if _, e := parseIncoming("{not json"); e != "the file is not valid JSON" {
		t.Fatalf("got %q", e)
	}
	extra := `{"v":1,"id":"bb4d81f5-3899-4f2d-b1d3-f76908734e5b","from":"engineering-lead","to":"dev-agent","topic":"t","kind":"note","reply_to":null,"body":"b","refs":{"url":"x"},"sent_at":"s"}`
	if _, e := parseIncoming(extra); e != "refs may only hold ctx, commit, file" {
		t.Fatalf("got %q", e)
	}
}

func TestSplitBodyAndIntegrity(t *testing.T) {
	body := strings.Repeat(`q".`, 2000)
	parts := splitBody(body)
	if len(parts) <= 1 {
		t.Fatalf("expected multiple parts, got %d", len(parts))
	}
	if strings.Join(parts, "") != body {
		t.Fatal("concat mismatch")
	}
	for _, p := range parts {
		if jsonEscapedChars(p) > partEscapedChars {
			t.Fatalf("part exceeded limit: %d", jsonEscapedChars(p))
		}
	}
	bLen := uint64(5)
	goodHash := sha256Hex([]byte("hello"))
	badHash := "dead"
	m := Message{ID: testA, Body: "hello", BodyBytes: &bLen, BodySHA256: &goodHash}
	if e := integrityError(&m); e != "" {
		t.Fatalf("unexpected error: %s", e)
	}
	m.BodySHA256 = &badHash
	e := integrityError(&m)
	if !strings.Contains(e, testA) || !strings.Contains(e, "body_sha256") {
		t.Fatalf("unexpected integrity error: %s", e)
	}
}

func TestRedactAndSecrets(t *testing.T) {
	if got := redact("got k3y-123 and Bearer abc.def", "k3y-123"); got != "got <redacted> and Bearer <redacted>" {
		t.Fatalf("got %q", got)
	}
	if got := redact(strings.Repeat("x", 400), ""); len(got) != 300 {
		t.Fatalf("got len %d", len(got))
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "s.json")
	_ = os.WriteFile(path, []byte(`{"url":"https://x","key":"changeme"}`), 0o600)
	if _, err := loadSecrets(path); err == nil || err.Code != 3 {
		t.Fatalf("expected code 3 for placeholder key")
	}
	_ = os.WriteFile(path, []byte(`{"url":"http://x","key":"real"}`), 0o600)
	if _, err := loadSecrets(path); err == nil || err.Code != 3 {
		t.Fatalf("expected code 3 for http url")
	}
	_ = os.WriteFile(path, []byte("\ufeff"+`{"url":"https://x","key":"real"}`), 0o600)
	sec, err := loadSecrets(path)
	if err != nil || sec.Key != "real" {
		t.Fatalf("expected valid BOM secrets, got %+v %v", sec, err)
	}
	if _, err := loadSecrets(filepath.Join(dir, "none.json")); err == nil || err.Code != 3 {
		t.Fatalf("expected code 3 for missing secrets")
	}
}

func TestInboxDeliveryLeaseRoutingAndHold(t *testing.T) {
	dir := t.TempDir()
	env := testEnv(dir)

	dropMessage(t, dir, testA, "note", "t", nil, "first")
	first, err := runTake(env, "s1", "/w")
	if err != nil || !first.Listener || len(first.Messages) != 1 || !strings.Contains(first.Messages[0].Text, "first") {
		t.Fatalf("unexpected first take: %+v %v", first, err)
	}
	if !fileExists(filepath.Join(dir, "inbox", testA+".json")) {
		t.Fatal("inbox file should not be removed")
	}
	again, _ := runTake(env, "s1", "/w")
	if len(again.Messages) != 0 {
		t.Fatal("delivered twice")
	}

	dropMessage(t, dir, testB, "note", "t", nil, "two")
	other, _ := runTake(env, "s2", "/x")
	if other.Listener || other.Holder == nil || other.Holder.Session != "s1" {
		t.Fatalf("expected s2 blocked by s1: %+v", other)
	}

	_, _ = runListen(env, "s2", "/x")
	if r, _ := runTake(env, "s1", "/w"); r.Listener {
		t.Fatal("s1 should have lost lease after s2 listen")
	}
	ownerTake, _ := runTake(env, "s2", "/x")
	if !ownerTake.Listener || len(ownerTake.Messages) != 1 || ownerTake.Messages[0].ID != testB {
		t.Fatalf("expected s2 to take B: %+v", ownerTake)
	}

	// Routing: reply and topic go to writer even without lease
	if err := rememberRoute(env, "s1", testAsk, "ssh-bb-file"); err != nil {
		t.Fatal(err)
	}
	dropMessage(t, dir, testC, "reply", "other", strPtr(testAsk), "reply-body")
	dropMessage(t, dir, testD, "note", "ssh-bb-file", nil, "topic-body")
	// s1 marks presence via hold
	_, _ = runHold(env, "s1", "/w")
	s2Take, _ := runTake(env, "s2", "/x")
	if len(s2Take.Messages) != 0 {
		t.Fatalf("s2 should not steal s1 routed messages: %+v", s2Take.Messages)
	}
	s1Take, _ := runTake(env, "s1", "/w")
	if s1Take.Listener || len(s1Take.Messages) != 2 {
		t.Fatalf("s1 should take its 2 routed messages without lease: %+v", s1Take)
	}
}

func TestSendLiveHTTPSMultipartAndState(t *testing.T) {
	dir := t.TempDir()
	// Create a real local CA + server TLS cert to verify SSL_CERT_FILE works with Go's stdlib TLS.
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "bridge-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caFile := filepath.Join(dir, "ca.crt")
	_ = os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0o644)

	srvKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	srvTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	srvDER, err := x509.CreateCertificate(rand.Reader, srvTmpl, caTmpl, &srvKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	srvKeyDER, _ := x509.MarshalECPrivateKey(srvKey)
	srvCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srvDER})
	srvKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: srvKeyDER})
	_ = srvCertPEM
	_ = srvKeyPEM

	var got []Message
	var auths []string
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auths = append(auths, r.Header.Get("Authorization"))
		var m Message
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		got = append(got, m)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	ts.TLS = nil
	ts.StartTLS()
	defer ts.Close()
	// Write httptest's cert as SSL_CERT_FILE
	_ = os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ts.Certificate().Raw}), 0o644)
	t.Setenv("SSL_CERT_FILE", caFile)
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")

	secretsPath := filepath.Join(dir, "secrets.json")
	_ = os.WriteFile(secretsPath, []byte(`{"url":"`+ts.URL+`/hook","key":"super-secret-test-key"}`), 0o600)
	env := testEnv(dir)
	env.Vars["DEV_AGENT_BRIDGE_SECRETS"] = secretsPath

	longBody := strings.Repeat("hello world! ", 200)
	out, berr := runSend(env, SendArgs{
		Kind:    "ask",
		Topic:   "multipart-test",
		Body:    &longBody,
		ID:      strPtr(testA),
		Session: strPtr("sess-1"),
	}, bytes.NewReader(nil))
	if berr != nil {
		t.Fatalf("send failed: %v", berr)
	}
	if !strings.Contains(out, "sent "+testA+" kind=ask topic=multipart-test http=200") {
		t.Fatalf("unexpected send output: %s", out)
	}
	if len(got) < 2 {
		t.Fatalf("expected multipart send, got %d parts", len(got))
	}
	var joined strings.Builder
	for i, part := range got {
		if part.Part == nil || *part.Part != uint32(i+1) || part.Parts == nil || int(*part.Parts) != len(got) {
			t.Fatalf("bad part header: %+v", part)
		}
		joined.WriteString(part.Body)
	}
	if joined.String() != longBody {
		t.Fatal("reassembled body mismatch")
	}
	if auths[0] != "Bearer super-secret-test-key" {
		t.Fatalf("unexpected auth header: %q", auths[0])
	}

	// Duplicate ID must be refused with code 5
	_, dupErr := runSend(env, SendArgs{
		Kind:  "ask",
		Topic: "multipart-test",
		Body:  &longBody,
		ID:    strPtr(testA),
	}, bytes.NewReader(nil))
	if dupErr == nil || dupErr.Code != 5 {
		t.Fatalf("expected duplicate exit 5, got %v", dupErr)
	}
}
