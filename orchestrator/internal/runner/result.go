package runner

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/markmysler/lang-bench/orchestrator/internal/catalog"
	"github.com/markmysler/lang-bench/orchestrator/internal/docker"
	"github.com/markmysler/lang-bench/orchestrator/internal/oha"
	"github.com/markmysler/lang-bench/orchestrator/internal/plan"
	"github.com/markmysler/lang-bench/orchestrator/internal/workload"
)

// Schema is the version of the result format. Raise it on any change that old readers would
// misread.
const Schema = 1

// Result is everything needed to read, compare and reproduce a run.
type Result struct {
	Schema     int            `json:"schema"`
	ID         string         `json:"id"`
	StartedAt  time.Time      `json:"startedAt"`
	FinishedAt time.Time      `json:"finishedAt"`
	Commit     string         `json:"commit,omitempty"`
	Host       HostInfo       `json:"host"`
	Config     Config         `json:"config"`
	Plan       plan.Plan      `json:"plan"`
	Servers    []ServerResult `json:"servers"`
}

// HostInfo is the machine the run happened on. On Docker Desktop, CPUs and memory are those of
// its Linux VM.
type HostInfo struct {
	CPUs          int    `json:"cpus"`
	MemoryMB      int    `json:"memoryMB"`
	CPUModel      string `json:"cpuModel,omitempty"`
	DockerVersion string `json:"dockerVersion"`
	OS            string `json:"os"`
	Kernel        string `json:"kernel"`
	Arch          string `json:"arch,omitempty"`
}

// ImageInfo identifies the exact image that was measured.
type ImageInfo struct {
	ID        string `json:"id"`
	Digest    string `json:"digest,omitempty"`
	SizeBytes int64  `json:"sizeBytes"`
}

// ServerResult is one server's part of a run.
type ServerResult struct {
	Server catalog.Server `json:"server"`
	Image  ImageInfo      `json:"image"`
	// Mode, Batch and BatchSize say how the server shared the host while it was measured.
	Mode            plan.Mode        `json:"mode"`
	Batch           int              `json:"batch"`
	BatchSize       int              `json:"batchSize"`
	CPUSet          string           `json:"cpuset"`
	LoadgenCPUSet   string           `json:"loadgenCpuset"`
	StartupMs       float64          `json:"startupMs"`
	IdleMemoryBytes int64            `json:"idleMemoryBytes"`
	PeakMemoryBytes int64            `json:"peakMemoryBytes"`
	Workloads       []WorkloadResult `json:"workloads"`
	Error           string           `json:"error,omitempty"`
}

// WorkloadResult is one server under one workload.
type WorkloadResult struct {
	Workload workload.Workload `json:"workload"`
	// Summary merges the measured slices.
	Summary oha.Slice `json:"summary"`
	CPU     struct {
		Mean float64 `json:"mean"`
		Max  float64 `json:"max"`
	} `json:"cpu"`
	Memory struct {
		Mean int64 `json:"mean"`
		Peak int64 `json:"peak"`
	} `json:"memory"`
	// RPSPerCore is throughput per fully busy core: how efficiently the server uses its CPU.
	RPSPerCore float64      `json:"rpsPerCore"`
	Slices     []SlicePoint `json:"slices"`
	Error      string       `json:"error,omitempty"`
}

// SlicePoint is one second of a workload, for charts.
type SlicePoint struct {
	Index       int     `json:"i"`
	Warmup      bool    `json:"warmup"`
	RPS         float64 `json:"rps"`
	P50         float64 `json:"p50"`
	P99         float64 `json:"p99"`
	Max         float64 `json:"max"`
	Failed      int     `json:"failed"`
	CPU         float64 `json:"cpu"`
	MemoryBytes int64   `json:"mem"`
}

// EventType names what an Event reports.
type EventType string

// Events, in roughly the order a run sends them.
const (
	EventPlan         EventType = "plan"
	EventStatus       EventType = "status"
	EventReady        EventType = "ready"
	EventStats        EventType = "stats"
	EventSlice        EventType = "slice"
	EventWorkloadDone EventType = "workload"
	EventLog          EventType = "log"
	EventError        EventType = "error"
	EventDone         EventType = "done"
)

// Event is something that happened during a run, sent live to the dashboard.
type Event struct {
	Type           EventType       `json:"type"`
	Time           time.Time       `json:"t"`
	Server         string          `json:"server,omitempty"`
	Workload       string          `json:"workload,omitempty"`
	Message        string          `json:"message,omitempty"`
	Plan           *plan.Plan      `json:"plan,omitempty"`
	Host           *HostInfo       `json:"host,omitempty"`
	Config         *Config         `json:"config,omitempty"`
	StartupMs      float64         `json:"startupMs,omitempty"`
	Stats          *docker.Sample  `json:"stats,omitempty"`
	Slice          *SlicePoint     `json:"slice,omitempty"`
	WorkloadResult *WorkloadResult `json:"workloadResult,omitempty"`
	Result         *Result         `json:"result,omitempty"`
}

func newID() string {
	b := make([]byte, 3)
	rand.Read(b)
	return time.Now().UTC().Format("20060102-150405") + "-" + hex.EncodeToString(b)
}
