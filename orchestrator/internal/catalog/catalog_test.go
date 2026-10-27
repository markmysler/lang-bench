package catalog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, root, id, manifest string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "server.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte("FROM scratch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

const gin = `{"id":"go-gin","language":"Go","languageVersion":"1.26","framework":"Gin","frameworkVersion":"1.11.0","runtime":"Go (native)","concurrency":"Goroutines","tuning":"GOMAXPROCS = CPUS"}`

func TestLoadsServersSortedByID(t *testing.T) {
	root := t.TempDir()
	write(t, root, "rust-axum", `{"id":"rust-axum","language":"Rust","languageVersion":"1.90","framework":"Axum","frameworkVersion":"0.8","runtime":"native","concurrency":"Tokio","tuning":"workers = CPUS"}`)
	write(t, root, "go-gin", gin)
	os.MkdirAll(filepath.Join(root, "not-a-server"), 0o755) // no manifest: ignored

	servers, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(servers) != 2 || servers[0].ID != "go-gin" || servers[1].ID != "rust-axum" {
		t.Fatalf("servers = %+v", servers)
	}
	if servers[0].Framework != "Gin" || servers[0].Dir != filepath.Join(root, "go-gin") {
		t.Fatalf("server = %+v", servers[0])
	}
	if servers[0].Image() != "langbench/go-gin:latest" {
		t.Fatalf("image = %s", servers[0].Image())
	}
}

func TestIDMustMatchFolder(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go-fiber", gin)
	if _, err := Load(root); err == nil || !strings.Contains(err.Error(), "go-fiber") {
		t.Fatalf("err = %v", err)
	}
}

func TestRequiredFields(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go-gin", `{"id":"go-gin","language":"Go"}`)
	if _, err := Load(root); err == nil || !strings.Contains(err.Error(), "languageVersion is required") {
		t.Fatalf("err = %v", err)
	}
}

func TestFind(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go-gin", gin)
	servers, _ := Load(root)
	if _, ok := Find(servers, "go-gin"); !ok {
		t.Fatal("not found")
	}
	if _, ok := Find(servers, "nope"); ok {
		t.Fatal("found")
	}
}
