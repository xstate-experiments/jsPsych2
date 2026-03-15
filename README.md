# jsPsych2

**Behavioral experiment framework built on statecharts and the actor model.**

jsPsych2 reimagines the online experiment paradigm using [XState v5](https://stately.ai/docs/xstate) as its core runtime. Instead of flat timelines, imperative callbacks, and plugin lifecycle methods, experiments are expressed as **hierarchical state machines** — inspectable, testable, serializable, and composable.

---

## Why this exists

[jsPsych](https://www.jspsych.org/) is the dominant framework for browser-based behavioral experiments. It works. But its architecture — a linear timeline of trial objects configured with callbacks — creates real problems as experiments grow in complexity:

| Problem | jsPsych v7/v8 | jsPsych2 (XState) |
|---|---|---|
| **Flat timeline** — no hierarchy | Trials are a flat array; blocks/phases simulated with nested timelines or `conditional_function` | Nested statecharts: experiment > block > trial > phase |
| **One-shot conditionals** | `conditional_function` evaluates once at timeline parse time | Guards evaluate on every transition attempt — adaptive experiments are native |
| **Imperative side effects** | `on_start`, `on_finish`, `on_load` callbacks wired manually | `entry` / `exit` actions on states — side effects are structural |
| **No concurrency** | Cannot run parallel processes (e.g. a timing monitor alongside a trial) | Parallel states and background actors |
| **Opaque configuration** | Trial objects only make sense inside jsPsych's runtime | Machine definitions are JSON — visualize, validate, transform, share |
| **Hard to test** | Need a browser, DOM, simulated keypresses | Send `{ type: 'SUBMIT_GRID', grid }` events, assert state transitions — no browser needed |
| **Plugin model** | Classes with lifecycle methods (`trial`, `on_finish`, `simulate`) | Actors that accept parameters and emit results |

### The deeper issue

jsPsych plugins *are* state machines — they just implement the pattern ad-hoc with instance variables, lifecycle hooks, and implicit state. Every plugin independently reinvents:

- State tracking (what phase of the trial are we in?)
- Transition logic (when do we advance? retry? skip?)
- Side-effect management (when to start/stop timers, show/hide stimuli)
- Data collection (what to record, when)

XState makes these patterns explicit, composable, and formally verifiable.

---

## The ARC connection

The [ARC (Abstraction and Reasoning Corpus)](https://arcprize.org/) testing interface — both Chollet's original vanilla JS implementation and modern React-based tools like [arc-explainer](https://github.com/fchollet/ARC-AGI) — is a behavioral experiment framework in disguise:

1. **Show training examples** (stimulus presentation)
2. **Present test input** (trial)
3. **Collect grid response** (response collection)
4. **Evaluate cell-by-cell** (scoring)
5. **Advance or retry** (conditional progression, max 3 attempts)

This *is* the jsPsych trial loop. But the ARC implementations do it with either global variables + DOM sync (Chollet) or React state + effects (arc-explainer). Neither uses the abstraction that would make the paradigm composable: a formal state machine.

The [prototype](./prototype/) in this repo reimplements an ARC-style grid task using XState, proving the concept works.

---

## Architecture

### Statechart model

```
experiment (top-level machine)
├── instructions
├── runningTrials
│   ├── active
│   │   └── invoke trialMachine(task[i])
│   │       ├── showTraining
│   │       ├── testPresentation
│   │       ├── responseCollection
│   │       ├── evaluation
│   │       ├── feedback
│   │       │   ├── [correct] → done
│   │       │   ├── [wrong, attempts < 3] → responseCollection
│   │       │   └── [wrong, attempts >= 3] → done
│   │       └── done (final, emits output)
│   └── checkNext
│       ├── [more tasks] → active (new trial actor)
│       └── [no more] → results
└── results (final)
```

### Key XState features used

1. **Hierarchical states** — experiment > runningTrials > active > trial phases. jsPsych's flat timeline cannot express this without callbacks.

2. **Invoked actors** — each trial is an actor that accepts `{ task, taskIndex }` as input and emits `{ correct, accuracy, attempts, rt }` as output. This is what jsPsych plugins *want to be*.

3. **Guards** — `isCorrect` and `canRetry` evaluate on every transition. Unlike jsPsych's `conditional_function`, guards are checked dynamically.

4. **Entry/exit actions** — `recordResponseStart`, `recordSubmission`, `evaluate` are `entry` actions on their respective states. No callback registration needed.

5. **Delayed transitions** — the feedback state uses `after: { 1500: [...] }` for timed auto-advance.

6. **Serializable definitions** — the machine config is JSON. Paste it into [stately.ai/viz](https://stately.ai/viz) to see the statechart diagram.

### What XState handles vs. what you pair it with

| Concern | XState? | Recommended pairing |
|---|---|---|
| Experiment flow / logic | **Yes** | — |
| State management | **Yes** | — |
| Stimulus rendering | No | PixiJS (timing-critical) or Lit (surveys/forms) |
| Precise timing | No | `performance.now()` + `requestAnimationFrame` |
| UI components | No | Lit web components (framework-agnostic trial types) |
| Reactive UI binding | Partial | Preact Signals or Solid.js for fine-grained reactivity |

---

## The prototype

[`prototype/`](./prototype/) contains a zero-build-step proof-of-concept: 3 ARC-style grid puzzles running on an XState statechart with vanilla DOM rendering.

### Running it

```bash
cd prototype
# Any static file server works:
npx serve .
# or: python3 -m http.server
# or: php -S localhost:8000
```

Open `http://localhost:3000` (or whichever port) in a modern browser.

### What it demonstrates

- **Nested machines**: experiment machine invokes trial actors
- **Guards on every attempt**: submit wrong → retry (up to 3x), submit correct → advance
- **Entry actions for timing**: `performance.now()` timestamps set automatically on state entry
- **Inspect in console**: state transitions logged; `window.__experimentActor` exposed for debugging
- **No framework**: vanilla DOM proves the state layer is the real contribution

### File structure

```
prototype/
├── index.html          # Entry point, ESM module loader
├── experiment.js       # Experiment machine + DOM rendering
├── trial.js            # Trial actor machine (the core)
├── grid.js             # Grid renderer + editor (pure DOM)
├── tasks.json          # 3 ARC-format task definitions
└── style.css           # Grid colors, layout
```

---

## What jsPsych looks like on XState

**jsPsych v8:**
```js
const trial = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: '<p>Press F or J</p>',
  choices: ['f', 'j'],
  on_finish: (data) => {
    data.correct = jsPsych.evaluateTimelineVariable('correct_response') === data.response;
  }
};
jsPsych.run([fixation, trial, feedback]);
```

**jsPsych2:**
```js
const trialMachine = setup({
  guards: { validKey: ({ event }) => ['f', 'j'].includes(event.key) },
  actions: {
    recordResponse: assign({
      response: ({ event }) => event.key,
      rt: ({ context }) => performance.now() - context.stimulusOnset,
      correct: ({ context, event }) => event.key === context.correctResponse
    })
  }
}).createMachine({
  id: 'trial',
  initial: 'fixation',
  context: ({ input }) => ({
    stimulus: input.stimulus,
    correctResponse: input.correctResponse,
    response: null, rt: null, correct: null,
    stimulusOnset: null
  }),
  states: {
    fixation: {
      after: { 500: 'stimulus' }
    },
    stimulus: {
      entry: assign({ stimulusOnset: () => performance.now() }),
      on: {
        KEYPRESS: {
          target: 'feedback',
          guard: 'validKey',
          actions: 'recordResponse'
        }
      }
    },
    feedback: {
      after: { 1000: 'done' }
    },
    done: { type: 'final' }
  },
  output: ({ context }) => ({
    response: context.response,
    rt: context.rt,
    correct: context.correct
  })
});
```

The second version is longer, but it is a **complete, testable, serializable specification** — not a configuration object that only makes sense inside a runtime.

---

## Roadmap

### Phase 1: Prototype (current)
- [x] ARC grid task on XState — proves the paradigm
- [x] Invoked trial actors with guard-based retry logic
- [x] `performance.now()` timing via entry actions
- [x] Console-inspectable state transitions

### Phase 2: Core library
- [ ] Generic `experimentMachine` factory with block/trial/phase hierarchy
- [ ] Built-in timing actor (parallel state, rAF-coordinated)
- [ ] Data collection actor (streams results, handles persistence)
- [ ] Keyboard/mouse/touch input actors
- [ ] Headless test runner — send events, assert transitions, no browser

### Phase 3: Trial type library
- [ ] Keyboard response (the "hello world" of experiment frameworks)
- [ ] Image/video stimulus with preloading actor
- [ ] Survey/form trials (Lit web components)
- [ ] Canvas-based stimulus (PixiJS integration for timing-critical display)
- [ ] Audio playback with Web Audio API timing

### Phase 4: Tooling
- [ ] Visual experiment builder (Stately editor integration or custom)
- [ ] JSON experiment import/export
- [ ] jsPsych v8 migration tool (convert timeline → statechart)
- [ ] Pavlovia/JATOS deployment adapters
- [ ] Real-time data dashboard (WebSocket actor)

### Phase 5: Advanced paradigms
- [ ] Adaptive staircase procedures (guards + context)
- [ ] EEG/fNIRS marker integration (parallel timing actor)
- [ ] Multi-participant experiments (networked actors)
- [ ] VR stimulus presentation (WebXR + actor model)

---

## Design principles

1. **Statecharts are the experiment definition.** The machine config is the source of truth — not a wrapper around it.

2. **Actors are the plugin model.** Each trial type is an actor that accepts input and emits output. No class hierarchies, no lifecycle methods.

3. **Guards are adaptive logic.** Staircase procedures, conditional branching, stopping rules — all expressed as guards on transitions.

4. **Side effects are structural.** Stimulus onset, data recording, timing marks — these are `entry`/`exit` actions, not imperative callbacks.

5. **Test without a browser.** If you can't test it by sending events and asserting transitions, the abstraction is wrong.

6. **Framework-agnostic rendering.** The state layer doesn't care if you render with React, Lit, vanilla DOM, or PixiJS. Rendering is a subscriber to the actor, not part of the machine.

---

## Background reading

- [Harel, D. (1987). Statecharts: A visual formalism for complex systems.](https://www.sciencedirect.com/science/article/pii/0167642387900359) — The original statechart paper
- [XState v5 documentation](https://stately.ai/docs/xstate) — The runtime this project builds on
- [de Leeuw, J.R. (2015). jsPsych: A JavaScript library for creating behavioral experiments in a Web browser.](https://link.springer.com/article/10.3758/s13428-014-0458-y) — The framework we're reimagining
- [Chollet, F. (2019). On the Measure of Intelligence.](https://arxiv.org/abs/1911.01547) — ARC and the abstraction/reasoning challenge
- [Hewitt, C. (1973). A Universal Modular ACTOR Formalism for Artificial Intelligence.](https://www.ijcai.org/Proceedings/73/Papers/027B.pdf) — The actor model

---

## License

MIT
