// Command langbench builds the benchmark images, runs benchmarks and serves the dashboard.
//
//	langbench serve              serve the dashboard and API on :7070
//	langbench build [target...]  build images: server ids, postgres, loadgen, or all
//	langbench run settings.json  run headless and save the result
//	langbench conform id...      start servers and check them against docs/SPEC.md
//	langbench check url          check a server that is already running
//
// It expects the repository at $LANGBENCH_ROOT (default /work) and the Docker socket at
// /var/run/docker.sock, as docker-compose.yml sets up.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/api"
	"github.com/markmysler/lang-bench/orchestrator/internal/build"
	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/conform"
	"github.com/markmysler/lang-bench/orchestrator/internal/docker"
	"github.com/markmysler/lang-bench/orchestrator/internal/runner"
	"github.com/markmysler/lang-bench/orchestrator/internal/store"
	"github.com/markmysler/lang-bench/orchestrator/webdist"
)

type app struct {
	root    string
	docker  *docker.Client
	servers []catalog.Server
	runner  *runner.Runner
	store   store.Store
}

func main() {
	log.SetFlags(0)
	root := envOr("LANGBENCH_ROOT", "/work")
	servers, err := catalog.Load(filepath.Join(root, "servers"))
	if err != nil {
		log.Fatalf("reading servers: %v", err)
	}
	dc := docker.NewUnix(envOr("DOCKER_SOCKET", "/var/run/docker.sock"))
	a := &app{
		root: root, docker: dc, servers: servers,
		store: store.Store{Dir: filepath.Join(root, "results")},
		runner: &runner.Runner{
			Engine: dc, Servers: servers, Settle: 2 * time.Second,
			Host: func(h *runner.HostInfo) { h.CPUModel = cpuModel() }, Commit: gitCommit(root),
		},
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	args := os.Args[1:]
	if len(args) == 0 {
		args = []string{"serve"}
	}
	switch args[0] {
	case "serve":
		err = a.serve(ctx, args[1:])
	case "build":
		err = a.buildCmd(ctx, args[1:])
	case "run":
		err = a.runCmd(ctx, args[1:])
	case "conform":
		err = a.conformCmd(ctx, args[1:])
	case "check":
		err = checkCmd(ctx, args[1:])
	default:
		err = fmt.Errorf("unknown command %q: use serve, build, run or conform", args[0])
	}
	if err != nil {
		log.Fatal(err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// target maps a build target to its folder and image tag.
func (a *app) target(name string) (dir, image string, err error) {
	switch name {
	case "postgres":
		return filepath.Join(a.root, "db"), runner.PostgresImage, nil
	case "loadgen":
		return filepath.Join(a.root, "loadgen"), runner.LoadgenImage, nil
	}
	s, ok := catalog.Find(a.servers, name)
	if !ok {
		return "", "", fmt.Errorf("unknown build target %q", name)
	}
	return s.Dir, s.Image(), nil
}

func (a *app) targets() []string {
	out := []string{"postgres", "loadgen"}
	for _, s := range a.servers {
		out = append(out, s.ID)
	}
	return out
}

func (a *app) build(ctx context.Context, name string, progress func(string)) error {
	dir, image, err := a.target(name)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := build.Tar(dir, &buf); err != nil {
		return err
	}
	return a.docker.Build(ctx, &buf, image, progress)
}

func (a *app) images(ctx context.Context) ([]api.ImageStatus, error) {
	var out []api.ImageStatus
	for _, t := range a.targets() {
		_, image, _ := a.target(t)
		st := api.ImageStatus{Target: t, Image: image}
		img, err := a.docker.ImageInspect(ctx, image)
		if err == nil {
			st.Built, st.SizeBytes, st.Created = true, img.Size, img.Created
		}
		out = append(out, st)
	}
	return out, nil
}

func (a *app) host(ctx context.Context) (runner.HostInfo, error) {
	info, err := a.docker.Info(ctx)
	if err != nil {
		return runner.HostInfo{}, err
	}
	return runner.HostInfo{
		CPUs: info.NCPU, MemoryMB: int(info.MemTotal >> 20), CPUModel: cpuModel(),
		DockerVersion: info.ServerVersion, OS: info.OperatingSystem, Kernel: info.KernelVersion, Arch: info.Architecture,
	}, nil
}

func (a *app) serve(ctx context.Context, args []string) error {
	fl := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fl.String("addr", ":7070", "address to listen on")
	fl.Parse(args)

	var web fs.FS = webdist.FS
	if dir := os.Getenv("LANGBENCH_WEB"); dir != "" {
		web = os.DirFS(dir)
	}
	srv := &http.Server{Addr: *addr, Handler: (&api.Server{
		Servers: a.servers, Store: a.store, Run: a.runner.Run, Host: a.host, Images: a.images,
		Build: a.build, Web: web,
	}).Handler()}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	log.Printf("lang-bench dashboard on http://localhost%s", *addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}

func (a *app) buildCmd(ctx context.Context, names []string) error {
	if len(names) == 0 || (len(names) == 1 && names[0] == "all") {
		names = a.targets()
	}
	for _, n := range names {
		log.Printf("==> building %s", n)
		if err := a.build(ctx, n, func(l string) { log.Print(l) }); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) runCmd(ctx context.Context, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: langbench run settings.json")
	}
	b, err := os.ReadFile(args[0])
	if err != nil {
		return err
	}
	cfg := runner.DefaultConfig()
	if err := json.Unmarshal(b, &cfg); err != nil {
		return fmt.Errorf("%s: %w", args[0], err)
	}
	res, err := a.runner.Run(ctx, cfg, func(e runner.Event) {
		switch e.Type {
		case runner.EventPlan:
			log.Printf("mode %s, %d at once, %d batches", e.Plan.Mode, e.Plan.Parallel, len(e.Plan.Batches))
		case runner.EventStatus, runner.EventError, runner.EventLog:
			log.Printf("%s %s", e.Server, e.Message)
		case runner.EventReady:
			log.Printf("%s healthy after %.0f ms", e.Server, e.StartupMs)
		case runner.EventWorkloadDone:
			w := e.WorkloadResult
			log.Printf("%-18s %-9s %10.0f req/s  p50 %7.2f ms  p99 %7.2f ms  cpu %4.0f%%  mem %4d MB  failed %d",
				e.Server, e.Workload, w.Summary.RPS, w.Summary.Latency.P50, w.Summary.Latency.P99,
				w.CPU.Mean, w.Memory.Peak>>20, w.Summary.Errors+w.Summary.Non2xx)
		}
	})
	if err != nil {
		return err
	}
	if err := a.store.Save(res); err != nil {
		return err
	}
	log.Printf("saved results/%s.json", res.ID)
	return nil
}

func (a *app) conformCmd(ctx context.Context, ids []string) error {
	if len(ids) == 0 || (len(ids) == 1 && ids[0] == "all") {
		ids = nil
		for _, s := range a.servers {
			ids = append(ids, s.ID)
		}
	}
	failed := 0
	for _, id := range ids {
		failures, err := a.runner.Conform(ctx, id, func(l string) { log.Print(l) })
		if err != nil {
			log.Printf("FAIL %s: %v", id, err)
			failed++
			continue
		}
		for _, f := range failures {
			log.Printf("FAIL %s %s", id, f)
		}
		if len(failures) > 0 {
			failed++
		} else {
			log.Printf("ok   %s", id)
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d servers do not conform", failed, len(ids))
	}
	return nil
}

// checkCmd checks a server that is already running, without starting or stopping anything.
func checkCmd(ctx context.Context, urls []string) error {
	if len(urls) != 1 {
		return fmt.Errorf("usage: langbench check http://host:8080")
	}
	failures := conform.Check(ctx, strings.TrimSuffix(urls[0], "/"), &http.Client{Timeout: 10 * time.Second})
	for _, f := range failures {
		log.Printf("FAIL %s", f)
	}
	if len(failures) > 0 {
		return fmt.Errorf("%d checks failed", len(failures))
	}
	log.Printf("ok   %s", urls[0])
	return nil
}

// cpuModel reads the CPU's name. Inside Docker Desktop's VM this is still the host's CPU.
func cpuModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if k, v, ok := strings.Cut(sc.Text(), ":"); ok && strings.TrimSpace(k) == "model name" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// gitCommit reads the checked-out commit from the repository, without needing git installed.
func gitCommit(root string) string {
	head, err := os.ReadFile(filepath.Join(root, ".git", "HEAD"))
	if err != nil {
		return ""
	}
	ref, ok := strings.CutPrefix(strings.TrimSpace(string(head)), "ref: ")
	if !ok {
		return strings.TrimSpace(string(head))
	}
	if b, err := os.ReadFile(filepath.Join(root, ".git", ref)); err == nil {
		return strings.TrimSpace(string(b))
	}
	packed, _ := os.ReadFile(filepath.Join(root, ".git", "packed-refs"))
	for _, l := range strings.Split(string(packed), "\n") {
		if hash, name, ok := strings.Cut(l, " "); ok && name == ref {
			return hash
		}
	}
	return ""
}
