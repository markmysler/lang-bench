<?php

use App\Http\Controllers\BenchController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [BenchController::class, 'health']);
Route::get('/plaintext', [BenchController::class, 'plaintext']);
Route::get('/json', [BenchController::class, 'json']);
Route::get('/cpu', [BenchController::class, 'cpu']);
Route::get('/io', [BenchController::class, 'io']);
Route::get('/db', [BenchController::class, 'db']);
Route::get('/queries', [BenchController::class, 'queries']);
