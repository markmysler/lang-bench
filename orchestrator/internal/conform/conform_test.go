package conform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// reference is a server that follows docs/SPEC.md. Each test breaks one part of it.
type reference struct {
	plaintext   string
	jsonType    string
	extraField  bool
	fib         func(int) int
	cpuMax      int
	ioNoWait    bool
	dbSameRow   bool
	queriesHigh int
}

func newReference() *reference {
	var fib func(int) int
	fib = func(n int) int {
		if n < 2 {
			return n
		}
		return fib(n-1) + fib(n-2)
	}
	return &reference{plaintext: "Hello, World!", jsonType: "application/json", fib: fib, cpuMax: 32, queriesHigh: 500}
}

func param(r *http.Request, name string, def, lo, hi int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return def
	}
	return max(lo, min(hi, n))
}

func (ref *reference) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	send := func(v any) {
		w.Header().Set("Content-Type", ref.jsonType)
		json.NewEncoder(w).Encode(v)
	}
	row := func() map[string]int {
		if ref.dbSameRow {
			return map[string]int{"id": 1, "randomNumber": 1}
		}
		return map[string]int{"id": 1 + rand.IntN(10000), "randomNumber": 1 + rand.IntN(10000)}
	}
	switch r.URL.Path {
	case "/health":
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "ok")
	case "/plaintext":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, ref.plaintext)
	case "/json":
		m := map[string]string{"message": "Hello, World!"}
		if ref.extraField {
			m["extra"] = "x"
		}
		send(m)
	case "/cpu":
		n := param(r, "n", 20, 0, ref.cpuMax)
		send(map[string]int{"n": n, "fib": ref.fib(n)})
	case "/io":
		ms := param(r, "ms", 10, 0, 1000)
		if !ref.ioNoWait {
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
		send(map[string]int{"ms": ms})
	case "/db":
		send(row())
	case "/queries":
		n := param(r, "n", 1, 1, ref.queriesHigh)
		rows := make([]map[string]int, n)
		for i := range rows {
			rows[i] = row()
		}
		send(rows)
	default:
		http.NotFound(w, r)
	}
}

func check(t *testing.T, ref *reference) []Failure {
	t.Helper()
	srv := httptest.NewServer(ref)
	t.Cleanup(srv.Close)
	return Check(context.Background(), srv.URL, srv.Client())
}

func TestTheReferenceConforms(t *testing.T) {
	t.Parallel()
	if f := check(t, newReference()); len(f) != 0 {
		t.Fatalf("failures: %v", f)
	}
}

func expectFailure(t *testing.T, ref *reference, endpoint string) {
	t.Helper()
	failures := check(t, ref)
	for _, f := range failures {
		if strings.HasPrefix(f.Check, endpoint) {
			return
		}
	}
	t.Fatalf("want a failure for %s, got %v", endpoint, failures)
}

func TestWrongPlaintext(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.plaintext = "Hello World"
	expectFailure(t, ref, "/plaintext")
}

func TestJSONWithTheWrongContentType(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.jsonType = "text/html"
	expectFailure(t, ref, "/json")
}

func TestJSONWithExtraFields(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.extraField = true
	expectFailure(t, ref, "/json")
}

func TestWrongFibonacci(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.fib = func(n int) int { return n }
	expectFailure(t, ref, "/cpu")
}

func TestCPUNotClamped(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.cpuMax = 33
	expectFailure(t, ref, "/cpu")
}

func TestIOThatDoesNotWait(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.ioNoWait = true
	expectFailure(t, ref, "/io")
}

func TestDBThatIsNotRandom(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.dbSameRow = true
	expectFailure(t, ref, "/db")
}

func TestQueriesNotClamped(t *testing.T) {
	t.Parallel()
	ref := newReference()
	ref.queriesHigh = 1000
	expectFailure(t, ref, "/queries")
}

func TestUnreachableServerFailsEveryCheck(t *testing.T) {
	t.Parallel()
	failures := Check(context.Background(), "http://127.0.0.1:1", http.DefaultClient)
	if len(failures) < 7 {
		t.Fatalf("failures = %v", failures)
	}
	if !strings.Contains(fmt.Sprint(failures[0]), "/health") {
		t.Fatalf("first failure = %v", failures[0])
	}
}
