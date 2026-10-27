// Package build packs a folder as a Docker build context.
package build

import (
	"archive/tar"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// skipped are folders of local build output that never belong in an image's context.
var skipped = map[string]bool{".git": true, "node_modules": true, "target": true, "__pycache__": true, ".venv": true, "build": true, ".gradle": true}

// Tar writes dir as a tar stream, with paths relative to dir.
func Tar(dir string, w io.Writer) error {
	tw := tar.NewWriter(w)
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil || rel == "." {
			return err
		}
		if d.IsDir() && skipped[d.Name()] {
			return filepath.SkipDir
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() && !info.IsDir() {
			return nil
		}
		h, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		if info.IsDir() {
			h.Name += "/"
		}
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil {
		return err
	}
	return tw.Close()
}
