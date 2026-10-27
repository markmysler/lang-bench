<?php

namespace App\Http\Controllers;

use App\Models\World;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class BenchController
{
    public function health(): Response
    {
        return response('ok', 200, ['Content-Type' => 'text/plain']);
    }

    public function plaintext(): Response
    {
        return response('Hello, World!', 200, ['Content-Type' => 'text/plain']);
    }

    public function json(): JsonResponse
    {
        return response()->json(['message' => 'Hello, World!']);
    }

    public function cpu(Request $request): JsonResponse
    {
        $n = self::param($request, 'n', 20, 0, 32);

        return response()->json(['n' => $n, 'fib' => self::fib($n)]);
    }

    public function io(Request $request): JsonResponse
    {
        $ms = self::param($request, 'ms', 10, 0, 1000);
        // usleep blocks this worker process for the whole wait. It can return early if a signal
        // interrupts it, so any shortfall against the monotonic clock is slept again.
        $end = hrtime(true) + $ms * 1_000_000;
        for ($left = $ms * 1_000_000; $left > 0; $left = $end - hrtime(true)) {
            usleep(intdiv($left + 999, 1000));
        }

        return response()->json(['ms' => $ms]);
    }

    public function db(): JsonResponse
    {
        return response()->json(World::find(random_int(1, 10000)));
    }

    public function queries(Request $request): JsonResponse
    {
        $n = self::param($request, 'n', 1, 1, 500);
        $rows = [];
        for ($i = 0; $i < $n; $i++) {
            $rows[] = World::find(random_int(1, 10000));
        }

        return response()->json($rows);
    }

    private static function fib(int $n): int
    {
        return $n < 2 ? $n : self::fib($n - 1) + self::fib($n - 2);
    }

    // param reads an integer query parameter: missing or invalid gives $def, out of range is clamped.
    private static function param(Request $request, string $name, int $def, int $lo, int $hi): int
    {
        $v = $request->query->all()[$name] ?? null;
        if (is_array($v)) {
            $v = $v[0] ?? null;
        }
        if (! is_string($v) || ! preg_match('/^[+-]?\d+$/', $v)) {
            return $def;
        }

        return max($lo, min($hi, (int) $v));
    }
}
