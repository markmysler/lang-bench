package oha

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"testing"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/slice.json")
	if err != nil {
		t.Fatal(err)
	}
	// The load generator prints each slice on one line.
	var out bytes.Buffer
	if err := json.Compact(&out, b); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6*math.Max(1, math.Abs(b)) }

func TestParsesARealSlice(t *testing.T) {
	s, err := ParseSlice(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if s.OK != 28628 {
		t.Errorf("ok = %d", s.OK)
	}
	// Requests cut off by the end of the slice are not errors of the server.
	if s.Errors != 0 || s.Non2xx != 0 {
		t.Errorf("errors = %d, non2xx = %d", s.Errors, s.Non2xx)
	}
	if !near(s.Seconds, 1.004525639) {
		t.Errorf("seconds = %v", s.Seconds)
	}
	if !near(s.RPS, 28628/1.004525639) {
		t.Errorf("rps = %v", s.RPS)
	}
	// Latencies are in milliseconds.
	if !near(s.Latency.P50, 0.123936) || !near(s.Latency.P99, 0.289691) || !near(s.Latency.Max, 2.903485) {
		t.Errorf("latency = %+v", s.Latency)
	}
}

func TestCountsErrorsAndNon2xx(t *testing.T) {
	line := []byte(`{"summary":{"total":1.0,"slowest":0.01,"fastest":0.001,"average":0.002},
		"latencyPercentiles":{"p50":0.002,"p99":0.009},
		"statusCodeDistribution":{"200":90,"500":7},
		"errorDistribution":{"connection reset":3,"aborted due to deadline":5}}`)
	s, err := ParseSlice(line)
	if err != nil {
		t.Fatal(err)
	}
	if s.OK != 90 || s.Non2xx != 7 || s.Errors != 3 {
		t.Fatalf("slice = %+v", s)
	}
	if !near(s.RPS, 90) {
		t.Fatalf("rps = %v", s.RPS)
	}
}

func TestRejectsNonJSON(t *testing.T) {
	if _, err := ParseSlice([]byte("Error: connection refused")); err == nil {
		t.Fatal("want error")
	}
}

func TestEmptySliceHasNoLatency(t *testing.T) {
	// A server that answers nothing in a slice: oha reports no percentiles at all.
	s, err := ParseSlice([]byte(`{"summary":{"total":1.0},"statusCodeDistribution":{},"errorDistribution":{"connection refused":12}}`))
	if err != nil {
		t.Fatal(err)
	}
	if s.OK != 0 || s.Errors != 12 || s.Latency.P50 != 0 {
		t.Fatalf("slice = %+v", s)
	}
}

func uniform(lo, hi float64, ok int) Slice {
	at := func(q float64) float64 { return lo + (hi-lo)*q }
	return Slice{
		OK: ok, Seconds: 1, RPS: float64(ok),
		Latency: Latency{
			Min: lo, P10: at(.10), P25: at(.25), P50: at(.5), P75: at(.75), P90: at(.9),
			P95: at(.95), P99: at(.99), P999: at(.999), P9999: at(.9999), Max: hi,
		},
	}
}

func TestMergingIdenticalSlicesKeepsTheirPercentiles(t *testing.T) {
	a := uniform(1, 11, 100)
	m := Merge([]Slice{a, a, a})
	if m.OK != 300 || !near(m.RPS, 100) {
		t.Fatalf("merged = %+v", m)
	}
	for _, c := range []struct{ got, want float64 }{
		{m.Latency.P50, 6}, {m.Latency.P90, 10}, {m.Latency.P99, 10.9}, {m.Latency.Min, 1}, {m.Latency.Max, 11},
	} {
		if math.Abs(c.got-c.want) > 0.01 {
			t.Fatalf("latency = %+v", m.Latency)
		}
	}
}

func TestMergingWeighsSlicesByRequests(t *testing.T) {
	// 900 fast requests between 0 and 1 ms, 100 slow ones between 10 and 20 ms: the median is in
	// the fast group and p99 is in the slow one.
	m := Merge([]Slice{uniform(0, 1, 900), uniform(10, 20, 100)})
	if m.Latency.P50 >= 1 {
		t.Errorf("p50 = %v, want under 1", m.Latency.P50)
	}
	if math.Abs(m.Latency.P99-19) > 0.05 {
		t.Errorf("p99 = %v, want about 19", m.Latency.P99)
	}
	if math.Abs(m.Latency.P95-15) > 0.05 {
		t.Errorf("p95 = %v, want about 15", m.Latency.P95)
	}
	if !near(m.RPS, 500) { // 1000 requests over 2 seconds
		t.Errorf("rps = %v", m.RPS)
	}
}

func TestMergeSumsErrorsAndSkipsEmptySlices(t *testing.T) {
	answered := uniform(1, 2, 10)
	answered.Non2xx = 1
	empty := Slice{Seconds: 1, Errors: 4}
	m := Merge([]Slice{answered, empty})
	if m.Errors != 4 || m.Non2xx != 1 || m.OK != 10 || !near(m.Seconds, 2) {
		t.Fatalf("merged = %+v", m)
	}
	if math.Abs(m.Latency.P50-1.5) > 0.01 {
		t.Fatalf("p50 = %v", m.Latency.P50)
	}
}

func TestMergeOfNothing(t *testing.T) {
	if m := Merge(nil); m.OK != 0 || m.RPS != 0 {
		t.Fatalf("merged = %+v", m)
	}
}
