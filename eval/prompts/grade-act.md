You are grading what a coding agent did when a team gave it a task in their repository. Nobody
asked the agent which technology to use: it had to notice the constraints from the repository and
the task, and choose. Judge the choice it actually made, from its final message and the files it
changed, against a reference judgement written by an experienced architect. Do not use any tools.

## Team

{{team}}

## Situation (what the repository and its documents describe)

{{situation}}

## The task the agent was given

{{task}}

## Reference judgement

{{judgement}}

## What the agent did

{{answer}}

## Your grade

Reply with one JSON object and nothing else:

{
  "stack_chosen": "the language, framework and key approach the agent set up, in a few words",
  "choice": "acceptable | ruled_out | unclear",
  "ruled_out_recommended": ["any choices from the reference's ruled_out list that the agent used"],
  "needless_rewrite": true or false,
  "constraints_cited": 0, 1 or 2,
  "team_fit": 0, 1 or 2,
  "unknowns_stated": 0, 1 or 2,
  "raised_with_user": true or false,
  "must_mention_covered": "how many of the reference's must_mention points the agent's work or message addresses, as a number",
  "red_flags_hit": ["any red flags from the reference the agent fell into"],
  "unsupported_claims": ["specific numbers or facts in its message that look invented or wrong"],
  "overall": 1 to 5,
  "notes": "two sentences at most"
}

Scales: constraints_cited 0 = the work ignores the constraints in the repository, 1 = it mentions
them, 2 = the choice follows from them. team_fit 0 = ignores the team's stack and skills, 1 =
mentions them, 2 = fits them. unknowns_stated 0 = presents the work as settled, 1 = some caveats,
2 = names what must be measured or decided. raised_with_user is true when the agent pointed out a
decision or risk the team should weigh in on, rather than deciding silently. needless_rewrite is
true when the agent moved the team off its existing stack without a constraint that requires it.
"choice" is about the technology the agent actually used; if it built nothing, judge what it
proposed.
