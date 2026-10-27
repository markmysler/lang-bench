// Package conform checks that a server follows the contract in docs/SPEC.md, so that every
// server does the same work for the same request.
package conform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"time"
)

// Failure is one check that did not pass.
type Failure struct {
	Check  string `json:"check"`
	Reason string `json:"reason"`
}

func (f Failure) String() string { return f.Check + ": " + f.Reason }

type checker struct {
	ctx      context.Context
	base     string
	client   *http.Client
	failures []Failure
}

func (c *checker) fail(check, format string, args ...any) {
	c.failures = append(c.failures, Failure{Check: check, Reason: fmt.Sprintf(format, args...)})
}

// get fetches path and checks the status and media type. It returns the body, or false after
// recording a failure.
func (c *checker) get(path, mediaType string) ([]byte, time.Duration, bool) {
	start := time.Now()
	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		c.fail(path, "%v", err)
		return nil, 0, false
	}
	res, err := c.client.Do(req)
	if err != nil {
		c.fail(path, "%v", err)
		return nil, 0, false
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	took := time.Since(start)
	if err != nil {
		c.fail(path, "reading the body: %v", err)
		return nil, took, false
	}
	if res.StatusCode != http.StatusOK {
		c.fail(path, "status %d, want 200", res.StatusCode)
		return nil, took, false
	}
	if mt, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type")); mt != mediaType {
		c.fail(path, "Content-Type %q, want %s", res.Header.Get("Content-Type"), mediaType)
		return nil, took, false
	}
	return body, took, true
}

// object decodes a JSON object with exactly the given integer fields.
func (c *checker) object(path string, body []byte, fields ...string) (map[string]int, bool) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		c.fail(path, "not a JSON object: %.100s", body)
		return nil, false
	}
	return c.fields(path, m, fields)
}

func (c *checker) fields(path string, m map[string]json.RawMessage, fields []string) (map[string]int, bool) {
	if len(m) != len(fields) {
		c.fail(path, "has fields %v, want exactly %v", keys(m), fields)
		return nil, false
	}
	out := map[string]int{}
	for _, f := range fields {
		var n int
		if err := json.Unmarshal(m[f], &n); err != nil {
			c.fail(path, "field %q is %s, want an integer", f, m[f])
			return nil, false
		}
		out[f] = n
	}
	return out, true
}

func keys(m map[string]json.RawMessage) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func fib(n int) int {
	a, b := 0, 1
	for range n {
		a, b = b, a+b
	}
	return a
}

// Check runs every check against the server at base, such as http://lb-go-gin:8080.
func Check(ctx context.Context, base string, client *http.Client) []Failure {
	c := &checker{ctx: ctx, base: base, client: client}

	if body, _, ok := c.get("/health", "text/plain"); !ok {
		// Nothing else will work either; say so once per endpoint so the report is complete.
		for _, p := range []string{"/plaintext", "/json", "/cpu", "/io", "/db", "/queries"} {
			c.fail(p, "not checked: the server is not healthy")
		}
		return c.failures
	} else if string(body) != "ok" {
		c.fail("/health", "body %q, want \"ok\"", body)
	}

	if body, _, ok := c.get("/plaintext", "text/plain"); ok && string(body) != "Hello, World!" {
		c.fail("/plaintext", "body %q, want \"Hello, World!\"", body)
	}

	if body, _, ok := c.get("/json", "application/json"); ok {
		var m map[string]json.RawMessage
		if err := json.Unmarshal(body, &m); err != nil {
			c.fail("/json", "not a JSON object: %.100s", body)
		} else if len(m) != 1 || string(m["message"]) != `"Hello, World!"` {
			c.fail("/json", "body %s, want {\"message\":\"Hello, World!\"}", bytes.TrimSpace(body))
		}
	}

	for _, tc := range []struct {
		query string
		n     int
	}{{"", 20}, {"?n=10", 10}, {"?n=0", 0}, {"?n=abc", 20}, {"?n=-5", 0}, {"?n=99", 32}} {
		path := "/cpu" + tc.query
		if body, _, ok := c.get(path, "application/json"); ok {
			if m, ok := c.object(path, body, "n", "fib"); ok && (m["n"] != tc.n || m["fib"] != fib(tc.n)) {
				c.fail(path, "got n=%d fib=%d, want n=%d fib=%d", m["n"], m["fib"], tc.n, fib(tc.n))
			}
		}
	}

	for _, tc := range []struct {
		query string
		ms    int
	}{{"", 10}, {"?ms=50", 50}, {"?ms=x", 10}, {"?ms=2000", 1000}} {
		path := "/io" + tc.query
		if body, took, ok := c.get(path, "application/json"); ok {
			if m, ok := c.object(path, body, "ms"); ok && m["ms"] != tc.ms {
				c.fail(path, "got ms=%d, want %d", m["ms"], tc.ms)
			} else if ok && took < time.Duration(tc.ms)*time.Millisecond {
				c.fail(path, "answered after %v, before waiting %d ms", took.Round(time.Millisecond), tc.ms)
			}
		}
	}

	row := func(path string, m map[string]json.RawMessage) (int, bool) {
		r, ok := c.fields(path, m, []string{"id", "randomNumber"})
		if !ok {
			return 0, false
		}
		if r["id"] < 1 || r["id"] > 10000 || r["randomNumber"] < 1 || r["randomNumber"] > 10000 {
			c.fail(path, "row %v is out of range 1 to 10000", r)
			return 0, false
		}
		return r["id"], true
	}

	ids := map[int]bool{}
	for range 20 {
		body, _, ok := c.get("/db", "application/json")
		if !ok {
			break
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(body, &m); err != nil {
			c.fail("/db", "not a JSON object: %.100s", body)
			break
		}
		id, ok := row("/db", m)
		if !ok {
			break
		}
		ids[id] = true
	}
	if len(ids) > 0 && len(ids) < 10 {
		c.fail("/db", "20 requests returned only %d different rows; ids must be random", len(ids))
	}

	for _, tc := range []struct {
		query string
		n     int
	}{{"", 1}, {"?n=5", 5}, {"?n=0", 1}, {"?n=x", 1}, {"?n=1000", 500}} {
		path := "/queries" + tc.query
		body, _, ok := c.get(path, "application/json")
		if !ok {
			continue
		}
		var rows []map[string]json.RawMessage
		if err := json.Unmarshal(body, &rows); err != nil {
			c.fail(path, "not a JSON array: %.100s", body)
			continue
		}
		if len(rows) != tc.n {
			c.fail(path, "got %d rows, want %d", len(rows), tc.n)
			continue
		}
		for _, r := range rows {
			if _, ok := row(path, r); !ok {
				break
			}
		}
	}
	return c.failures
}
