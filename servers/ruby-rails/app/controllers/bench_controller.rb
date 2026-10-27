class BenchController < ActionController::API
  NUMBER = /\A[+-]?\d+\z/

  def health
    render plain: "ok"
  end

  def plaintext
    render plain: "Hello, World!"
  end

  def json
    render json: { message: "Hello, World!" }
  end

  def cpu
    # Computed in the request thread on purpose: this workload measures the interpreter (YJIT).
    n = param(:n, 20, 0, 32)
    render json: { n: n, fib: fib(n) }
  end

  def io
    ms = param(:ms, 10, 0, 1000)
    # sleep releases the GVL, so the process's other threads keep serving. Any shortfall,
    # measured on the monotonic clock, is slept out so the answer never comes early.
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + ms / 1000.0
    while (left = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)) > 0
      sleep(left)
    end
    render json: { ms: ms }
  end

  def db
    render json: random_row
  end

  def queries
    render json: Array.new(param(:n, 1, 1, 500)) { random_row }
  end

  # A database error answers 500 with the message, as the other servers do.
  rescue_from ActiveRecord::ActiveRecordError do |err|
    render plain: err.message, status: :internal_server_error
  end

  private

  def fib(n)
    n < 2 ? n : fib(n - 1) + fib(n - 2)
  end

  # Reads an integer query parameter: missing or invalid gives default, out of range is clamped.
  def param(name, default, lo, hi)
    value = request.query_parameters[name.to_s]
    return default unless value.is_a?(String) && NUMBER.match?(value)

    value.to_i.clamp(lo, hi)
  end

  # One query per row, through ActiveRecord: a prepared SELECT by primary key.
  def random_row
    world = World.find(rand(1..10_000))
    { id: world.id, randomNumber: world.randomnumber }
  end
end
