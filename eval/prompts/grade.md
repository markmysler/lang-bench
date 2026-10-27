You are grading a coding agent's technology recommendation against a reference judgement written
by an experienced architect. Do not use any tools. Grade only what the answer says.

## Team

{{team}}

## Situation

{{situation}}

## Their request

{{request}}

## Reference judgement

{{judgement}}

## The agent's answer

{{answer}}

## Your grade

Reply with one JSON object and nothing else:

{
  "primary_choice": "what the answer mainly recommends, in a few words",
  "choice": "acceptable | ruled_out | unclear",
  "ruled_out_recommended": ["any choices from the reference's ruled_out list that the answer recommends"],
  "needless_rewrite": true or false,
  "constraints_cited": 0, 1 or 2,
  "team_fit": 0, 1 or 2,
  "unknowns_stated": 0, 1 or 2,
  "must_mention_covered": "how many of the reference's must_mention points the answer makes, as a number",
  "red_flags_hit": ["any red flags from the reference the answer falls into"],
  "unsupported_claims": ["specific numbers or facts in the answer that look invented or wrong"],
  "overall": 1 to 5,
  "notes": "two sentences at most"
}

Scales: constraints_cited 0 = ignores the situation's constraints, 1 = mentions them, 2 = the
recommendation follows from them. team_fit 0 = ignores the team, 1 = mentions it, 2 = weighs
skills, stack and upkeep properly. unknowns_stated 0 = overconfident, 1 = some caveats,
2 = names what must be measured or asked. needless_rewrite is true when the answer pushes the team
off its existing stack without a constraint that requires it.
