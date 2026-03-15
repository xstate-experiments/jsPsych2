# Technical Architecture

## Overview

jsPsych2 is built on three pillars:

1. **XState v5** — statechart runtime (experiment flow, state management, actor orchestration)
2. **Web Components (Lit)** — framework-agnostic trial renderers (planned)
3. **The Web Platform** — `performance.now()`, `requestAnimationFrame`, Web Audio API, WebGL/PixiJS for timing-critical display

This document describes the machine architecture, actor model, data flow, and rendering strategy.

---

## Machine hierarchy

### Level 1: Experiment machine

The top-level machine orchestrates the entire session.

```
experimentMachine
├── consent          (informed consent flow)
├── instructions     (task instructions, practice)
├── blocks           (sequential block execution)
│   ├── active       (invokes current block actor)
│   └── checkNext    (advance or finish)
├── debriefing       (post-experiment surveys)
└── complete         (final — data submitted)
```

**Responsibilities:**
- Load experiment config (task list, block structure, randomization)
- Manage session-level context (participant ID, session start time, global settings)
- Invoke block actors in sequence
- Collect block-level results
- Handle session-level events (pause, abort, connectivity loss)

### Level 2: Block machine

Each block is an invoked actor within the experiment machine.

```
blockMachine
├── blockInstructions
├── trials
│   ├── active       (invokes current trial actor)
│   └── checkNext    (advance, repeat, or finish)
├── blockFeedback    (optional: show block-level performance)
└── done             (final — emits block results)
```

**Responsibilities:**
- Manage trial ordering (sequential, random, counterbalanced)
- Track block-level metrics (accuracy, mean RT)
- Apply block-level logic (practice criteria, adaptive difficulty)

### Level 3: Trial machine

Each trial is an invoked actor within the block machine. This is the core unit.

```
trialMachine
├── fixation         (timed, entry: record onset)
├── stimulus         (entry: render, record onset)
├── response         (wait for valid input event)
├── evaluation       (compute correctness, entry action)
├── feedback         (timed, show result)
└── done             (final — emits trial data)
```

**Responsibilities:**
- Manage trial phases (fixation → stimulus → response → feedback)
- Record timing data (stimulus onset, response time)
- Evaluate responses
- Handle retry logic (guards on evaluation transitions)
- Emit structured trial data as output

---

## Actor model

### Invoked actors (child machines)

```
experimentActor
├── blockActor[0]
│   ├── trialActor[0]
│   ├── trialActor[1]
│   └── ...
├── blockActor[1]
│   └── ...
└── ...
```

Each actor:
- Receives **input** from its parent (task config, parameters)
- Manages its own **context** (internal state)
- Emits **output** when it reaches a final state (results, data)
- Is **isolated** — parent and child communicate only through input/output and events

### Background actors (parallel states)

```
experiment (parallel root)
├── session           (the main sequential flow above)
├── dataCollector     (background)
│   └── buffers trial data, flushes to server
├── timingMonitor     (background)
│   └── tracks frame timing, flags dropped frames
└── connectivityMonitor (background)
    └── detects offline state, pauses if needed
```

Background actors run concurrently with the main experiment flow. They subscribe to events from the experiment system and perform their work independently.

---

## Data flow

### Trial data emission

```
trialMachine final state
  → output: { response, rt, correct, accuracy, stimulusOnset, ... }
    → blockMachine collects in context.trialResults[]
      → blockMachine final state
        → output: { trials: [...], blockAccuracy, blockMeanRT, ... }
          → experimentMachine collects in context.blockResults[]
            → experimentMachine final state
              → full dataset available
```

Data flows **upward** through actor outputs. No global data store, no side-channel mutation.

### Timing data

All timing uses `performance.now()` via entry actions:

```js
states: {
  stimulus: {
    entry: assign({
      stimulusOnset: () => performance.now()
    }),
    on: {
      RESPONSE: {
        actions: assign({
          rt: ({ context }) => performance.now() - context.stimulusOnset
        }),
        target: 'evaluation'
      }
    }
  }
}
```

For timing-critical paradigms (visual psychophysics, masking), stimulus rendering should be coordinated with `requestAnimationFrame` via a dedicated rendering actor.

---

## Rendering strategy

### Principle: rendering is a subscription, not part of the machine

The machine defines **what state the experiment is in**. Rendering is a separate concern that subscribes to state changes:

```js
actor.subscribe((snapshot) => {
  renderExperiment(snapshot);
});
```

### Rendering layers

| Layer | Technology | Use case |
|---|---|---|
| Survey/form trials | Lit web components | Text input, Likert scales, multiple choice |
| Standard visual | Vanilla DOM | Instructions, feedback, simple stimuli |
| Timing-critical visual | PixiJS + rAF | Precise onset timing, masking, animation |
| Audio | Web Audio API | Tone generation, speech playback |

### Inspect-based re-rendering

The prototype uses XState's `inspect` API to trigger re-renders on any actor state change:

```js
const actor = createActor(machine, {
  inspect: (event) => {
    if (event.type === '@xstate.snapshot') {
      requestAnimationFrame(() => render());
    }
  }
});
```

This catches both parent and child actor state changes, ensuring the UI always reflects the current machine state.

---

## Guard patterns for common experiment designs

### Staircase procedure

```js
guards: {
  shouldIncreaseDifficulty: ({ context }) =>
    context.consecutiveCorrect >= context.staircase.upRule,
  shouldDecreaseDifficulty: ({ context }) =>
    context.consecutiveIncorrect >= context.staircase.downRule,
  staircaseComplete: ({ context }) =>
    context.reversals >= context.staircase.maxReversals
}
```

### Adaptive stopping rule

```js
guards: {
  performanceCriterion: ({ context }) =>
    context.accuracy >= 0.85 && context.trialsCompleted >= 20,
  maxTrialsReached: ({ context }) =>
    context.trialsCompleted >= context.maxTrials
}
```

### Go/no-go

```js
guards: {
  isGoTrial: ({ context }) => context.trialType === 'go',
  isNoGoTrial: ({ context }) => context.trialType === 'nogo',
  responded: ({ event }) => event.type === 'RESPONSE',
  timedOut: () => true  // fallback after deadline
}
```

---

## Testing strategy

### Unit: machine logic

Test individual machines by sending event sequences and asserting states:

```js
test('trial retries on incorrect answer', () => {
  const actor = createActor(trialMachine, {
    input: { task: testTask, taskIndex: 0 }
  });
  actor.start();

  actor.send({ type: 'START_TEST' });
  actor.send({ type: 'BEGIN_RESPONSE' });
  actor.send({ type: 'SUBMIT_GRID', grid: wrongAnswer });

  // Should be in feedback, then return to responseCollection
  const snap = actor.getSnapshot();
  expect(snap.context.attempt).toBe(1);
  expect(snap.context.correct).toBe(false);
});
```

### Integration: actor composition

Test that parent-child actor communication works:

```js
test('experiment collects results from all trials', async () => {
  const actor = createActor(experimentMachine);
  actor.start();

  // ... send events to advance through all trials ...

  const final = actor.getSnapshot();
  expect(final.status).toBe('done');
  expect(final.context.responses).toHaveLength(3);
});
```

### E2E: browser rendering

For rendering verification, use Playwright or similar:

```js
test('grid cells are paintable', async ({ page }) => {
  await page.goto('/prototype/');
  await page.click('#btn-start');
  // ... interact with grid ...
});
```

---

## Configuration format

Experiment definitions should be expressible as JSON:

```json
{
  "id": "flanker-task",
  "version": "1.0.0",
  "blocks": [
    {
      "id": "practice",
      "trials": [
        {
          "type": "flanker",
          "stimulus": { "target": "H", "flankers": "SS", "congruent": false },
          "timeout": 2000,
          "feedback": true
        }
      ],
      "criterion": { "accuracy": 0.8, "minTrials": 8 }
    }
  ]
}
```

This JSON maps to machine configs: the framework generates the appropriate statechart from the declarative specification, rather than requiring researchers to write XState code directly.

---

## Dependencies

### Runtime (production)
- `xstate` v5 — statechart runtime (~15KB gzipped)

### Rendering (choose per trial type)
- Vanilla DOM (zero-dependency, for simple trials)
- Lit (for web component trial types)
- PixiJS (for timing-critical visual paradigms)

### Development
- Vitest — headless machine testing
- Playwright — E2E browser testing
- Stately visual editor — machine design and inspection
