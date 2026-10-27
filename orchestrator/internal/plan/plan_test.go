package plan

import (
	"strings"
	"testing"
)

var small = Preset{ID: "1cpu", CPUs: 1, MemoryMB: 512}

func defaults() Options {
	return Options{
		BudgetPercent:   75,
		Preset:          small,
		LoadgenCPUs:     2,
		LoadgenMemoryMB: 256,
		Database:        true,
		DBCPUs:          2,
		DBMemoryMB:      1024,
	}
}

func ids(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = string(rune('a' + i))
	}
	return out
}

func TestFillsTheBudgetThenRunsTheRestInLaterBatches(t *testing.T) {
	// 22 CPUs at 75% is 16 cores; 2 go to Postgres, and each server needs 1 + 2 for its load
	// generator, so 4 servers fit at once.
	p, err := Make(Host{CPUs: 22, MemoryMB: 11958}, ids(5), defaults())
	if err != nil {
		t.Fatal(err)
	}
	if p.Parallel != 4 {
		t.Fatalf("parallel = %d, want 4", p.Parallel)
	}
	if len(p.Batches) != 2 || len(p.Batches[0].Slots) != 4 || len(p.Batches[1].Slots) != 1 {
		t.Fatalf("batches = %+v", p.Batches)
	}
	if p.Mode != ModeBatched {
		t.Fatalf("mode = %q, want %q", p.Mode, ModeBatched)
	}
}

func TestEverythingAtOnceWhenItFits(t *testing.T) {
	p, err := Make(Host{CPUs: 22, MemoryMB: 11958}, ids(3), defaults())
	if err != nil {
		t.Fatal(err)
	}
	if p.Mode != ModeSimultaneous || len(p.Batches) != 1 || len(p.Batches[0].Slots) != 3 {
		t.Fatalf("plan = %+v", p)
	}
}

func TestMaxParallelOneIsSequential(t *testing.T) {
	o := defaults()
	o.MaxParallel = 1
	p, err := Make(Host{CPUs: 22, MemoryMB: 11958}, ids(3), o)
	if err != nil {
		t.Fatal(err)
	}
	if p.Mode != ModeSequential || len(p.Batches) != 3 {
		t.Fatalf("plan = %+v", p)
	}
}

func TestOneServerIsSequential(t *testing.T) {
	p, err := Make(Host{CPUs: 22, MemoryMB: 11958}, ids(1), defaults())
	if err != nil {
		t.Fatal(err)
	}
	if p.Mode != ModeSequential {
		t.Fatalf("mode = %q", p.Mode)
	}
}

func TestMemoryCanBeTheLimit(t *testing.T) {
	// 64 CPUs but 4 GB: 3072 MB budget, 1024 for Postgres, 768 per slot leaves room for 2.
	p, err := Make(Host{CPUs: 64, MemoryMB: 4096}, ids(5), defaults())
	if err != nil {
		t.Fatal(err)
	}
	if p.Parallel != 2 {
		t.Fatalf("parallel = %d, want 2", p.Parallel)
	}
}

func TestNoDatabaseNoDatabaseCores(t *testing.T) {
	o := defaults()
	o.Database = false
	p, err := Make(Host{CPUs: 22, MemoryMB: 11958}, ids(6), o)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.DBCPUs) != 0 {
		t.Fatalf("db cpus = %v", p.DBCPUs)
	}
	if p.Parallel != 5 { // 16 cores / 3 per slot
		t.Fatalf("parallel = %d, want 5", p.Parallel)
	}
}

func TestTooSmallHostExplainsWhy(t *testing.T) {
	o := defaults()
	o.Preset = Preset{ID: "4cpu", CPUs: 4, MemoryMB: 2048}
	_, err := Make(Host{CPUs: 4, MemoryMB: 8192}, ids(1), o)
	if err == nil || !strings.Contains(err.Error(), "CPU") {
		t.Fatalf("err = %v", err)
	}
}

func TestNoServersIsAnError(t *testing.T) {
	if _, err := Make(Host{CPUs: 8, MemoryMB: 8192}, nil, defaults()); err == nil {
		t.Fatal("want error")
	}
}

func TestCoresNeverOverlapAndStayOnTheHost(t *testing.T) {
	for _, cpus := range []int{4, 6, 8, 12, 16, 22, 32, 64} {
		for _, preset := range Presets {
			for _, db := range []bool{false, true} {
				o := defaults()
				o.Preset = preset
				o.Database = db
				p, err := Make(Host{CPUs: cpus, MemoryMB: 65536}, ids(9), o)
				if err != nil {
					continue
				}
				for bi, b := range p.Batches {
					used := map[int]bool{}
					all := append([]int{}, p.DBCPUs...)
					for _, s := range b.Slots {
						if len(s.ServerCPUs) != preset.CPUs || len(s.LoadgenCPUs) != o.LoadgenCPUs {
							t.Fatalf("%d cpus %s: slot %+v", cpus, preset.ID, s)
						}
						all = append(all, s.ServerCPUs...)
						all = append(all, s.LoadgenCPUs...)
					}
					for _, c := range all {
						if c < 0 || c >= cpus {
							t.Fatalf("%d cpus: core %d out of range", cpus, c)
						}
						if used[c] {
							t.Fatalf("%d cpus %s batch %d: core %d used twice", cpus, preset.ID, bi, c)
						}
						used[c] = true
					}
				}
			}
		}
	}
}

func TestKeepsCoreZeroForTheSystemOnLargerHosts(t *testing.T) {
	p, err := Make(Host{CPUs: 8, MemoryMB: 16384}, ids(2), defaults())
	if err != nil {
		t.Fatal(err)
	}
	if p.DBCPUs[0] != 1 {
		t.Fatalf("db cpus = %v, want to start at 1", p.DBCPUs)
	}
}

func TestCPUSet(t *testing.T) {
	if got := CPUSet([]int{3, 4, 5}); got != "3,4,5" {
		t.Fatalf("got %q", got)
	}
}
