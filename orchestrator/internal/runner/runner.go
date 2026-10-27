// Package runner carries out a benchmark run: it starts Postgres if needed, then each batch of
// servers with a load generator per server, and reports what happens as it happens.
package runner

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/conform"
	"github.com/markmysler/lang-bench/orchestrator/internal/docker"
	"github.com/markmysler/lang-bench/orchestrator/internal/oha"
	"github.com/markmysler/lang-bench/orchestrator/internal/plan"
	"github.com/markmysler/lang-bench/orchestrator/internal/workload"
)

// Names shared with the images in db/ and loadgen/.
const (
	Network       = "langbench"
	PostgresImage = "langbench/postgres:latest"
	LoadgenImage  = "langbench/loadgen:latest"
	postgresName  = "lb-postgres"

	labelRun  = "langbench"
	labelRole = "langbench.role"

	loadgenMemoryMB = 256
	dbCPUs          = 2
	dbMemoryMB      = 1024
)

// Engine is the part of Docker the runner needs.
type Engine interface {
	Info(ctx context.Context) (docker.Info, error)
	ImageInspect(ctx context.Context, ref string) (docker.Image, error)
	EnsureNetwork(ctx context.Context, name string) error
	Run(ctx context.Context, s docker.Spec) (string, error)
	Remove(ctx context.Context, id string) error
	Inspect(ctx context.Context, id string) (docker.State, error)
	Wait(ctx context.Context, id string) (int, error)
	Stats(ctx context.Context, id string, fn func(docker.Sample)) error
	Logs(ctx context.Context, id string, fn func(docker.Line)) error
	ListByLabel(ctx context.Context, label string) ([]string, error)
}

// Config is what the user chooses for a run.
type Config struct {
	Servers   []string            `json:"servers"`
	Workloads []workload.Workload `json:"workloads"`
	Preset    string              `json:"preset"`
	// BudgetPercent is the share of the host's CPUs and memory the run may use.
	BudgetPercent int `json:"budgetPercent"`
	// MaxParallel caps how many servers run at once. Zero means as many as the budget allows.
	MaxParallel int `json:"maxParallel"`
	// Load is applied in one-second slices; warm-up slices are shown live but not counted.
	WarmupSlices  int `json:"warmupSlices"`
	MeasureSlices int `json:"measureSlices"`
	LoadgenCPUs   int `json:"loadgenCpus"`
	DBPool        int `json:"dbPool"`
}

// DefaultConfig is the run the dashboard proposes.
func DefaultConfig() Config {
	return Config{
		Workloads:     workload.Defaults(),
		Preset:        plan.Presets[0].ID,
		BudgetPercent: 75,
		WarmupSlices:  5,
		MeasureSlices: 15,
		LoadgenCPUs:   2,
		DBPool:        16,
	}
}

func (c Config) validate() error {
	if err := workload.Validate(c.Workloads); err != nil {
		return err
	}
	if _, ok := plan.PresetByID(c.Preset); !ok {
		return fmt.Errorf("unknown preset %q", c.Preset)
	}
	if c.WarmupSlices < 0 || c.WarmupSlices > 300 || c.MeasureSlices < 1 || c.MeasureSlices > 600 {
		return errors.New("warm-up must be 0 to 300 seconds and measurement 1 to 600 seconds")
	}
	if c.LoadgenCPUs < 1 || c.LoadgenCPUs > 16 {
		return errors.New("the load generator needs 1 to 16 CPUs")
	}
	if c.DBPool < 1 || c.DBPool > 256 {
		return errors.New("the database pool must be 1 to 256 connections")
	}
	return nil
}

// Preview places a run on a host without starting it.
func Preview(cfg Config, host plan.Host) (plan.Plan, error) {
	if err := cfg.validate(); err != nil {
		return plan.Plan{}, err
	}
	preset, _ := plan.PresetByID(cfg.Preset)
	return plan.Make(host, cfg.Servers, plan.Options{
		BudgetPercent: cfg.BudgetPercent, Preset: preset, MaxParallel: cfg.MaxParallel,
		LoadgenCPUs: cfg.LoadgenCPUs, LoadgenMemoryMB: loadgenMemoryMB,
		Database: workload.NeedsDatabase(cfg.Workloads), DBCPUs: dbCPUs, DBMemoryMB: dbMemoryMB,
	})
}

// Runner runs benchmarks. Only one run at a time: container names are fixed.
type Runner struct {
	Engine  Engine
	Servers []catalog.Server
	// Probe reports whether a server's /health answers 200. Nil uses HTTP.
	Probe func(ctx context.Context, url string) bool
	// Settle is the pause after servers become healthy and between workloads.
	Settle time.Duration
	// HealthLimit is how long a server may take to become healthy.
	HealthLimit time.Duration
	// Host adds details the Docker API does not give, such as the CPU model.
	Host func(*HostInfo)
	// Commit is the git commit the run was made from, if known.
	Commit string
}

func (r *Runner) healthLimit() time.Duration {
	if r.HealthLimit == 0 {
		return 2 * time.Minute
	}
	return r.HealthLimit
}

func (r *Runner) probe(ctx context.Context, url string) bool {
	if r.Probe != nil {
		return r.Probe(ctx, url)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

// run is the state of one run in progress.
type run struct {
	*Runner
	ctx    context.Context
	cfg    Config
	preset plan.Preset
	emit   func(Event)
	mu     sync.Mutex
}

func (r *run) send(e Event) {
	e.Time = time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	r.emit(e)
}

// Run carries out a run, sending events to emit as it goes. emit is never called concurrently.
// Every container it starts is removed before it returns, even when ctx is cancelled.
func (r *Runner) Run(ctx context.Context, cfg Config, emit func(Event)) (res Result, err error) {
	res = Result{Schema: Schema, ID: newID(), StartedAt: time.Now().UTC(), Config: cfg, Commit: r.Commit}
	if err := cfg.validate(); err != nil {
		return res, err
	}
	preset, _ := plan.PresetByID(cfg.Preset)
	var servers []catalog.Server
	for _, id := range cfg.Servers {
		s, ok := catalog.Find(r.Servers, id)
		if !ok {
			return res, fmt.Errorf("unknown server %q", id)
		}
		servers = append(servers, s)
	}

	info, err := r.Engine.Info(ctx)
	if err != nil {
		return res, err
	}
	res.Host = HostInfo{
		CPUs: info.NCPU, MemoryMB: int(info.MemTotal >> 20), DockerVersion: info.ServerVersion,
		OS: info.OperatingSystem, Kernel: info.KernelVersion, Arch: info.Architecture,
	}
	if r.Host != nil {
		r.Host(&res.Host)
	}
	needDB := workload.NeedsDatabase(cfg.Workloads)
	res.Plan, err = Preview(cfg, plan.Host{CPUs: info.NCPU, MemoryMB: res.Host.MemoryMB})
	if err != nil {
		return res, err
	}

	// Check every image first, so a missing one fails the run before anything starts.
	images := map[string]docker.Image{}
	refs := []string{LoadgenImage}
	if needDB {
		refs = append(refs, PostgresImage)
	}
	for _, s := range servers {
		refs = append(refs, s.Image())
	}
	for _, ref := range refs {
		img, err := r.Engine.ImageInspect(ctx, ref)
		if errors.Is(err, docker.ErrNotFound) {
			return res, fmt.Errorf("image %s is not built yet: build it first", ref)
		} else if err != nil {
			return res, err
		}
		images[ref] = img
	}

	rn := &run{Runner: r, ctx: ctx, cfg: cfg, preset: preset, emit: emit}
	rn.send(Event{Type: EventPlan, Plan: &res.Plan, Host: &res.Host, Config: &res.Config})

	// Remove leftovers from a run that was interrupted, and everything from this one at the end.
	r.removeAll()
	defer r.removeAll()

	if err := r.Engine.EnsureNetwork(ctx, Network); err != nil {
		return res, err
	}
	if needDB {
		if err := rn.startPostgres(res.Plan.DBCPUs); err != nil {
			return res, err
		}
	}

	byID := map[string]catalog.Server{}
	for _, s := range servers {
		byID[s.ID] = s
	}
	for bi, b := range res.Plan.Batches {
		rn.send(Event{Type: EventStatus, Message: fmt.Sprintf("Batch %d of %d", bi+1, len(res.Plan.Batches))})
		results := rn.batch(b, byID, images)
		for i := range results {
			results[i].Mode = res.Plan.Mode
			results[i].Batch = bi
			results[i].BatchSize = len(b.Slots)
		}
		res.Servers = append(res.Servers, results...)
		if err := ctx.Err(); err != nil {
			return res, err
		}
	}
	res.FinishedAt = time.Now().UTC()
	rn.send(Event{Type: EventDone, Result: &res})
	return res, nil
}

func (r *Runner) removeAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ids, err := r.Engine.ListByLabel(ctx, labelRun)
	if err != nil {
		return
	}
	for _, id := range ids {
		r.Engine.Remove(ctx, id)
	}
}

func (r *run) startPostgres(cores []int) error {
	r.send(Event{Type: EventStatus, Message: "Starting Postgres"})
	id, err := r.Engine.Run(r.ctx, docker.Spec{
		Name: postgresName, Image: PostgresImage, Network: Network,
		CPUSet: plan.CPUSet(cores), CPUs: float64(len(cores)), MemoryMB: dbMemoryMB,
		Labels: map[string]string{labelRun: "", labelRole: "postgres"},
	})
	if err != nil {
		return err
	}
	deadline := time.Now().Add(r.healthLimit())
	for {
		st, err := r.Engine.Inspect(r.ctx, id)
		if err != nil {
			return err
		}
		if st.Health != nil && st.Health.Status == "healthy" {
			return nil
		}
		if !st.Running {
			return fmt.Errorf("postgres exited with code %d", st.ExitCode)
		}
		if time.Now().After(deadline) {
			return errors.New("postgres did not become healthy in time")
		}
		select {
		case <-r.ctx.Done():
			return r.ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// server is one server running in a batch.
type server struct {
	slot      plan.Slot
	def       catalog.Server
	id        string
	result    *ServerResult
	stopStats context.CancelFunc

	mu sync.Mutex
	// samples for the workload being measured, and for the slice in progress.
	measuring    bool
	measured     []docker.Sample
	sliceSamples []docker.Sample
	last         docker.Sample
	peak         int64
}

func (s *server) record(x docker.Sample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.last = x
	s.peak = max(s.peak, x.MemoryBytes)
	s.sliceSamples = append(s.sliceSamples, x)
	if s.measuring {
		s.measured = append(s.measured, x)
	}
}

func (r *run) batch(b plan.Batch, byID map[string]catalog.Server, images map[string]docker.Image) []ServerResult {
	out := make([]ServerResult, len(b.Slots))
	srvs := make([]*server, len(b.Slots))
	var wg sync.WaitGroup
	for i, slot := range b.Slots {
		def := byID[slot.Server]
		img := images[def.Image()]
		out[i] = ServerResult{
			Server: def, CPUSet: plan.CPUSet(slot.ServerCPUs), LoadgenCPUSet: plan.CPUSet(slot.LoadgenCPUs),
			Image: ImageInfo{ID: img.ID, SizeBytes: img.Size},
		}
		if len(img.RepoDigests) > 0 {
			out[i].Image.Digest = img.RepoDigests[0]
		}
		srvs[i] = &server{slot: slot, def: def, result: &out[i]}
		wg.Go(func() { r.start(srvs[i]) })
	}
	wg.Wait()
	defer func() {
		for _, s := range srvs {
			if s.stopStats != nil {
				s.stopStats()
			}
			if s.id != "" {
				r.Engine.Remove(context.WithoutCancel(r.ctx), s.id)
			}
		}
	}()

	r.pause()
	for _, s := range srvs {
		if s.result.Error == "" {
			s.mu.Lock()
			s.result.IdleMemoryBytes = s.last.MemoryBytes
			s.mu.Unlock()
		}
	}

	for _, w := range r.cfg.Workloads {
		if r.ctx.Err() != nil {
			break
		}
		r.send(Event{Type: EventStatus, Message: "Load: " + w.Name})
		for _, s := range srvs {
			if s.result.Error != "" {
				continue
			}
			wg.Go(func() {
				wr := r.load(s, w)
				s.result.Workloads = append(s.result.Workloads, wr)
				r.send(Event{Type: EventWorkloadDone, Server: s.def.ID, Workload: w.Name, WorkloadResult: &wr})
				r.checkAlive(s)
			})
		}
		wg.Wait()
		r.pause()
	}
	for _, s := range srvs {
		s.mu.Lock()
		s.result.PeakMemoryBytes = s.peak
		s.mu.Unlock()
	}
	return out
}

func (r *run) pause() {
	select {
	case <-r.ctx.Done():
	case <-time.After(r.Settle):
	}
}

func (r *run) start(s *server) {
	env := []string{
		"PORT=8080", "CPUS=" + strconv.Itoa(r.preset.CPUs),
		"DB_HOST=" + postgresName, "DB_PORT=5432", "DB_USER=bench", "DB_PASSWORD=bench", "DB_NAME=bench",
		"DB_POOL=" + strconv.Itoa(r.cfg.DBPool),
	}
	begin := time.Now()
	id, err := r.Engine.Run(r.ctx, docker.Spec{
		Name: "lb-" + s.def.ID, Image: s.def.Image(), Env: env, Network: Network,
		CPUSet: plan.CPUSet(s.slot.ServerCPUs), CPUs: float64(r.preset.CPUs), MemoryMB: r.preset.MemoryMB,
		Labels: map[string]string{labelRun: "", labelRole: "server"},
	})
	if err != nil {
		s.result.Error = err.Error()
		return
	}
	s.id = id
	statsCtx, stop := context.WithCancel(r.ctx)
	s.stopStats = stop
	go r.Engine.Stats(statsCtx, id, func(x docker.Sample) {
		s.record(x)
		r.send(Event{Type: EventStats, Server: s.def.ID, Stats: &x})
	})

	url := "http://lb-" + s.def.ID + ":8080/health"
	limit := r.healthLimit()
	for !r.probe(r.ctx, url) {
		if r.ctx.Err() != nil {
			s.result.Error = r.ctx.Err().Error()
			return
		}
		if time.Since(begin) > limit {
			s.result.Error = fmt.Sprintf("not healthy after %v", limit)
			r.send(Event{Type: EventError, Server: s.def.ID, Message: s.result.Error})
			return
		}
		if st, err := r.Engine.Inspect(r.ctx, id); err == nil && !st.Running {
			s.result.Error = exitMessage(st)
			r.send(Event{Type: EventError, Server: s.def.ID, Message: s.result.Error})
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	s.result.StartupMs = float64(time.Since(begin).Microseconds()) / 1000
	r.send(Event{Type: EventReady, Server: s.def.ID, StartupMs: s.result.StartupMs})
}

func exitMessage(st docker.State) string {
	if st.OOMKilled {
		return "killed: out of memory"
	}
	return fmt.Sprintf("exited with code %d", st.ExitCode)
}

// checkAlive marks a server that died under load, so it sits out the remaining workloads.
func (r *run) checkAlive(s *server) {
	st, err := r.Engine.Inspect(context.WithoutCancel(r.ctx), s.id)
	if err == nil && !st.Running {
		s.result.Error = exitMessage(st)
		r.send(Event{Type: EventError, Server: s.def.ID, Message: s.result.Error})
	}
}

func (r *run) load(s *server, w workload.Workload) WorkloadResult {
	wr := WorkloadResult{Workload: w}
	total := r.cfg.WarmupSlices + r.cfg.MeasureSlices
	s.mu.Lock()
	s.measuring = r.cfg.WarmupSlices == 0
	s.measured = nil
	s.sliceSamples = nil
	s.mu.Unlock()

	id, err := r.Engine.Run(r.ctx, docker.Spec{
		Name: "lb-load-" + s.def.ID, Image: LoadgenImage, Network: Network,
		Env: []string{
			"URL=http://lb-" + s.def.ID + ":8080" + w.Path(),
			"CONNECTIONS=" + strconv.Itoa(w.Connections),
			"SLICES=" + strconv.Itoa(total),
		},
		CPUSet: plan.CPUSet(s.slot.LoadgenCPUs), CPUs: float64(len(s.slot.LoadgenCPUs)), MemoryMB: loadgenMemoryMB,
		Labels: map[string]string{labelRun: "", labelRole: "loadgen"},
	})
	if err != nil {
		wr.Error = err.Error()
		return wr
	}
	defer r.Engine.Remove(context.WithoutCancel(r.ctx), id)

	var measured []oha.Slice
	idx := 0
	logsErr := r.Engine.Logs(r.ctx, id, func(l docker.Line) {
		if l.Stderr {
			r.send(Event{Type: EventLog, Server: s.def.ID, Message: l.Text})
			return
		}
		sl, err := oha.ParseSlice([]byte(l.Text))
		if err != nil {
			r.send(Event{Type: EventLog, Server: s.def.ID, Message: l.Text})
			return
		}
		warmup := idx < r.cfg.WarmupSlices
		s.mu.Lock()
		cpu, mem := mean(s.sliceSamples)
		s.sliceSamples = nil
		if idx == r.cfg.WarmupSlices-1 {
			s.measuring = true
		}
		if idx == total-1 {
			s.measuring = false
		}
		s.mu.Unlock()
		p := SlicePoint{
			Index: idx, Warmup: warmup, RPS: sl.RPS, P50: sl.Latency.P50, P99: sl.Latency.P99,
			Max: sl.Latency.Max, Failed: sl.Errors + sl.Non2xx, CPU: cpu, MemoryBytes: mem,
		}
		wr.Slices = append(wr.Slices, p)
		if !warmup {
			measured = append(measured, sl)
		}
		r.send(Event{Type: EventSlice, Server: s.def.ID, Workload: w.Name, Slice: &p})
		idx++
	})
	if err := r.ctx.Err(); err != nil {
		wr.Error = err.Error()
		return wr
	}
	if logsErr != nil {
		wr.Error = logsErr.Error()
	}
	if code, err := r.Engine.Wait(r.ctx, id); err == nil && code != 0 && wr.Error == "" {
		wr.Error = fmt.Sprintf("load generator exited with code %d", code)
	}

	wr.Summary = oha.Merge(measured)
	s.mu.Lock()
	samples := s.measured
	s.measuring = false
	s.mu.Unlock()
	wr.CPU.Mean, wr.Memory.Mean = mean(samples)
	for _, x := range samples {
		wr.CPU.Max = max(wr.CPU.Max, x.CPUPercent)
		wr.Memory.Peak = max(wr.Memory.Peak, x.MemoryBytes)
	}
	if wr.CPU.Mean > 0 {
		wr.RPSPerCore = wr.Summary.RPS / (wr.CPU.Mean / 100)
	}
	return wr
}

// Conform starts one server with Postgres, unpinned, and checks it against docs/SPEC.md.
func (r *Runner) Conform(ctx context.Context, id string, logf func(string)) ([]conform.Failure, error) {
	def, ok := catalog.Find(r.Servers, id)
	if !ok {
		return nil, fmt.Errorf("unknown server %q", id)
	}
	cfg := DefaultConfig()
	cfg.DBPool = 4
	preset, _ := plan.PresetByID(cfg.Preset)
	rn := &run{Runner: r, ctx: ctx, cfg: cfg, preset: preset, emit: func(e Event) {
		if e.Message != "" {
			logf(e.Server + " " + e.Message)
		}
	}}
	r.removeAll()
	defer r.removeAll()
	if err := r.Engine.EnsureNetwork(ctx, Network); err != nil {
		return nil, err
	}
	if err := rn.startPostgres(nil); err != nil {
		return nil, err
	}
	s := &server{def: def, result: &ServerResult{}}
	rn.start(s)
	if s.stopStats != nil {
		defer s.stopStats()
	}
	if s.result.Error != "" {
		return nil, errors.New(s.result.Error)
	}
	logf(fmt.Sprintf("%s healthy after %.0f ms", id, s.result.StartupMs))
	return conform.Check(ctx, "http://lb-"+id+":8080", &http.Client{Timeout: 10 * time.Second}), nil
}

func mean(xs []docker.Sample) (cpu float64, mem int64) {
	if len(xs) == 0 {
		return 0, 0
	}
	var m float64
	for _, x := range xs {
		cpu += x.CPUPercent
		m += float64(x.MemoryBytes)
	}
	return cpu / float64(len(xs)), int64(m / float64(len(xs)))
}
