package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/runner"
)

func result(id string, at time.Time) runner.Result {
	return runner.Result{
		Schema: runner.Schema, ID: id, StartedAt: at, FinishedAt: at.Add(time.Minute),
		Config:  runner.Config{Servers: []string{"go-gin"}, Preset: "1cpu-512mb"},
		Servers: []runner.ServerResult{{Server: catalog.Server{ID: "go-gin"}}},
	}
}

func TestSaveListAndGet(t *testing.T) {
	s := Store{Dir: t.TempDir()}
	now := time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC)
	for i, id := range []string{"older", "newer"} {
		if err := s.Save(result(id, now.Add(time.Duration(i)*time.Hour))); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "newer" || list[0].Servers[0] != "go-gin" || list[0].Preset != "1cpu-512mb" {
		t.Fatalf("list = %+v", list)
	}
	got, err := s.Get("older")
	if err != nil || got.ID != "older" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestIgnoresOtherFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".gitkeep"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "broken.json"), []byte("{"), 0o644)
	list, err := Store{Dir: dir}.List()
	if err != nil || len(list) != 0 {
		t.Fatalf("list = %v, err = %v", list, err)
	}
}

func TestRejectsPathsInIDs(t *testing.T) {
	s := Store{Dir: t.TempDir()}
	for _, id := range []string{"../etc/passwd", "a/b", ""} {
		if _, err := s.Get(id); err == nil {
			t.Errorf("%q: want error", id)
		}
	}
}
