// Package store keeps run results as JSON files, one per run.
package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/runner"
)

// Store saves results in Dir as <id>.json.
type Store struct{ Dir string }

// Summary is what the list of runs shows.
type Summary struct {
	ID         string    `json:"id"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt"`
	Servers    []string  `json:"servers"`
	Workloads  []string  `json:"workloads"`
	Preset     string    `json:"preset"`
	Mode       string    `json:"mode"`
	CPUModel   string    `json:"cpuModel,omitempty"`
	HostCPUs   int       `json:"hostCpus"`
}

var validID = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func (s Store) path(id string) (string, error) {
	if !validID.MatchString(id) || strings.Contains(id, "..") {
		return "", errors.New("invalid run id")
	}
	return filepath.Join(s.Dir, id+".json"), nil
}

// Save writes a result, replacing any with the same id.
func (s Store) Save(r runner.Result) error {
	p, err := s.path(r.ID)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Get reads one result.
func (s Store) Get(id string) (runner.Result, error) {
	var r runner.Result
	p, err := s.path(id)
	if err != nil {
		return r, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return r, err
	}
	return r, json.Unmarshal(b, &r)
}

// List summarises every readable result, newest first.
func (s Store) List() ([]Summary, error) {
	entries, err := os.ReadDir(s.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	out := []Summary{}
	for _, e := range entries {
		id, ok := strings.CutSuffix(e.Name(), ".json")
		if !ok || e.IsDir() {
			continue
		}
		r, err := s.Get(id)
		if err != nil {
			continue
		}
		sum := Summary{
			ID: r.ID, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, Preset: r.Config.Preset,
			Mode: string(r.Plan.Mode), CPUModel: r.Host.CPUModel, HostCPUs: r.Host.CPUs,
		}
		for _, sr := range r.Servers {
			sum.Servers = append(sum.Servers, sr.Server.ID)
		}
		for _, w := range r.Config.Workloads {
			sum.Workloads = append(sum.Workloads, w.Name)
		}
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out, nil
}
