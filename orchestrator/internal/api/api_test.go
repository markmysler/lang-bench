package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/plan"
	"github.com/markmysler/lang-bench/orchestrator/internal/runner"
	"github.com/markmysler/lang-bench/orchestrator/internal/store"
)

func newServer(t *testing.T, run RunFunc) (*httptest.Server, *Server) {
	t.Helper()
	s := &Server{
		Servers: []catalog.Server{{ID: "go-gin", Language: "Go", Framework: "Gin"}},
		Store:   store.Store{Dir: t.TempDir()},
		Run:     run,
		Host: func(context.Context) (runner.HostInfo, error) {
			return runner.HostInfo{CPUs: 22, MemoryMB: 11958}, nil
		},
		Images: func(ctx context.Context) ([]ImageStatus, error) {
			return []ImageStatus{{Target: "go-gin", Built: true}}, nil
		},
		Web: fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>lang-bench</title>")}},
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv, s
}

func get(t *testing.T, url string, out any) int {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func post(t *testing.T, url string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := http.Post(url, "application/json", strings.NewReader(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// slowRun sends a plan, then waits for release before finishing.
func slowRun(release chan struct{}) RunFunc {
	return func(ctx context.Context, cfg runner.Config, emit func(runner.Event)) (runner.Result, error) {
		res := runner.Result{Schema: runner.Schema, ID: "run-1", StartedAt: time.Now(), Config: cfg}
		emit(runner.Event{Type: runner.EventPlan, Plan: &plan.Plan{Mode: plan.ModeSequential}})
		select {
		case <-release:
		case <-ctx.Done():
			return res, ctx.Err()
		}
		emit(runner.Event{Type: runner.EventDone, Result: &res})
		return res, nil
	}
}

func TestConfigListsServersPresetsAndDefaults(t *testing.T) {
	srv, _ := newServer(t, nil)
	var out struct {
		Servers  []catalog.Server `json:"servers"`
		Presets  []plan.Preset    `json:"presets"`
		Defaults runner.Config    `json:"defaults"`
		Host     runner.HostInfo  `json:"host"`
	}
	if code := get(t, srv.URL+"/api/config", &out); code != 200 {
		t.Fatalf("status %d", code)
	}
	if len(out.Servers) != 1 || len(out.Presets) != 3 || out.Defaults.BudgetPercent != 75 || out.Host.CPUs != 22 {
		t.Fatalf("config = %+v", out)
	}
}

func TestPlanPreview(t *testing.T) {
	srv, _ := newServer(t, nil)
	cfg := runner.DefaultConfig()
	cfg.Servers = []string{"go-gin"}
	code, out := post(t, srv.URL+"/api/plan", cfg)
	if code != 200 || out["mode"] != "sequential" {
		t.Fatalf("status %d, out = %v", code, out)
	}
	cfg.Preset = "nope"
	if code, _ := post(t, srv.URL+"/api/plan", cfg); code != 400 {
		t.Fatalf("status %d", code)
	}
}

func TestStartRunRejectsASecondAndSavesTheResult(t *testing.T) {
	release := make(chan struct{})
	srv, s := newServer(t, slowRun(release))
	cfg := runner.DefaultConfig()
	cfg.Servers = []string{"go-gin"}
	if code, _ := post(t, srv.URL+"/api/runs", cfg); code != http.StatusAccepted {
		t.Fatalf("status %d", code)
	}
	if code, _ := post(t, srv.URL+"/api/runs", cfg); code != http.StatusConflict {
		t.Fatalf("second run: status %d", code)
	}
	close(release)
	s.wait()
	var list []store.Summary
	get(t, srv.URL+"/api/runs", &list)
	if len(list) != 1 || list[0].ID != "run-1" {
		t.Fatalf("list = %+v", list)
	}
	var r runner.Result
	if code := get(t, srv.URL+"/api/runs/run-1", &r); code != 200 || r.ID != "run-1" {
		t.Fatalf("status %d, result = %+v", code, r)
	}
}

func TestEventsReplayThenFollowUntilDone(t *testing.T) {
	release := make(chan struct{})
	srv, _ := newServer(t, slowRun(release))
	cfg := runner.DefaultConfig()
	cfg.Servers = []string{"go-gin"}
	post(t, srv.URL+"/api/runs", cfg)

	res, err := http.Get(srv.URL + "/api/runs/current/events")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	sc := bufio.NewScanner(res.Body)
	var types []string
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data: ")
		if !ok {
			continue
		}
		var e runner.Event
		json.Unmarshal([]byte(data), &e)
		types = append(types, string(e.Type))
		if e.Type == runner.EventPlan {
			close(release) // the plan was replayed; now let the run finish
		}
	}
	if strings.Join(types, ",") != "plan,done" {
		t.Fatalf("types = %v", types)
	}
}

func TestNoCurrentRun(t *testing.T) {
	srv, _ := newServer(t, nil)
	if code := get(t, srv.URL+"/api/runs/current/events", nil); code != http.StatusNotFound {
		t.Fatalf("status %d", code)
	}
}

func TestCancel(t *testing.T) {
	srv, s := newServer(t, slowRun(make(chan struct{})))
	cfg := runner.DefaultConfig()
	cfg.Servers = []string{"go-gin"}
	post(t, srv.URL+"/api/runs", cfg)
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/runs/current", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != http.StatusNoContent {
		t.Fatalf("res = %v, err = %v", res, err)
	}
	s.wait()
	var cur struct {
		Running bool   `json:"running"`
		Error   string `json:"error"`
	}
	get(t, srv.URL+"/api/runs/current", &cur)
	if cur.Running || !strings.Contains(cur.Error, "cancel") {
		t.Fatalf("current = %+v", cur)
	}
}

func TestServesTheDashboard(t *testing.T) {
	srv, _ := newServer(t, nil)
	for _, path := range []string{"/", "/results/abc"} { // client-side routes fall back to index.html
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var b strings.Builder
		bufio.NewReader(res.Body).WriteTo(&b)
		res.Body.Close()
		if res.StatusCode != 200 || !strings.Contains(b.String(), "<title>lang-bench") {
			t.Fatalf("%s: status %d, body %q", path, res.StatusCode, b.String())
		}
	}
}
