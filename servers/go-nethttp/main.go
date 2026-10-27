// Go + net/http server for lang-bench (docs/SPEC.md).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type row struct {
	ID           int32 `json:"id"`
	RandomNumber int32 `json:"randomNumber"`
}

type message struct {
	Message string `json:"message"`
}

type fibResult struct {
	N   int `json:"n"`
	Fib int `json:"fib"`
}

type wait struct {
	MS int `json:"ms"`
}

func fib(n int) int {
	if n < 2 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
func param(r *http.Request, name string, def, lo, hi int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return def
	}
	return max(lo, min(hi, n))
}

func env(key string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return def
}

func text(w http.ResponseWriter, status int, s string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	w.Write([]byte(s))
}

// writeJSON serialises v per request with encoding/json, as the SPEC requires.
func writeJSON(w http.ResponseWriter, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		text(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(b)
}

func main() {
	runtime.GOMAXPROCS(env("CPUS", runtime.NumCPU()))

	cfg, err := pgxpool.ParseConfig(fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")))
	if err != nil {
		log.Fatal(err)
	}
	cfg.MaxConns = int32(env("DB_POOL", 16))
	// The pool connects on first use, so the server starts without a database for other workloads.
	db, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		log.Fatal(err)
	}
	randomRow := func(ctx context.Context) (row, error) {
		var r row
		err := db.QueryRow(ctx, "SELECT id, randomnumber FROM world WHERE id = $1", 1+rand.IntN(10000)).Scan(&r.ID, &r.RandomNumber)
		return r, err
	}

	// Go 1.22+ ServeMux patterns match the method and the exact path.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { text(w, http.StatusOK, "ok") })
	mux.HandleFunc("GET /plaintext", func(w http.ResponseWriter, r *http.Request) { text(w, http.StatusOK, "Hello, World!") })
	mux.HandleFunc("GET /json", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, message{"Hello, World!"}) })
	mux.HandleFunc("GET /cpu", func(w http.ResponseWriter, r *http.Request) {
		n := param(r, "n", 20, 0, 32)
		writeJSON(w, fibResult{n, fib(n)})
	})
	mux.HandleFunc("GET /io", func(w http.ResponseWriter, r *http.Request) {
		ms := param(r, "ms", 10, 0, 1000)
		time.Sleep(time.Duration(ms) * time.Millisecond)
		writeJSON(w, wait{ms})
	})
	mux.HandleFunc("GET /db", func(w http.ResponseWriter, r *http.Request) {
		row, err := randomRow(r.Context())
		if err != nil {
			text(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, row)
	})
	mux.HandleFunc("GET /queries", func(w http.ResponseWriter, r *http.Request) {
		rows := make([]row, param(r, "n", 1, 1, 500))
		for i := range rows {
			row, err := randomRow(r.Context())
			if err != nil {
				text(w, http.StatusInternalServerError, err.Error())
				return
			}
			rows[i] = row
		}
		writeJSON(w, rows)
	})
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), mux))
}
