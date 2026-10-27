package workload

import "testing"

func TestPaths(t *testing.T) {
	for _, c := range []struct {
		w    Workload
		want string
	}{
		{Workload{Name: Plaintext}, "/plaintext"},
		{Workload{Name: JSON}, "/json"},
		{Workload{Name: CPU, Param: 25}, "/cpu?n=25"},
		{Workload{Name: IO, Param: 10}, "/io?ms=10"},
		{Workload{Name: DB}, "/db"},
		{Workload{Name: Queries, Param: 20}, "/queries?n=20"},
	} {
		if got := c.w.Path(); got != c.want {
			t.Errorf("%s: got %q, want %q", c.w.Name, got, c.want)
		}
	}
}

func TestValidate(t *testing.T) {
	ok := []Workload{{Name: CPU, Param: 20, Connections: 64}}
	if err := Validate(ok); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]Workload{
		nil,
		{{Name: "nope", Connections: 1}},
		{{Name: CPU, Param: 99, Connections: 64}},
		{{Name: JSON, Connections: 0}},
		{{Name: JSON, Connections: 64}, {Name: JSON, Connections: 32}},
	} {
		if err := Validate(bad); err == nil {
			t.Errorf("%+v: want error", bad)
		}
	}
}

func TestNeedsDatabase(t *testing.T) {
	if NeedsDatabase([]Workload{{Name: JSON}, {Name: CPU}}) {
		t.Fatal("json and cpu need no database")
	}
	if !NeedsDatabase([]Workload{{Name: JSON}, {Name: Queries}}) {
		t.Fatal("queries needs the database")
	}
}

func TestDefaultsAreValid(t *testing.T) {
	if err := Validate(Defaults()); err != nil {
		t.Fatal(err)
	}
}
