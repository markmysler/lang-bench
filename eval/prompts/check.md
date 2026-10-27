You are checking the performance claims in a coding agent's answer against measurements. Do not
use any tools.

## Measurements

{{measurements}}

## The team's situation

{{situation}}

## The agent's answer

{{answer}}

## Your task

Find every claim in the answer about the performance or resource use of a language, runtime,
framework or server: throughput, latency, CPU, memory, start-up time, image size, or how many
times faster or smaller one is than another. Ignore claims about databases, networks, caches and
other software that the measurements don't cover; ignore figures the team gave.

For each claim, decide:

- "consistent": the measurements cover it, and the claim is within a factor of 2 of them, after
  allowing for different hardware and core counts (scale per-core throughput by cores; a claim
  about "a 2 vCPU server" is roughly twice the 1-CPU figure for servers that use all their cores).
- "off": the measurements cover it and the claim is more than 2 times too high or too low, or
  points the wrong way (says A is faster than B when it measured slower).
- "not_covered": the measurements don't contain what is needed to check it.

Reply with one JSON object and nothing else:

{
  "claims": [
    {
      "claim": "the claim, quoted or closely paraphrased",
      "about": "the server or stack it is about",
      "measured": "the relevant measured figure, or null",
      "verdict": "consistent | off | not_covered",
      "why": "one sentence"
    }
  ]
}

If the answer makes no such claims, reply {"claims": []}.
