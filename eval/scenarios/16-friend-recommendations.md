# 16-friend-recommendations

**Team:** startup-ts

## Situation

The product is adding "people you may know", based on shared teams and projects: friends of
friends, up to three hops, ranked by shared connections. There are 2 million users and 40 million
relationships in Postgres today. Recommendations should load in under 300 ms.

## The request

> Should we keep this in Postgres or move the relationship data to a graph database? And does the language matter here?
