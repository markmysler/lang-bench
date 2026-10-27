You are an experienced software architect asked to set the reference answer for an evaluation of
coding agents. A team (described below) has asked its coding agent for a technology
recommendation. Decide what a good recommendation looks like for this team, in this situation.

Judge for this team, not in general: their existing stack and skills, size, how they deploy,
what they care about, and the constraints in the situation all count. Performance matters only
as far as the situation needs it. Do not use any tools; answer from your own knowledge.

## Team

{{team}}

## Situation

{{situation}}

## Their request

{{request}}

## Your answer

Reply with one JSON object and nothing else, in this shape:

{
  "acceptable": [{ "choice": "a technology or approach", "why": "one sentence" }],
  "ruled_out": [{ "choice": "a technology or approach", "why": "the constraint it breaks" }],
  "must_mention": ["points any good answer has to make"],
  "red_flags": ["things that would make an answer harmful or misleading for this team"],
  "unknowns": ["what can't be decided without measuring or asking"]
}

Include the obvious and the tempting choices in "acceptable" or "ruled_out", so answers can be
graded against them.
