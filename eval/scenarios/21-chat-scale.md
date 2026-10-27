# 21-chat-scale

**Team:** chat-scaleup

## Situation

Simultaneous chats will grow from 8,000 to about 60,000 within three months. Today the Laravel
Reverb servers use most of their memory at peak, and message delivery slows at the busiest times.
The two Go engineers have proposed rewriting the realtime part in Go.

## The request

> Should we rewrite our realtime layer in Go before the big customer arrives, or is there a better way?
