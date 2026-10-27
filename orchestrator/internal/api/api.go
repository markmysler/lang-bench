// Package api serves the dashboard and the HTTP API it uses.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/plan"
	"github.com/markmysler/lang-bench/orchestrator/internal/runner"
	"github.com/markmysler/lang-bench/orchestrator/internal/store"
	"github.com/markmysler/lang-bench/orchestrator/internal/workload"
)

// RunFunc carries out a run; runner.Runner.Run in production.
type RunFunc func(ctx context.Context, cfg runner.Config, emit func(runner.Event)) (runner.Result, error)

// ImageStatus says whether a build target's image exists.
type ImageStatus struct {
	Target    string `json:"target"`
	Image     string `json:"image"`
	Built     bool   `json:"built"`
	SizeBytes int64  `json:"sizeBytes,omitempty"`
	Created   string `json:"created,omitempty"`
}

// BuildFunc builds one target's image, passing each line of output to progress.
type BuildFunc func(ctx context.Context, target string, progress func(string)) error

// Server is the HTTP API.
type Server struct {
	Servers []catalog.Server
	Store   store.Store
	Run     RunFunc
	Host    func(context.Context) (runner.HostInfo, error)
	Images  func(context.Context) ([]ImageStatus, error)
	Build   BuildFunc
	// Web holds the built dashboard.
	Web fs.FS

	mu      sync.Mutex
	current *live
	running sync.WaitGroup
}

// live is the run in progress, or the last one. Its events are kept so that a page opened in the
// middle of a run can replay them.
type live struct {
	mu     sync.Mutex
	id     string
	events []runner.Event
	subs   map[chan struct{}]bool
	done   bool
	err    string
	cancel context.CancelFunc
}

func (l *live) add(e runner.Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, e)
	if e.Type == runner.EventDone && e.Result != nil {
		l.id = e.Result.ID
	}
	l.notify()
}

func (l *live) notify() {
	for ch := range l.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Handler routes the API and the dashboard.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", s.config)
	mux.HandleFunc("POST /api/plan", s.plan)
	mux.HandleFunc("GET /api/images", s.images)
	mux.HandleFunc("POST /api/images/{target}/build", s.build)
	mux.HandleFunc("GET /api/runs", s.list)
	mux.HandleFunc("POST /api/runs", s.start)
	mux.HandleFunc("GET /api/runs/current", s.status)
	mux.HandleFunc("DELETE /api/runs/current", s.stop)
	mux.HandleFunc("GET /api/runs/current/events", s.events)
	mux.HandleFunc("GET /api/runs/{id}", s.get)
	mux.HandleFunc("/", s.web)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	host, err := s.Host(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"servers":   s.Servers,
		"presets":   plan.Presets,
		"defaults":  runner.DefaultConfig(),
		"workloads": workload.Defaults(),
		"host":      host,
	})
}

func readConfig(r *http.Request) (runner.Config, error) {
	cfg := runner.DefaultConfig()
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("invalid run settings: %w", err)
	}
	return cfg, nil
}

func (s *Server) plan(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	host, err := s.Host(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	p, err := runner.Preview(cfg, plan.Host{CPUs: host.CPUs, MemoryMB: host.MemoryMB})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) images(w http.ResponseWriter, r *http.Request) {
	list, err := s.Images(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// sse prepares w for Server-Sent Events.
func sse(w http.ResponseWriter) (func(any), bool) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return nil, false
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	return func(v any) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "data: %s\n\n", b)
		fl.Flush()
	}, true
}

func (s *Server) build(w http.ResponseWriter, r *http.Request) {
	send, ok := sse(w)
	if !ok {
		return
	}
	err := s.Build(r.Context(), r.PathValue("target"), func(line string) {
		send(map[string]string{"line": line})
	})
	if err != nil {
		send(map[string]any{"done": true, "error": err.Error()})
		return
	}
	send(map[string]any{"done": true})
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	res, err := s.Store.Get(r.PathValue("id"))
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, errors.New("no such run"))
		return
	} else if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil && !s.current.isDone() {
		writeError(w, http.StatusConflict, errors.New("a run is already in progress"))
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	l := &live{subs: map[chan struct{}]bool{}, cancel: cancel}
	s.current = l
	s.running.Add(1)
	go func() {
		defer s.running.Done()
		defer cancel()
		res, err := s.Run(ctx, cfg, l.add)
		if err == nil {
			err = s.Store.Save(res)
		} else if errors.Is(err, context.Canceled) {
			err = errors.New("run cancelled")
		}
		l.mu.Lock()
		l.done = true
		if err != nil {
			l.err = err.Error()
			l.events = append(l.events, runner.Event{Type: runner.EventError, Message: l.err})
		}
		l.notify()
		l.mu.Unlock()
	}()
	writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
}

// wait blocks until the run in progress has finished. For tests.
func (s *Server) wait() { s.running.Wait() }

func (l *live) isDone() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.done
}

func (s *Server) cur() *live {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.current
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	l := s.cur()
	if l == nil {
		writeJSON(w, http.StatusOK, map[string]any{"running": false})
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"running": !l.done, "id": l.id, "error": l.err})
}

func (s *Server) stop(w http.ResponseWriter, r *http.Request) {
	if l := s.cur(); l != nil {
		l.cancel()
	}
	w.WriteHeader(http.StatusNoContent)
}

// events replays the current run's events, then follows it until it ends.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	l := s.cur()
	if l == nil {
		writeError(w, http.StatusNotFound, errors.New("no run yet"))
		return
	}
	send, ok := sse(w)
	if !ok {
		return
	}
	ch := make(chan struct{}, 1)
	l.mu.Lock()
	l.subs[ch] = true
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		delete(l.subs, ch)
		l.mu.Unlock()
	}()

	sent := 0
	for {
		l.mu.Lock()
		pending := l.events[sent:]
		done := l.done
		l.mu.Unlock()
		for _, e := range pending {
			send(e)
		}
		sent += len(pending)
		if done {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ch:
		}
	}
}

// web serves the dashboard. Paths that are not files get index.html, for client-side routes.
func (s *Server) web(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if p == "" {
		p = "index.html"
	}
	if f, err := fs.Stat(s.Web, p); err != nil || f.IsDir() {
		r = r.Clone(r.Context())
		r.URL.Path = "/"
		p = "index.html"
	}
	// The page names the current build's scripts, so it is checked on every load. The scripts
	// themselves have content hashes in their names and can be cached.
	if p == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.FileServerFS(s.Web).ServeHTTP(w, r)
}
