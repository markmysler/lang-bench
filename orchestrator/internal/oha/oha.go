// Package oha reads the JSON that oha prints for each one-second slice of load, and merges
// slices into one summary.
package oha

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Latency is in milliseconds.
type Latency struct {
	Min   float64 `json:"min"`
	Mean  float64 `json:"mean"`
	P10   float64 `json:"p10"`
	P25   float64 `json:"p25"`
	P50   float64 `json:"p50"`
	P75   float64 `json:"p75"`
	P90   float64 `json:"p90"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
	P999  float64 `json:"p999"`
	P9999 float64 `json:"p9999"`
	Max   float64 `json:"max"`
}

// Slice is the outcome of one slice, or of several merged.
type Slice struct {
	// OK counts 2xx responses. Only these count towards throughput.
	OK int `json:"ok"`
	// Non2xx counts responses with any other status.
	Non2xx int `json:"non2xx"`
	// Errors counts requests that got no response, apart from those cut off by the end of a slice.
	Errors  int     `json:"errors"`
	Seconds float64 `json:"seconds"`
	RPS     float64 `json:"rps"`
	Latency Latency `json:"latency"`
}

type raw struct {
	Summary struct {
		Total   float64 `json:"total"`
		Slowest float64 `json:"slowest"`
		Fastest float64 `json:"fastest"`
		Average float64 `json:"average"`
	} `json:"summary"`
	Percentiles map[string]float64 `json:"latencyPercentiles"`
	Status      map[string]int     `json:"statusCodeDistribution"`
	Errors      map[string]int     `json:"errorDistribution"`
}

// ParseSlice reads one slice of oha's --output-format json.
func ParseSlice(line []byte) (Slice, error) {
	var r raw
	if err := json.Unmarshal(line, &r); err != nil {
		return Slice{}, fmt.Errorf("not an oha result: %.80q", line)
	}
	var s Slice
	for code, n := range r.Status {
		if strings.HasPrefix(code, "2") {
			s.OK += n
		} else {
			s.Non2xx += n
		}
	}
	for msg, n := range r.Errors {
		if !strings.Contains(msg, "aborted due to deadline") {
			s.Errors += n
		}
	}
	s.Seconds = r.Summary.Total
	if s.Seconds > 0 {
		s.RPS = float64(s.OK) / s.Seconds
	}
	if s.OK+s.Non2xx > 0 {
		ms := func(key string) float64 { return r.Percentiles[key] * 1000 }
		s.Latency = Latency{
			Min: r.Summary.Fastest * 1000, Mean: r.Summary.Average * 1000,
			P10: ms("p10"), P25: ms("p25"), P50: ms("p50"), P75: ms("p75"), P90: ms("p90"),
			P95: ms("p95"), P99: ms("p99"), P999: ms("p99.9"), P9999: ms("p99.99"),
			Max: r.Summary.Slowest * 1000,
		}
	}
	return s, nil
}

// point is one known spot on a slice's latency distribution: q of its requests took at most ms.
type point struct{ q, ms float64 }

func (l Latency) curve() []point {
	return []point{
		{0, l.Min}, {.10, l.P10}, {.25, l.P25}, {.50, l.P50}, {.75, l.P75}, {.90, l.P90},
		{.95, l.P95}, {.99, l.P99}, {.999, l.P999}, {.9999, l.P9999}, {1, l.Max},
	}
}

// cdf is the share of a slice's requests that took at most ms, interpolating between the
// percentiles oha reports.
func cdf(c []point, ms float64) float64 {
	if ms < c[0].ms {
		return 0
	}
	for i := 1; i < len(c); i++ {
		if ms < c[i].ms {
			a, b := c[i-1], c[i]
			return a.q + (b.q-a.q)*(ms-a.ms)/(b.ms-a.ms)
		}
	}
	return 1
}

// Merge combines slices. Throughput and counts are exact. oha only reports percentiles per
// slice, so merged percentiles come from the mixture of the slices' distributions, each
// weighted by its responses: an approximation that is exact when slices agree.
func Merge(slices []Slice) Slice {
	var m Slice
	type weighted struct {
		c []point
		w float64
	}
	var parts []weighted
	var answered int
	var meanSum float64
	for _, s := range slices {
		m.OK += s.OK
		m.Non2xx += s.Non2xx
		m.Errors += s.Errors
		m.Seconds += s.Seconds
		if n := s.OK + s.Non2xx; n > 0 {
			answered += n
			meanSum += s.Latency.Mean * float64(n)
			parts = append(parts, weighted{s.Latency.curve(), float64(n)})
		}
	}
	if m.Seconds > 0 {
		m.RPS = float64(m.OK) / m.Seconds
	}
	if answered == 0 {
		return m
	}

	lo, hi := parts[0].c[0].ms, parts[0].c[10].ms
	var xs []float64
	for _, p := range parts {
		lo, hi = min(lo, p.c[0].ms), max(hi, p.c[10].ms)
		for _, pt := range p.c {
			xs = append(xs, pt.ms)
		}
	}
	sort.Float64s(xs)
	mixture := func(ms float64) float64 {
		var f float64
		for _, p := range parts {
			f += p.w * cdf(p.c, ms)
		}
		return f / float64(answered)
	}
	// The mixture is piecewise linear between the slices' known points, so the inverse is found
	// exactly by locating the segment and interpolating within it.
	quantile := func(q float64) float64 {
		i := sort.Search(len(xs), func(i int) bool { return mixture(xs[i]) >= q-1e-12 })
		if i == 0 {
			return xs[0]
		}
		if i == len(xs) {
			return xs[len(xs)-1]
		}
		a, b := xs[i-1], xs[i]
		fa, fb := mixture(a), mixture(b)
		if fb == fa {
			return b
		}
		return a + (b-a)*(q-fa)/(fb-fa)
	}
	m.Latency = Latency{
		Min: lo, Mean: meanSum / float64(answered),
		P10: quantile(.10), P25: quantile(.25), P50: quantile(.50), P75: quantile(.75),
		P90: quantile(.90), P95: quantile(.95), P99: quantile(.99), P999: quantile(.999),
		P9999: quantile(.9999), Max: hi,
	}
	return m
}
