# jsPsych2

**Behavioral experiment framework built on statecharts and the actor model.**

jsPsych2 reimagines the online experiment paradigm using [XState v5](https://stately.ai/docs/xstate) as its core runtime. Instead of flat timelines, imperative callbacks, and plugin lifecycle methods, experiments are expressed as **hierarchical state machines** — inspectable, testable, serializable, and composable.

---

## Quick start

```bash
# Clone and install
git clone https://github.com/xstate-experiments/jsPsych2.git
cd jsPsych2
pnpm install

# Run tests (107 tests across all packages)
pnpm test

# Run an example with Vite dev server
pnpm --filter @xstate-experiments/example-bandit-2arm dev

# Build the core library
pnpm --filter @xstate-experiments/core build
```

## Project structure

```
jsPsych2/
├── packages/
│   ├── core/                     # @xstate-experiments/core
│   │   └── src/
│   │       ├── machines/         # experiment, block, trial factories
│   │       ├── actors/           # timing, keyboard, data collection
│   │       └── utils.ts          # scoring, randomization, guard helpers
│   ├── plugin-html-keyboard/     # HTML stimulus + keyboard response
│   ├── plugin-canvas/            # Canvas-based stimulus + response
│   ├── plugin-survey/            # Survey/questionnaire trials
│   └── plugin-instructions/      # Multi-page instruction display
├── examples/
│   ├── arc-grid/                 # ARC pattern puzzles (original prototype)
│   ├── bandit-2arm/              # Two-armed bandit (Rescorla-Wagner)
│   ├── go-nogo/                  # Pavlovian Go/No-Go (response inhibition)
│   ├── reversal-learning/        # 3-arm bandit with mid-task reversal
│   └── two-step/                 # Daw et al. two-stage decision task
├── docs/                         # Starlight documentation site
└── .github/workflows/            # CI: test, docs deploy, npm release
```

## Why this exists

[jsPsych](https://www.jspsych.org/) is the dominant framework for browser-based behavioral experiments. But its architecture — a linear timeline of trial objects configured with callbacks — creates problems as experiments grow:

| Problem | jsPsych v7/v8 | jsPsych2 (XState) |
|---|---|---|
| **Flat timeline** | Blocks/phases simulated with nested timelines | Nested statecharts: experiment > block > trial > phase |
| **One-shot conditionals** | `conditional_function` evaluates once at parse time | Guards evaluate on every transition attempt |
| **Imperative side effects** | `on_start`, `on_finish`, `on_load` callbacks | `entry` / `exit` actions on states |
| **No concurrency** | Cannot run parallel processes | Parallel states and background actors |
| **Opaque configuration** | Trial objects only make sense inside jsPsych | Machine definitions are JSON — visualize, validate, share |
| **Hard to test** | Need a browser, DOM, simulated keypresses | Send events, assert state transitions — no browser needed |

## Architecture

```
experiment (top-level machine)
├── instructions
├── running
│   ├── active
│   │   └── invoke trialMachine(trials[i])
│   │       ├── fixation (500ms)
│   │       ├── stimulus (await response)
│   │       ├── feedback (1000ms)
│   │       └── done (emits output)
│   └── checkNext
│       ├── [more trials] → active
│       └── [done] → results
└── results (final)
```

Each trial is an **invoked actor** — it receives input, runs through its states, and emits structured output. The experiment machine collects these outputs and manages the sequence.

## Example: Two-armed bandit

```typescript
import { setup, assign } from 'xstate';

const banditTrialMachine = setup({
  types: {} as {
    context: { chosenArm: 0 | 1 | null; reward: 0 | 1 | null; rt: number | null; /* ... */ };
    events: { type: 'CHOOSE'; arm: 0 | 1 };
  },
  actions: {
    processChoice: assign(({ context, event }) => {
      const reward = Math.random() < context.rewardProbabilities[event.arm] ? 1 : 0;
      const newQ = [...context.qValues] as [number, number];
      newQ[event.arm] += context.alpha * (reward - newQ[event.arm]); // Rescorla-Wagner
      return { chosenArm: event.arm, reward, rt: performance.now() - context.stimulusOnsetTime!, updatedQValues: newQ };
    }),
  },
}).createMachine({
  id: 'banditTrial',
  initial: 'fixation',
  states: {
    fixation: { after: { 500: 'stimulus' } },
    stimulus: { on: { CHOOSE: { target: 'feedback', actions: 'processChoice' } } },
    feedback: { after: { 1500: 'done' } },
    done: { type: 'final' },
  },
});
```

## Core library (`@xstate-experiments/core`)

### Machine factories
- `createExperimentMachine(config)` — instructions → blocks → results
- `createBlockMachine(config)` — trial iteration with aggregate metrics
- `createTrialMachine(config)` — fixation → stimulus → response → feedback → done

### Built-in actors
- **Data actor** — buffers trial outputs, auto-flushes to endpoint, exports CSV/JSON
- **Timing actor** — rAF loop, detects frame drops, sends `TIMING.FRAME_DROP` events
- **Keyboard actor** — wraps keydown with valid-key filtering
- **Mouse actor** — click events with coordinates and timestamp

### Utilities
- `evaluateGrid(submitted, expected)` / `evaluateResponse(submitted, expected)` — scoring
- `shuffle()`, `latinSquare()`, `counterbalance()`, `randomize()` — trial ordering
- `afterNCorrect(n)`, `afterNTrials(n)`, `staircaseRule(up, down)` — guard helpers

## Examples

Each example is a standalone experiment with machine definition, DOM renderer, config, and headless tests:

| Example | Trials | What it demonstrates |
|---|---|---|
| **bandit-2arm** | 80 | Rescorla-Wagner Q-learning, simplest RL task |
| **go-nogo** | 100 | Response deadlines, trial-type guards, inhibition metrics |
| **reversal-learning** | 120 | Mid-task contingency change, guard-based probability switching |
| **two-step** | 200 | Hierarchical actors (stage1 invokes stage2), drifting rewards |
| **arc-grid** | 3 | Grid editing, retry logic, cell-by-cell evaluation |

Run any example: `pnpm --filter @xstate-experiments/example-bandit-2arm dev`

## Testing

All experiment logic runs headlessly — no browser needed:

```bash
pnpm test                    # Run all 107 tests via turborepo
pnpm --filter @xstate-experiments/core test          # Core only (44 tests)
pnpm --filter @xstate-experiments/example-two-step test  # Single example
```

## Documentation

Full Starlight docs site with getting-started guide, core concepts (statecharts, actors, guards, actions), migration guide from jsPsych, and annotated example walkthroughs.

```bash
pnpm --filter @xstate-experiments/docs dev    # Local dev server
pnpm --filter @xstate-experiments/docs build  # Production build
```

## Design principles

1. **Statecharts are the experiment definition.** The machine config is the source of truth.
2. **Actors are the plugin model.** Each trial type accepts input and emits output. No class hierarchies.
3. **Guards are adaptive logic.** Staircases, conditional branching, stopping rules — all guards on transitions.
4. **Side effects are structural.** Stimulus onset, data recording, timing — `entry`/`exit` actions, not callbacks.
5. **Test without a browser.** Send events, assert transitions. If you can't test it headlessly, the abstraction is wrong.
6. **Framework-agnostic rendering.** State layer doesn't care if you render with React, Lit, vanilla DOM, or PixiJS.

## Background reading

- [Harel, D. (1987). Statecharts: A visual formalism for complex systems.](https://www.sciencedirect.com/science/article/pii/0167642387900359)
- [XState v5 documentation](https://stately.ai/docs/xstate)
- [de Leeuw, J.R. (2015). jsPsych: A JavaScript library for creating behavioral experiments in a Web browser.](https://link.springer.com/article/10.3758/s13428-014-0458-y)
- [Daw, N.D. et al. (2011). Model-based influences on humans' choices and striatal prediction errors. Neuron, 69(6).](https://doi.org/10.1016/j.neuron.2011.02.027)

## License

MIT
