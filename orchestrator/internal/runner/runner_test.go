package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/docker"
	"github.com/markmysler/lang-bench/orchestrator/internal/plan"
	"github.com/markmysler/lang-bench/orchestrator/internal/workload"
)

// fake is a Docker engine that runs nothing. Load generators print a canned oha slice per slice.
type fake struct {
	mu        sync.Mutex
	cpus      int
	missing   map[string]bool
	started   []docker.Spec
	live      map[string]docker.Spec
	unhealthy map[string]bool
	slice     string
	next      int
}

func newFake(t *testing.T) *fake {
	b, err := os.ReadFile("../oha/testdata/slice.json")
	if err != nil {
		t.Fatal(err)
	}
	var line bytes.Buffer
	json.Compact(&line, b)
	return &fake{cpus: 22, missing: map[string]bool{}, live: map[string]docker.Spec{}, unhealthy: map[string]bool{}, slice: line.String()}
}

func (f *fake) Info(context.Context) (docker.Info, error) {
	return docker.Info{NCPU: f.cpus, MemTotal: 12 << 30, ServerVersion: "29.8.0"}, nil
}

func (f *fake) ImageInspect(_ context.Context, ref string) (docker.Image, error) {
	if f.missing[ref] {
		return docker.Image{}, fmt.Errorf("%w: %s", docker.ErrNotFound, ref)
	}
	return docker.Image{ID: "sha256:" + ref, Size: 100 << 20}, nil
}

func (f *fake) EnsureNetwork(context.Context, string) error { return nil }

func (f *fake) Run(_ context.Context, s docker.Spec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	id := fmt.Sprintf("c%d", f.next)
	f.started = append(f.started, s)
	f.live[id] = s
	return id, nil
}

func (f *fake) Remove(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.live, id)
	return nil
}

func (f *fake) spec(id string) docker.Spec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.live[id]
}

func (f *fake) Inspect(_ context.Context, id string) (docker.State, error) {
	return docker.State{Running: true, Health: &struct{ Status string }{"healthy"}}, nil
}

func (f *fake) Wait(context.Context, string) (int, error) { return 0, nil }

func (f *fake) Stats(ctx context.Context, id string, fn func(docker.Sample)) error {
	for i := 0; ; i++ {
		fn(docker.Sample{Time: time.Now(), CPUPercent: 80, MemoryBytes: int64(10+i) << 20})
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func (f *fake) Logs(_ context.Context, id string, fn func(docker.Line)) error {
	s := f.spec(id)
	n := 0
	for _, e := range s.Env {
		fmt.Sscanf(e, "SLICES=%d", &n)
	}
	for range n {
		time.Sleep(2 * time.Millisecond)
		fn(docker.Line{Text: f.slice})
	}
	return nil
}

func (f *fake) ListByLabel(context.Context, string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ids []string
	for id := range f.live {
		ids = append(ids, id)
	}
	return ids, nil
}

func servers() []catalog.Server {
	return []catalog.Server{
		{ID: "go-gin", Language: "Go", Framework: "Gin"},
		{ID: "python-fastapi", Language: "Python", Framework: "FastAPI"},
		{ID: "rust-axum", Language: "Rust", Framework: "Axum"},
	}
}

func newRunner(f *fake) *Runner {
	return &Runner{
		Engine:  f,
		Servers: servers(),
		Probe: func(_ context.Context, url string) bool {
			return !f.unhealthy[url]
		},
		Settle:      time.Millisecond,
		HealthLimit: 50 * time.Millisecond,
	}
}

func config(ids ...string) Config {
	c := DefaultConfig()
	c.Servers = ids
	c.Workloads = []workload.Workload{{Name: workload.Plaintext, Connections: 16}, {Name: workload.CPU, Param: 20, Connections: 8}}
	c.WarmupSlices = 1
	c.MeasureSlices = 2
	return c
}

func collect() (func(Event), func() []Event) {
	var mu sync.Mutex
	var events []Event
	return func(e Event) {
			mu.Lock()
			events = append(events, e)
			mu.Unlock()
		}, func() []Event {
			mu.Lock()
			defer mu.Unlock()
			return slices.Clone(events)
		}
}

func TestRunsEveryServerAndWorkload(t *testing.T) {
	f := newFake(t)
	emit, _ := collect()
	res, err := newRunner(f).Run(context.Background(), config("go-gin", "rust-axum"), emit)
	if err != nil {
		t.Fatal(err)
	}
	if res.Plan.Mode != plan.ModeSimultaneous || len(res.Servers) != 2 {
		t.Fatalf("result = %+v", res)
	}
	for _, s := range res.Servers {
		if s.Error != "" || len(s.Workloads) != 2 || s.Mode != plan.ModeSimultaneous || s.BatchSize != 2 {
			t.Fatalf("server = %+v", s)
		}
		w := s.Workloads[0]
		// Two measured slices of the fixture; the warm-up slice is left out.
		if w.Summary.OK != 2*28628 || len(w.Slices) != 3 || !w.Slices[0].Warmup || w.Slices[1].Warmup {
			t.Fatalf("workload = %+v", w)
		}
		if w.CPU.Mean != 80 || w.RPSPerCore <= w.Summary.RPS {
			t.Fatalf("cpu = %+v, rps per core = %v", w.CPU, w.RPSPerCore)
		}
		if s.Image.SizeBytes != 100<<20 || s.StartupMs < 0 || s.IdleMemoryBytes == 0 {
			t.Fatalf("server = %+v", s)
		}
	}
	if len(f.live) != 0 {
		t.Fatalf("containers left running: %v", f.live)
	}
}

func TestLoadGeneratorsGetTheirOwnCoresAndTheRightURL(t *testing.T) {
	f := newFake(t)
	emit, _ := collect()
	if _, err := newRunner(f).Run(context.Background(), config("go-gin"), emit); err != nil {
		t.Fatal(err)
	}
	var server, load []docker.Spec
	for _, s := range f.started {
		switch s.Labels[labelRole] {
		case "server":
			server = append(server, s)
		case "loadgen":
			load = append(load, s)
		}
	}
	if len(server) != 1 || len(load) != 2 {
		t.Fatalf("server = %d, load = %d", len(server), len(load))
	}
	if server[0].CPUSet == load[0].CPUSet || server[0].MemoryMB != 512 || !slices.Contains(server[0].Env, "CPUS=1") {
		t.Fatalf("server = %+v, load = %+v", server[0], load[0])
	}
	if !slices.Contains(load[1].Env, "URL=http://lb-go-gin:8080/cpu?n=20") || !slices.Contains(load[1].Env, "CONNECTIONS=8") || !slices.Contains(load[1].Env, "SLICES=3") {
		t.Fatalf("load env = %v", load[1].Env)
	}
}

func TestStartsPostgresOnlyForDatabaseWorkloads(t *testing.T) {
	f := newFake(t)
	emit, _ := collect()
	if _, err := newRunner(f).Run(context.Background(), config("go-gin"), emit); err != nil {
		t.Fatal(err)
	}
	for _, s := range f.started {
		if s.Labels[labelRole] == "postgres" {
			t.Fatal("postgres started without database workloads")
		}
	}

	f = newFake(t)
	c := config("go-gin")
	c.Workloads = []workload.Workload{{Name: workload.DB, Connections: 8}}
	if _, err := newRunner(f).Run(context.Background(), c, emit); err != nil {
		t.Fatal(err)
	}
	if f.started[0].Labels[labelRole] != "postgres" {
		t.Fatalf("first container = %+v", f.started[0])
	}
}

func TestMissingImageFailsBeforeStartingAnything(t *testing.T) {
	f := newFake(t)
	f.missing["langbench/rust-axum:latest"] = true
	emit, _ := collect()
	_, err := newRunner(f).Run(context.Background(), config("go-gin", "rust-axum"), emit)
	if err == nil || !strings.Contains(err.Error(), "rust-axum") {
		t.Fatalf("err = %v", err)
	}
	if len(f.started) != 0 {
		t.Fatalf("started %d containers", len(f.started))
	}
}

func TestUnknownServer(t *testing.T) {
	emit, _ := collect()
	if _, err := newRunner(newFake(t)).Run(context.Background(), config("cobol-cics"), emit); err == nil {
		t.Fatal("want error")
	}
}

func TestUnhealthyServerIsReportedAndOthersCarryOn(t *testing.T) {
	f := newFake(t)
	f.unhealthy["http://lb-rust-axum:8080/health"] = true
	emit, _ := collect()
	res, err := newRunner(f).Run(context.Background(), config("go-gin", "rust-axum"), emit)
	if err != nil {
		t.Fatal(err)
	}
	if res.Servers[0].Error != "" || len(res.Servers[0].Workloads) != 2 {
		t.Fatalf("go-gin = %+v", res.Servers[0])
	}
	if !strings.Contains(res.Servers[1].Error, "healthy") || len(res.Servers[1].Workloads) != 0 {
		t.Fatalf("rust-axum = %+v", res.Servers[1])
	}
}

func TestLoadWithoutResultsIsAnError(t *testing.T) {
	// A server that died before the workload: the load generator prints no slices.
	f := newFake(t)
	f.slice = "Error: dns error: failed to lookup address information"
	emit, _ := collect()
	res, err := newRunner(f).Run(context.Background(), config("go-gin"), emit)
	if err != nil {
		t.Fatal(err)
	}
	w := res.Servers[0].Workloads[0]
	if !strings.Contains(w.Error, "no results") || !strings.Contains(w.Error, "dns error") {
		t.Fatalf("workload error = %q", w.Error)
	}
}

func TestBatchesAreTagged(t *testing.T) {
	f := newFake(t)
	c := config("go-gin", "python-fastapi", "rust-axum")
	c.MaxParallel = 2
	emit, _ := collect()
	res, err := newRunner(f).Run(context.Background(), c, emit)
	if err != nil {
		t.Fatal(err)
	}
	got := fmt.Sprintf("%s %d/%d %d/%d %d/%d", res.Plan.Mode,
		res.Servers[0].Batch, res.Servers[0].BatchSize,
		res.Servers[1].Batch, res.Servers[1].BatchSize,
		res.Servers[2].Batch, res.Servers[2].BatchSize)
	if got != "batched 0/2 0/2 1/1" {
		t.Fatalf("got %s", got)
	}
	if res.Servers[2].Mode != plan.ModeBatched {
		t.Fatalf("mode = %s", res.Servers[2].Mode)
	}
}

func TestEmitsLiveEvents(t *testing.T) {
	f := newFake(t)
	emit, events := collect()
	if _, err := newRunner(f).Run(context.Background(), config("go-gin", "rust-axum"), emit); err != nil {
		t.Fatal(err)
	}
	count := map[EventType]int{}
	for _, e := range events() {
		count[e.Type]++
	}
	// 2 servers x 2 workloads x 3 slices
	if count[EventSlice] != 12 || count[EventPlan] != 1 || count[EventReady] != 2 || count[EventWorkloadDone] != 4 || count[EventDone] != 1 {
		t.Fatalf("events = %v", count)
	}
	if count[EventStats] == 0 {
		t.Fatal("no stats events")
	}
}

func TestCancelRemovesContainers(t *testing.T) {
	f := newFake(t)
	ctx, cancel := context.WithCancel(context.Background())
	emit := func(e Event) {
		if e.Type == EventSlice {
			cancel()
		}
	}
	_, err := newRunner(f).Run(ctx, config("go-gin"), emit)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if len(f.live) != 0 {
		t.Fatalf("containers left running: %v", f.live)
	}
}
