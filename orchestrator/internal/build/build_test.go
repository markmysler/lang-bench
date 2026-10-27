package build

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestTarSkipsBuildOutput(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"Dockerfile", "src/main.rs", "node_modules/x/index.js", "target/release/app", ".git/HEAD"} {
		p := filepath.Join(dir, f)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(f), 0o644)
	}
	var buf bytes.Buffer
	if err := Tar(dir, &buf); err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(&buf)
	var names []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeReg {
			names = append(names, h.Name)
			b, _ := io.ReadAll(tr)
			if string(b) != h.Name {
				t.Fatalf("%s holds %q", h.Name, b)
			}
		}
	}
	sort.Strings(names)
	if strings.Join(names, ",") != "Dockerfile,src/main.rs" {
		t.Fatalf("names = %v", names)
	}
}
