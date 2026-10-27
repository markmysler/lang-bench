<?php

// Only the pgsql connection, read from the variables the orchestrator sets (docs/SPEC.md).
// Laravel merges this with its own defaults for every key not set here.
return [
    'default' => 'pgsql',
    'connections' => [
        'pgsql' => [
            'driver' => 'pgsql',
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_NAME', 'bench'),
            'username' => env('DB_USER', 'bench'),
            'password' => env('DB_PASSWORD', ''),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            // The benchmark database has no TLS; skip libpq's attempt to negotiate it.
            'sslmode' => 'disable',
        ],
    ],
];
