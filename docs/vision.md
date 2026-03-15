# XState: The Library jsPsych Should Have Been Built On

## The problem with experiment frameworks

Every behavioral experiment — whether it's a simple reaction time task, an adaptive psychophysics staircase, or an ARC pattern completion puzzle — follows the same fundamental pattern:

1. Present a stimulus (enter a state)
2. Wait for a response (stay in that state until an event)
3. Evaluate the response (transition logic)
4. Record data (side effect)
5. Decide what comes next (conditional transition)

This is a state machine. It has always been a state machine. But the tools researchers use to build experiments don't use state machine formalism — they use timelines, callbacks, and lifecycle methods that *approximate* state machine behavior without the guarantees.

## jsPsych's architecture and its limits

jsPsych (v7/v8) models an experiment as a **timeline** — an ordered array of trial objects:

```js
const timeline = [
  { type: fixation, duration: 500 },
  { type: stimulus, choices: ['f', 'j'], on_finish: (data) => { ... } },
  { type: feedback, duration: 1000 }
];
jsPsych.run(timeline);
```

This works for simple designs. But it breaks down in predictable ways:

### 1. No hierarchy

A real experiment has structure: experiment → blocks → trials → phases. jsPsych represents this as a flat array with "nested timelines" — arrays within arrays — but there's no formal nesting. A block can't have its own entry/exit behavior. A phase can't reference its parent trial's state.

### 2. One-shot conditionals

`conditional_function` evaluates once when the timeline is parsed. It cannot re-evaluate dynamically. This means adaptive experiments (staircases, conditional branching based on cumulative performance) require storing state in external variables and writing manual branching logic.

### 3. Imperative callbacks everywhere

`on_start`, `on_finish`, `on_load`, `on_timeline_start`, `on_timeline_finish` — these are not a state model, they're hooks into an opaque runtime. The actual state of the experiment lives inside jsPsych's internals, and you reach in with callbacks to modify behavior.

### 4. Plugin complexity

A jsPsych plugin is a class with a `trial()` method that receives a `display_element` and `trial` parameters, calls `jsPsych.finishTrial()` when done, and manually manages its own timing, input handling, and DOM lifecycle. Every plugin reinvents:

- State tracking (which phase of the trial are we in?)
- Transition logic (when do we advance?)
- Input handling (keyboard, mouse, touch)
- Timing (when did the stimulus appear? how long was the response?)
- Cleanup (remove DOM elements, cancel timeouts)

This is a state machine implemented with instance variables and conditionals. The plugin API doesn't provide any structure for this — it's up to each plugin author to get it right.

### 5. No concurrency

jsPsych has no concept of parallel processes. You can't run a timing monitor alongside a trial, or stream data to a server while the participant works. Everything is sequential.

### 6. Not testable without a browser

Testing a jsPsych experiment requires a browser environment. You need a DOM, simulated keypresses, and timing workarounds. There's a simulation mode, but it works by having plugins implement a separate `simulate()` method — duplicating the trial logic.

## The ARC testing interface: a case study

The ARC (Abstraction and Reasoning Corpus) testing interface demonstrates the problem perfectly.

**Chollet's original implementation** uses vanilla JavaScript with global variables to track:
- Which task is being displayed
- Whether we're in training or test mode
- The current state of the editable grid
- How many attempts have been made
- Whether the submission was correct

State transitions happen through DOM event handlers that mutate globals and call rendering functions. It works, but the state model is implicit — you have to read the entire codebase to understand the possible states and transitions.

**The arc-explainer** (React 18 + TypeScript + Vite) modernizes the rendering layer but doesn't fundamentally change the state model. React component state and effects replace global variables, but the experiment flow is still encoded in conditional rendering logic and `useEffect` hooks.

Both implementations encode the same state machine:

```
showTraining → testPresentation → responseCollection → evaluation
                                        ↑                  |
                                        |    [correct] → done
                                        |    [wrong, < 3] ─┘
                                        └── [wrong, ≥ 3] → done
```

Neither makes this machine explicit. Neither can test it without rendering. Neither can compose it with other experiment flows.

## Why XState specifically

XState is not just "a state machine library." It implements the full **statechart** formalism (Harel, 1987) plus the **actor model** (Hewitt, 1973). This combination maps almost 1:1 to the experiment paradigm:

### Hierarchical states = experiment structure

```
experiment
├── instructions
├── block (for each block)
│   ├── trial (for each trial)
│   │   ├── fixation
│   │   ├── stimulus
│   │   ├── response
│   │   └── feedback
│   └── blockFeedback
└── debriefing
```

This is a nested statechart. Each level has its own context, entry/exit actions, and transition logic. jsPsych's flat timeline cannot express this without external scaffolding.

### Guards = adaptive logic

```js
guards: {
  isCorrect: ({ context }) => context.correct,
  canRetry: ({ context }) => context.attempt < 3,
  thresholdReached: ({ context }) => context.reversals >= 8,
  performanceAbove: ({ context }) => context.accuracy > 0.75
}
```

Guards evaluate on every transition attempt. A staircase procedure is just a set of guards on transitions between difficulty levels. An adaptive stopping rule is a guard on the transition from "another trial" to "done."

### Entry/exit actions = structured side effects

```js
states: {
  stimulus: {
    entry: [
      assign({ stimulusOnset: () => performance.now() }),
      'renderStimulus',
      'sendTimingMarker'
    ],
    exit: ['clearStimulus']
  }
}
```

Stimulus onset, timing marks, data recording — these are `entry` actions on states, not callbacks registered on trial objects. They run automatically when the state is entered. They can't be forgotten or called in the wrong order.

### Actors = the plugin model

Each trial type is an actor:
- It receives **input** (stimulus parameters, trial configuration)
- It manages its own **internal state** (response collection, timing)
- It emits **output** (response data, correctness, RT)
- The parent machine **invokes** it and handles its completion

This is what jsPsych plugins want to be. But instead of a class with lifecycle methods, it's a machine with states and transitions — compositionally nestable, individually testable.

### Parallel states = concurrent processes

```
experiment
├── trialSequence (sequential)
│   └── [current trial machine]
├── dataStreaming (background actor)
│   └── buffers data, flushes to server periodically
└── timingMonitor (background actor)
    └── tracks frame drops, warns on timing issues
```

A timing monitor runs *alongside* the experiment, not interleaved with it. A data streaming actor handles persistence without blocking trial flow. jsPsych has no concept of this.

### Serializable = shareable, visualizable, validatable

An XState machine config is JSON. This means:

1. **Visualize** — paste into [stately.ai/viz](https://stately.ai/viz) and get a statechart diagram
2. **Validate** — check the machine for unreachable states, missing transitions, deadlocks
3. **Share** — send the experiment definition as a file, not as "code that runs inside jsPsych"
4. **Transform** — programmatically generate experiment variants by transforming the machine config
5. **Version** — diff machine configs to see exactly what changed between experiment versions

### Testable without a browser

```js
// Test the trial machine by sending events:
const actor = createActor(trialMachine, {
  input: { task: sampleTask, taskIndex: 0 }
});
actor.start();

// Advance through states:
actor.send({ type: 'START_TEST' });
actor.send({ type: 'BEGIN_RESPONSE' });
actor.send({ type: 'SUBMIT_GRID', grid: correctAnswer });

// Assert:
const snapshot = actor.getSnapshot();
expect(snapshot.value).toBe('done');
expect(snapshot.output.correct).toBe(true);
```

No DOM. No simulated keypresses. No browser. Just events and assertions.

## What this means for researchers

The value proposition is not "XState is better than jsPsych." It's that **the experiment paradigm has always been a statechart**, and using a statechart runtime gives you properties that ad-hoc implementations cannot:

1. **Experiments are specifications, not programs.** A machine config declares what states exist, what transitions are possible, and what happens at each step. It doesn't describe *how* to run — that's the runtime's job.

2. **Composition over configuration.** Building a new experiment type means composing existing machines, not writing a new plugin class. A "go/no-go with feedback" is a trial machine with specific states and guards, not a new codebase.

3. **Formal verification.** You can check that your experiment has no dead states, no missing transitions, and no unreachable conditions — before running a single participant.

4. **Separation of concerns.** The state machine handles flow. Actors handle rendering. Guards handle adaptive logic. Actions handle data. Each concern is isolated, testable, and replaceable.

5. **Progressive complexity.** A simple RT task needs a 5-state machine. An adaptive staircase adds guards. A multi-block design adds hierarchy. A concurrent timing monitor adds a parallel state. The complexity scales with the formalism, not against it.
