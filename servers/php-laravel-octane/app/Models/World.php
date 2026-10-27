<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class World extends Model
{
    protected $table = 'world';

    public $timestamps = false;

    // The column is randomnumber; the JSON key is randomNumber (docs/SPEC.md).
    public function toArray(): array
    {
        return ['id' => $this->id, 'randomNumber' => $this->randomnumber];
    }
}
