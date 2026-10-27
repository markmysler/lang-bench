// Package webdist holds the built dashboard. The Dockerfile builds web/ into this folder before
// compiling; in a plain checkout it is empty and the server explains how to build it.
package webdist

import (
	"embed"
	"io/fs"
	"testing/fstest"
)

//go:embed all:*
var files embed.FS

// FS is the dashboard, or a page that says it has not been built.
var FS fs.FS = func() fs.FS {
	if _, err := fs.Stat(files, "index.html"); err == nil {
		return files
	}
	return fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><title>lang-bench</title>
<p>The dashboard has not been built. Run <code>docker compose up --build</code>, or
<code>npm run dev</code> in <code>web/</code> while developing.</p>`)}}
}()
