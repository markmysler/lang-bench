package docker

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func serve(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return New(srv.URL, srv.Client())
}

func TestInfo(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/info" {
			t.Errorf("path = %s", r.URL.Path)
		}
		io.WriteString(w, `{"NCPU":22,"MemTotal":12539572224,"ServerVersion":"29.8.0","OperatingSystem":"Docker Desktop","KernelVersion":"6.6.87.2-microsoft-standard-WSL2"}`)
	})
	info, err := c.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.NCPU != 22 || info.MemTotal != 12539572224 || info.ServerVersion != "29.8.0" {
		t.Fatalf("info = %+v", info)
	}
}

func TestNotFoundIsRecognisable(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, `{"message":"No such image: langbench/nope:latest"}`)
	})
	_, err := c.ImageInspect(context.Background(), "langbench/nope:latest")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(err.Error(), "No such image") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunCreatesWithLimitsThenStarts(t *testing.T) {
	var calls []string
	var body createBody
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		if strings.HasSuffix(r.URL.Path, "/create") {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"Id":"abc123"}`)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	id, err := c.Run(context.Background(), Spec{
		Name: "lb-go-gin", Image: "langbench/go-gin", Env: []string{"CPUS=1"},
		CPUSet: "3", CPUs: 1, MemoryMB: 512, Network: "langbench",
		Labels: map[string]string{"langbench": "server"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "abc123" {
		t.Fatalf("id = %q", id)
	}
	want := []string{"POST /containers/create?name=lb-go-gin", "POST /containers/abc123/start?"}
	if strings.Join(calls, "|") != strings.Join(want, "|") {
		t.Fatalf("calls = %v", calls)
	}
	hc := body.HostConfig
	if hc.CpusetCpus != "3" || hc.NanoCpus != 1e9 || hc.Memory != 512<<20 || hc.MemorySwap != 512<<20 || hc.NetworkMode != "langbench" {
		t.Fatalf("host config = %+v", hc)
	}
	if body.Labels["langbench"] != "server" || body.Env[0] != "CPUS=1" {
		t.Fatalf("body = %+v", body)
	}
}

func TestStatsComputesCPUAndMemory(t *testing.T) {
	sample, err := os.ReadFile("testdata/stats.json")
	if err != nil {
		t.Fatal(err)
	}
	second := strings.Replace(string(sample), `"total_usage":64306000,`, `"total_usage":1064306000,`, 1)
	if second == string(sample) {
		t.Fatal("fixture changed: update the replacement")
	}
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("stream") != "true" {
			t.Errorf("query = %s", r.URL.RawQuery)
		}
		w.Write(bytes.TrimSpace(sample))
		w.Write([]byte("\n"))
		io.WriteString(w, second)
	})
	var got []Sample
	err = c.Stats(context.Background(), "abc", func(s Sample) { got = append(got, s) })
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d samples", len(got))
	}
	// usage minus inactive_file
	if got[0].MemoryBytes != 17952768-188416 {
		t.Errorf("memory = %d", got[0].MemoryBytes)
	}
	// The first sample has no CPU use in its window.
	if got[0].CPUPercent != 0 {
		t.Errorf("cpu = %v", got[0].CPUPercent)
	}
	// One more second of CPU in a window of 22.06 s of system time across 22 CPUs: just under
	// one full core.
	if want := 1e9 / 22.06e9 * 22 * 100; got[1].CPUPercent < want-0.01 || got[1].CPUPercent > want+0.01 {
		t.Errorf("cpu = %v", got[1].CPUPercent)
	}
}

func frame(stream byte, s string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(s)))
	return append(h, s...)
}

func TestLogsSplitsMultiplexedFramesIntoLines(t *testing.T) {
	var buf bytes.Buffer
	buf.Write(frame(1, "first li"))
	buf.Write(frame(1, "ne\nsecond line\nthi"))
	buf.Write(frame(2, "an error\n"))
	buf.Write(frame(1, "rd\n"))
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("follow") != "true" {
			t.Errorf("query = %s", r.URL.RawQuery)
		}
		w.Write(buf.Bytes())
	})
	var out, errs []string
	err := c.Logs(context.Background(), "abc", func(l Line) {
		if l.Stderr {
			errs = append(errs, l.Text)
		} else {
			out = append(out, l.Text)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(out, "|") != "first line|second line|third" || strings.Join(errs, "|") != "an error" {
		t.Fatalf("out = %q, errs = %q", out, errs)
	}
}

func TestBuildStreamsOutputAndFailsOnError(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != "langbench/x:latest" || r.Header.Get("Content-Type") != "application/x-tar" {
			t.Errorf("request = %s %v", r.URL.RawQuery, r.Header)
		}
		io.Copy(io.Discard, r.Body)
		io.WriteString(w, `{"stream":"Step 1/2 : FROM debian\n"}`+"\n"+`{"error":"something broke"}`+"\n")
	})
	var lines []string
	err := c.Build(context.Background(), strings.NewReader("tar"), "langbench/x:latest", func(s string) { lines = append(lines, s) })
	if err == nil || !strings.Contains(err.Error(), "something broke") {
		t.Fatalf("err = %v", err)
	}
	if len(lines) != 1 || lines[0] != "Step 1/2 : FROM debian" {
		t.Fatalf("lines = %q", lines)
	}
}

func TestWaitReturnsExitCode(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"StatusCode":3}`)
	})
	code, err := c.Wait(context.Background(), "abc")
	if err != nil || code != 3 {
		t.Fatalf("code = %d, err = %v", code, err)
	}
}
