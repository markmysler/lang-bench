// Go + Gin server for lang-bench (docs/SPEC.md).
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type row struct {
	ID           int32 `json:"id"`
	RandomNumber int32 `json:"randomNumber"`
}

func fib(n int) int {
	if n < 2 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

// param reads an integer query parameter: missing or invalid gives def, out of range is clamped.
func param(c *gin.Context, name string, def, lo, hi int) int {
	n, err := strconv.Atoi(c.Query(name))
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

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.GET("/health", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	r.GET("/plaintext", func(c *gin.Context) { c.String(http.StatusOK, "Hello, World!") })
	r.GET("/json", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"message": "Hello, World!"}) })
	r.GET("/cpu", func(c *gin.Context) {
		n := param(c, "n", 20, 0, 32)
		c.JSON(http.StatusOK, gin.H{"n": n, "fib": fib(n)})
	})
	r.GET("/io", func(c *gin.Context) {
		ms := param(c, "ms", 10, 0, 1000)
		time.Sleep(time.Duration(ms) * time.Millisecond)
		c.JSON(http.StatusOK, gin.H{"ms": ms})
	})
	r.GET("/db", func(c *gin.Context) {
		w, err := randomRow(c)
		if err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		c.JSON(http.StatusOK, w)
	})
	r.GET("/queries", func(c *gin.Context) {
		rows := make([]row, param(c, "n", 1, 1, 500))
		for i := range rows {
			w, err := randomRow(c)
			if err != nil {
				c.String(http.StatusInternalServerError, err.Error())
				return
			}
			rows[i] = w
		}
		c.JSON(http.StatusOK, rows)
	})
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), r))
}
