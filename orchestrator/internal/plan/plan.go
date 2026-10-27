// Package plan decides how many servers can be benchmarked at once on this host, and pins each
// container to its own CPU cores so that no two containers share a core.
package plan

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Preset is the size every server container gets in a run.
type Preset struct {
	ID       string `json:"id"`
	CPUs     int    `json:"cpus"`
	MemoryMB int    `json:"memoryMB"`
}

// Presets are the sizes offered in the dashboard.
var Presets = []Preset{
	{ID: "1cpu-512mb", CPUs: 1, MemoryMB: 512},
	{ID: "2cpu-1gb", CPUs: 2, MemoryMB: 1024},
	{ID: "4cpu-2gb", CPUs: 4, MemoryMB: 2048},
}

// PresetByID returns the preset with that id.
func PresetByID(id string) (Preset, bool) {
	for _, p := range Presets {
		if p.ID == id {
			return p, true
		}
	}
	return Preset{}, false
}

// Host is what Docker can use: on Docker Desktop, the Linux VM rather than the whole machine.
type Host struct {
	CPUs     int `json:"cpus"`
	MemoryMB int `json:"memoryMB"`
}

// Options are the run settings that affect placement.
type Options struct {
	// BudgetPercent is the share of the host's CPUs and memory that a run may use.
	BudgetPercent   int    `json:"budgetPercent"`
	Preset          Preset `json:"preset"`
	LoadgenCPUs     int    `json:"loadgenCpus"`
	LoadgenMemoryMB int    `json:"loadgenMemoryMB"`
	Database        bool   `json:"database"`
	DBCPUs          int    `json:"dbCpus"`
	DBMemoryMB      int    `json:"dbMemoryMB"`
	// MaxParallel caps how many servers run at once. Zero means as many as fit.
	MaxParallel int `json:"maxParallel"`
}

// Mode says how the servers in a run shared the host. Every result is tagged with it.
type Mode string

const (
	// ModeSimultaneous: every server ran at the same time.
	ModeSimultaneous Mode = "simultaneous"
	// ModeBatched: as many as fit ran at the same time, and the rest in later batches.
	ModeBatched Mode = "batched"
	// ModeSequential: one server at a time.
	ModeSequential Mode = "sequential"
)

// Slot is one server and its load generator, each on their own cores.
type Slot struct {
	Server      string `json:"server"`
	ServerCPUs  []int  `json:"serverCpus"`
	LoadgenCPUs []int  `json:"loadgenCpus"`
}

// Batch is a group of servers benchmarked at the same time.
type Batch struct {
	Slots []Slot `json:"slots"`
}

// Plan is the placement for a whole run.
type Plan struct {
	Mode           Mode    `json:"mode"`
	Parallel       int     `json:"parallel"`
	BudgetCPUs     int     `json:"budgetCpus"`
	BudgetMemoryMB int     `json:"budgetMemoryMB"`
	DBCPUs         []int   `json:"dbCpus"`
	Batches        []Batch `json:"batches"`
}

// Make places the servers on the host within the budget.
func Make(host Host, servers []string, o Options) (Plan, error) {
	if len(servers) == 0 {
		return Plan{}, errors.New("choose at least one server")
	}
	if o.BudgetPercent <= 0 || o.BudgetPercent > 100 {
		return Plan{}, fmt.Errorf("budget must be between 1 and 100%%, not %d%%", o.BudgetPercent)
	}

	// On larger hosts core 0 is left to the OS, Docker and this orchestrator.
	first := 0
	if host.CPUs >= 4 {
		first = 1
	}
	cores := min(host.CPUs*o.BudgetPercent/100, host.CPUs-first)
	memory := host.MemoryMB * o.BudgetPercent / 100

	p := Plan{BudgetCPUs: cores, BudgetMemoryMB: memory}
	next := first
	take := func(n int) []int {
		out := make([]int, n)
		for i := range out {
			out[i] = next
			next++
		}
		return out
	}

	if o.Database {
		cores -= o.DBCPUs
		memory -= o.DBMemoryMB
		if cores < 0 || memory < 0 {
			return Plan{}, fmt.Errorf("the budget (%d CPUs, %d MB) is too small for Postgres alone", p.BudgetCPUs, p.BudgetMemoryMB)
		}
		p.DBCPUs = take(o.DBCPUs)
	}

	slotCPUs := o.Preset.CPUs + o.LoadgenCPUs
	slotMemory := o.Preset.MemoryMB + o.LoadgenMemoryMB
	byCPU := cores / slotCPUs
	byMemory := memory / slotMemory
	if byCPU < 1 {
		return Plan{}, fmt.Errorf("one server needs %d CPUs (%d for it, %d for its load generator), but only %d are left in the budget; raise the budget or pick a smaller preset", slotCPUs, o.Preset.CPUs, o.LoadgenCPUs, cores)
	}
	if byMemory < 1 {
		return Plan{}, fmt.Errorf("one server needs %d MB, but only %d MB are left in the budget; raise the budget or pick a smaller preset", slotMemory, memory)
	}

	p.Parallel = min(byCPU, byMemory, len(servers))
	if o.MaxParallel > 0 {
		p.Parallel = min(p.Parallel, o.MaxParallel)
	}
	switch {
	case p.Parallel == 1:
		p.Mode = ModeSequential
	case p.Parallel >= len(servers):
		p.Mode = ModeSimultaneous
	default:
		p.Mode = ModeBatched
	}

	// Every batch reuses the same cores, so a server's placement depends only on its position.
	start := next
	for i := 0; i < len(servers); i += p.Parallel {
		var b Batch
		next = start
		for _, id := range servers[i:min(i+p.Parallel, len(servers))] {
			b.Slots = append(b.Slots, Slot{Server: id, ServerCPUs: take(o.Preset.CPUs), LoadgenCPUs: take(o.LoadgenCPUs)})
		}
		p.Batches = append(p.Batches, b)
	}
	return p, nil
}

// CPUSet formats cores for Docker's --cpuset-cpus.
func CPUSet(cores []int) string {
	s := make([]string, len(cores))
	for i, c := range cores {
		s[i] = strconv.Itoa(c)
	}
	return strings.Join(s, ",")
}
