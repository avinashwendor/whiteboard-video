# Eval fixtures

One JSON file per case. Each is a synthetic project — a transcript and a world
description, never real media — plus an instruction and what a good answer looks
like.

They are deliberately small and hand-written. A fixture built by recording
whatever the agent did on the day encodes that day's behaviour as correct, which
is how a regression suite ends up defending a bug.

## Shape

```jsonc
{
  "name": "vertical-short",
  "instruction": "make this a 30 second vertical short",
  "duration": 180,          // seconds of the finished cut
  "transcript": "[00:00] …",
  "boundaryCount": 3,
  "expect": {
    "ops": ["keepOnly", "setFrame"],   // op kinds that must appear
    "forbid": ["addImage"],            // op kinds that must not
    "maxSteps": 6
  }
}
```

`expect.ops` is about *shape*, not about exact arguments: which operations a
competent answer must reach for. Asserting the numbers a model picks would make
the suite fail on answers that are merely different, which is how a harness
stops being run.
