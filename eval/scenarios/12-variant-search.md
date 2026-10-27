# 12-variant-search

**Team:** research-lab

## Situation

The lab built an index of genetic variants that takes 4 GB in memory. A web front end should answer
lookups (one variant, or a region) in under 50 ms, for up to 100 lookups a second when a paper
comes out. Today it is a Python script that loads the index in 3 minutes.

## The request

> What should we build the variant lookup service in so it's fast enough? We're happy to use C++ if that's what it takes.
