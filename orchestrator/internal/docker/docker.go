// Package docker is a small client for the parts of the Docker Engine API that lang-bench uses.
// It talks to the daemon directly over its socket, with no SDK.
package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrNotFound is wrapped by errors for missing images, containers and networks.
var ErrNotFound = errors.New("not found")

// Client calls the Engine API. Requests carry no API version, so the daemon uses its own.
type Client struct {
	base string
	http *http.Client
}

// New returns a client for an Engine API at base, such as an httptest server.
func New(base string, hc *http.Client) *Client {
	return &Client{base: strings.TrimSuffix(base, "/"), http: hc}
}

// NewUnix returns a client for the daemon's Unix socket, usually /var/run/docker.sock.
func NewUnix(path string) *Client {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", path)
		},
	}
	return New("http://docker", &http.Client{Transport: tr})
}

func (c *Client) do(ctx context.Context, method, path string, q url.Values, body io.Reader, contentType string) (*http.Response, error) {
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker %s %s: %w", method, path, err)
	}
	if res.StatusCode >= 400 {
		defer res.Body.Close()
		var e struct{ Message string }
		b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		if json.Unmarshal(b, &e) != nil || e.Message == "" {
			e.Message = strings.TrimSpace(string(b))
		}
		err := fmt.Errorf("docker %s %s: %s", method, path, e.Message)
		if res.StatusCode == http.StatusNotFound {
			err = fmt.Errorf("%w: %w", ErrNotFound, err)
		}
		return nil, err
	}
	return res, nil
}

func (c *Client) json(ctx context.Context, method, path string, q url.Values, in, out any) error {
	var body io.Reader
	ct := ""
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body, ct = bytes.NewReader(b), "application/json"
	}
	res, err := c.do(ctx, method, path, q, body, ct)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if out == nil {
		_, err = io.Copy(io.Discard, res.Body)
		return err
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// Info describes the daemon and the machine it runs on (on Docker Desktop, its Linux VM).
type Info struct {
	NCPU            int
	MemTotal        int64
	ServerVersion   string
	OperatingSystem string
	KernelVersion   string
	Architecture    string
}

// Info returns the daemon's description of itself.
func (c *Client) Info(ctx context.Context) (Info, error) {
	var i Info
	return i, c.json(ctx, http.MethodGet, "/info", nil, nil, &i)
}

// Image is what lang-bench records about an image.
type Image struct {
	ID          string `json:"Id"`
	RepoDigests []string
	Size        int64
	Created     string
}

// ImageInspect returns an image by reference.
func (c *Client) ImageInspect(ctx context.Context, ref string) (Image, error) {
	var i Image
	return i, c.json(ctx, http.MethodGet, "/images/"+ref+"/json", nil, nil, &i)
}

// Build builds the tar build context in tarball into an image with the given tag. Each line of build
// output is passed to progress.
func (c *Client) Build(ctx context.Context, tarball io.Reader, tag string, progress func(string)) error {
	q := url.Values{"t": {tag}, "rm": {"1"}, "forcerm": {"1"}}
	res, err := c.do(ctx, http.MethodPost, "/build", q, tarball, "application/x-tar")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	dec := json.NewDecoder(res.Body)
	for {
		var m struct {
			Stream string `json:"stream"`
			Error  string `json:"error"`
		}
		if err := dec.Decode(&m); err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		if m.Error != "" {
			return fmt.Errorf("build %s: %s", tag, m.Error)
		}
		for _, l := range strings.Split(strings.TrimRight(m.Stream, "\n"), "\n") {
			if l != "" {
				progress(l)
			}
		}
	}
}

// Pull fetches an image from its registry.
func (c *Client) Pull(ctx context.Context, ref string) error {
	name, tag := ref, "latest"
	if i := strings.LastIndex(ref, ":"); i > strings.LastIndex(ref, "/") {
		name, tag = ref[:i], ref[i+1:]
	}
	res, err := c.do(ctx, http.MethodPost, "/images/create", url.Values{"fromImage": {name}, "tag": {tag}}, nil, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	dec := json.NewDecoder(res.Body)
	for {
		var m struct{ Error string }
		if err := dec.Decode(&m); err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		if m.Error != "" {
			return fmt.Errorf("pull %s: %s", ref, m.Error)
		}
	}
}

// EnsureNetwork creates a bridge network unless it exists.
func (c *Client) EnsureNetwork(ctx context.Context, name string) error {
	err := c.json(ctx, http.MethodGet, "/networks/"+name, nil, nil, nil)
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	return c.json(ctx, http.MethodPost, "/networks/create", nil, map[string]any{"Name": name, "Driver": "bridge"}, nil)
}

// Spec describes a container to run.
type Spec struct {
	Name       string
	Image      string
	Env        []string
	Cmd        []string
	Entrypoint []string
	// CPUSet pins the container to these cores, as for --cpuset-cpus.
	CPUSet string
	// CPUs caps CPU time, as for --cpus. Zero means no cap.
	CPUs     float64
	MemoryMB int
	Network  string
	Labels   map[string]string
}

type hostConfig struct {
	CpusetCpus  string `json:",omitempty"`
	NanoCpus    int64  `json:",omitempty"`
	Memory      int64  `json:",omitempty"`
	MemorySwap  int64  `json:",omitempty"`
	NetworkMode string `json:",omitempty"`
	AutoRemove  bool   `json:",omitempty"`
}

type createBody struct {
	Image      string
	Env        []string          `json:",omitempty"`
	Cmd        []string          `json:",omitempty"`
	Entrypoint []string          `json:",omitempty"`
	Labels     map[string]string `json:",omitempty"`
	HostConfig hostConfig
}

// Run creates and starts a container, returning its id.
func (c *Client) Run(ctx context.Context, s Spec) (string, error) {
	mem := int64(s.MemoryMB) << 20
	body := createBody{
		Image: s.Image, Env: s.Env, Cmd: s.Cmd, Entrypoint: s.Entrypoint, Labels: s.Labels,
		HostConfig: hostConfig{
			CpusetCpus: s.CPUSet, NanoCpus: int64(s.CPUs * 1e9),
			// Swap equal to memory means no swap: a server over its limit is killed, not slowed.
			Memory: mem, MemorySwap: mem,
			NetworkMode: s.Network,
		},
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := c.json(ctx, http.MethodPost, "/containers/create", url.Values{"name": {s.Name}}, body, &created); err != nil {
		return "", err
	}
	if err := c.json(ctx, http.MethodPost, "/containers/"+created.ID+"/start", nil, nil, nil); err != nil {
		c.Remove(context.WithoutCancel(ctx), created.ID)
		return "", err
	}
	return created.ID, nil
}

// Remove force-removes a container. A missing container is not an error.
func (c *Client) Remove(ctx context.Context, id string) error {
	err := c.json(ctx, http.MethodDelete, "/containers/"+id, url.Values{"force": {"1"}, "v": {"1"}}, nil, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

// State is a container's current state.
type State struct {
	Running   bool
	ExitCode  int
	OOMKilled bool
	Health    *struct{ Status string }
}

// Inspect returns a container's state.
func (c *Client) Inspect(ctx context.Context, id string) (State, error) {
	var out struct{ State State }
	return out.State, c.json(ctx, http.MethodGet, "/containers/"+id+"/json", nil, nil, &out)
}

// Wait blocks until a container exits and returns its exit code.
func (c *Client) Wait(ctx context.Context, id string) (int, error) {
	var out struct{ StatusCode int }
	return out.StatusCode, c.json(ctx, http.MethodPost, "/containers/"+id+"/wait", nil, nil, &out)
}

// ListByLabel returns the ids of containers, running or not, that carry the label.
func (c *Client) ListByLabel(ctx context.Context, label string) ([]string, error) {
	f, _ := json.Marshal(map[string][]string{"label": {label}})
	var out []struct {
		ID string `json:"Id"`
	}
	if err := c.json(ctx, http.MethodGet, "/containers/json", url.Values{"all": {"1"}, "filters": {string(f)}}, nil, &out); err != nil {
		return nil, err
	}
	ids := make([]string, len(out))
	for i, o := range out {
		ids[i] = o.ID
	}
	return ids, nil
}

// Sample is one reading of a container's resource use.
type Sample struct {
	Time time.Time `json:"t"`
	// CPUPercent is relative to one core: 200 means two cores fully busy.
	CPUPercent float64 `json:"cpu"`
	// MemoryBytes excludes the page cache that the kernel can reclaim, as docker stats does.
	MemoryBytes int64 `json:"mem"`
}

type rawStats struct {
	Read   time.Time `json:"read"`
	CPU    cpuStats  `json:"cpu_stats"`
	PreCPU cpuStats  `json:"precpu_stats"`
	Memory struct {
		Usage int64            `json:"usage"`
		Stats map[string]int64 `json:"stats"`
	} `json:"memory_stats"`
}

type cpuStats struct {
	Usage struct {
		Total uint64 `json:"total_usage"`
	} `json:"cpu_usage"`
	System uint64 `json:"system_cpu_usage"`
	Online int    `json:"online_cpus"`
}

func (r rawStats) sample() Sample {
	s := Sample{Time: r.Read, MemoryBytes: r.Memory.Usage}
	if inactive, ok := r.Memory.Stats["inactive_file"]; ok && inactive < s.MemoryBytes {
		s.MemoryBytes -= inactive // cgroup v2
	} else if inactive, ok := r.Memory.Stats["total_inactive_file"]; ok && inactive < s.MemoryBytes {
		s.MemoryBytes -= inactive // cgroup v1
	}
	if r.PreCPU.System > 0 && r.CPU.System > r.PreCPU.System && r.CPU.Usage.Total >= r.PreCPU.Usage.Total {
		cpu := float64(r.CPU.Usage.Total - r.PreCPU.Usage.Total)
		system := float64(r.CPU.System - r.PreCPU.System)
		s.CPUPercent = cpu / system * float64(r.CPU.Online) * 100
	}
	return s
}

// Stats streams resource samples, about one a second, until the container stops or ctx ends.
func (c *Client) Stats(ctx context.Context, id string, fn func(Sample)) error {
	res, err := c.do(ctx, http.MethodGet, "/containers/"+id+"/stats", url.Values{"stream": {"true"}}, nil, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	dec := json.NewDecoder(res.Body)
	for {
		var r rawStats
		if err := dec.Decode(&r); err == io.EOF || ctx.Err() != nil {
			return nil
		} else if err != nil {
			return err
		}
		fn(r.sample())
	}
}

// Line is one line of a container's output.
type Line struct {
	Text   string
	Stderr bool
}

// Logs follows a container's output line by line until it exits or ctx ends. The container must
// have no TTY, so that Docker multiplexes stdout and stderr into frames.
func (c *Client) Logs(ctx context.Context, id string, fn func(Line)) error {
	q := url.Values{"follow": {"true"}, "stdout": {"true"}, "stderr": {"true"}}
	res, err := c.do(ctx, http.MethodGet, "/containers/"+id+"/logs", q, nil, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	r := bufio.NewReader(res.Body)
	var pending [3]bytes.Buffer // partial lines, by stream
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, header); err != nil {
			for s := 1; s <= 2; s++ {
				if pending[s].Len() > 0 {
					fn(Line{Text: pending[s].String(), Stderr: s == 2})
				}
			}
			if err == io.EOF || err == io.ErrUnexpectedEOF || ctx.Err() != nil {
				return nil
			}
			return err
		}
		stream := min(int(header[0]), 2)
		payload := make([]byte, binary.BigEndian.Uint32(header[4:]))
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil
		}
		buf := &pending[stream]
		buf.Write(payload)
		for {
			i := bytes.IndexByte(buf.Bytes(), '\n')
			if i < 0 {
				break
			}
			line := string(bytes.TrimRight(buf.Next(i+1), "\r\n"))
			fn(Line{Text: line, Stderr: stream == 2})
		}
	}
}
