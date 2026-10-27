// Package catalog lists the servers in servers/, each described by its server.json.
package catalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Server is one language and framework, as described by its manifest (docs/SPEC.md).
type Server struct {
	ID               string `json:"id"`
	Language         string `json:"language"`
	LanguageVersion  string `json:"languageVersion"`
	Framework        string `json:"framework"`
	FrameworkVersion string `json:"frameworkVersion"`
	Runtime          string `json:"runtime"`
	Concurrency      string `json:"concurrency"`
	Tuning           string `json:"tuning"`
	// Dir is the server's folder, which is also its build context.
	Dir string `json:"-"`
}

// Image is the tag the server's image is built under.
func (s Server) Image() string { return "langbench/" + s.ID + ":latest" }

// Load reads every servers/<id>/server.json under root.
func Load(root string) ([]Server, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var out []Server
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		b, err := os.ReadFile(filepath.Join(dir, "server.json"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return nil, err
		}
		var s Server
		if err := json.Unmarshal(b, &s); err != nil {
			return nil, fmt.Errorf("%s/server.json: %w", e.Name(), err)
		}
		if s.ID != e.Name() {
			return nil, fmt.Errorf("%s/server.json: id %q must match the folder name %q", e.Name(), s.ID, e.Name())
		}
		for _, f := range []struct{ name, value string }{
			{"language", s.Language}, {"languageVersion", s.LanguageVersion}, {"framework", s.Framework},
			{"frameworkVersion", s.FrameworkVersion}, {"runtime", s.Runtime}, {"concurrency", s.Concurrency},
			{"tuning", s.Tuning},
		} {
			if f.value == "" {
				return nil, fmt.Errorf("%s/server.json: %s is required", e.Name(), f.name)
			}
		}
		s.Dir = dir
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// Find returns the server with that id.
func Find(servers []Server, id string) (Server, bool) {
	for _, s := range servers {
		if s.ID == id {
			return s, true
		}
	}
	return Server{}, false
}
