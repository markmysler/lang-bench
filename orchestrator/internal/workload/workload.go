// Package workload defines the endpoints a run puts under load (docs/SPEC.md).
package workload

import (
	"errors"
	"fmt"
	"strconv"
)

// Names of the workloads.
const (
	Plaintext = "plaintext"
	JSON      = "json"
	CPU       = "cpu"
	IO        = "io"
	DB        = "db"
	Queries   = "queries"
)

type kind struct {
	path, param string
	lo, hi      int
	def         int
	conns       int
}

var kinds = map[string]kind{
	Plaintext: {path: "/plaintext", conns: 64},
	JSON:      {path: "/json", conns: 64},
	CPU:       {path: "/cpu", param: "n", lo: 0, hi: 32, def: 20, conns: 64},
	// Waiting is cheap, so more connections are needed to show how many waits a server can hold.
	IO:      {path: "/io", param: "ms", lo: 0, hi: 1000, def: 10, conns: 256},
	DB:      {path: "/db", conns: 64},
	Queries: {path: "/queries", param: "n", lo: 1, hi: 500, def: 20, conns: 64},
}

// Order is the order workloads run in.
var Order = []string{Plaintext, JSON, CPU, IO, DB, Queries}

// Workload is one endpoint under load.
type Workload struct {
	Name string `json:"name"`
	// Param is n for cpu and queries, ms for io, and unused otherwise.
	Param       int `json:"param"`
	Connections int `json:"connections"`
}

// Path is the request path, with its parameter.
func (w Workload) Path() string {
	k := kinds[w.Name]
	if k.param == "" {
		return k.path
	}
	return k.path + "?" + k.param + "=" + strconv.Itoa(w.Param)
}

// Defaults are every workload with its default parameter and connections.
func Defaults() []Workload {
	out := make([]Workload, len(Order))
	for i, name := range Order {
		k := kinds[name]
		out[i] = Workload{Name: name, Param: k.def, Connections: k.conns}
	}
	return out
}

// Validate checks names, parameters and connections.
func Validate(ws []Workload) error {
	if len(ws) == 0 {
		return errors.New("choose at least one workload")
	}
	seen := map[string]bool{}
	for _, w := range ws {
		k, ok := kinds[w.Name]
		if !ok {
			return fmt.Errorf("unknown workload %q", w.Name)
		}
		if seen[w.Name] {
			return fmt.Errorf("workload %q is listed twice", w.Name)
		}
		seen[w.Name] = true
		if k.param != "" && (w.Param < k.lo || w.Param > k.hi) {
			return fmt.Errorf("%s: %s must be between %d and %d", w.Name, k.param, k.lo, k.hi)
		}
		if w.Connections < 1 || w.Connections > 10000 {
			return fmt.Errorf("%s: connections must be between 1 and 10000", w.Name)
		}
	}
	return nil
}

// NeedsDatabase says whether any of the workloads uses Postgres.
func NeedsDatabase(ws []Workload) bool {
	for _, w := range ws {
		if w.Name == DB || w.Name == Queries {
			return true
		}
	}
	return false
}
