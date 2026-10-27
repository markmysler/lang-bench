# 15-matchmaking

**Team:** game-studio

## Situation

At launch, up to 50,000 players are online at once. The back end must keep a WebSocket open to each
player for presence and match invitations, and match players within 2 seconds. The existing
back end is a Node and Postgres REST API for accounts and inventory.

## The request

> Can our Node back end handle realtime matchmaking and presence for launch, or should we build it in something else like Elixir or Go?
