# ARC Prototype Documentation

## What this is

A zero-build-step proof-of-concept demonstrating the jsPsych2 paradigm: an ARC-style grid puzzle task where all experiment flow is driven by an XState v5 statechart.

## Why ARC

The ARC (Abstraction and Reasoning Corpus) testing interface is structurally identical to a behavioral experiment:

| ARC concept | Experiment concept |
|---|---|
| Show training examples | Stimulus presentation / instruction |
| Present test input | Trial stimulus |
| Collect grid response | Response collection |
| Evaluate cell-by-cell | Scoring / feedback |
| Advance or retry (max 3) | Conditional progression |

Existing ARC implementations (Chollet's vanilla JS, React-based tools) use ad-hoc state management — global variables or React state/effects. This prototype shows what happens when you use a formal state machine instead.

## Machine definitions

### Experiment machine

```
States: instructions → runningTrials → results

runningTrials substates:
  active:  invokes trialMachine with current task
  checkNext: guard-based transition to next task or results
```

**Context:**
- `tasks` — array of ARC task definitions
- `currentIndex` — which task we're on
- `responses` — collected trial outputs
- `startTime` — session start (performance.now)

**Events:**
- `START` — begin experiment (instructions → runningTrials)

### Trial machine

```
States: showTraining → testPresentation → responseCollection → evaluation → feedback → done

Retry loop: feedback → responseCollection (if wrong and attempts < 3)
```

**Context:**
- `task` — the ARC task definition
- `taskIndex` — index in experiment
- `attempt` — current attempt (0-indexed, incremented on evaluation)
- `submittedGrid` — the grid the participant submitted
- `rt` — response time (ms)
- `responseStartTime` — performance.now() at response phase entry
- `correct` — boolean
- `accuracy` — fraction of cells correct

**Events:**
- `START_TEST` — advance from training to test
- `BEGIN_RESPONSE` — advance from test presentation to editing
- `SUBMIT_GRID` — submit the painted grid (payload: `{ grid: number[][] }`)

**Guards:**
- `isCorrect` — context.correct === true
- `canRetry` — !correct && attempt < 3

**Output** (emitted on final state):
```js
{ taskIndex, correct, accuracy, attempts, rt }
```

## Tasks

Three ARC-format tasks of increasing difficulty:

### Task 1: Fill the enclosed region
**Rule:** 0-cells inside a border of 1-cells become 4 (yellow)

### Task 2: Horizontal mirror
**Rule:** Pattern on the left half of the grid is reflected to the right half

### Task 3: Gravity
**Rule:** Non-zero cells fall to the bottom of their column

Each task has 2 training examples and 1 test case.

## Grid rendering

`grid.js` provides three functions:

- `renderGrid(container, data, options)` — renders a grid as DOM divs with CSS color classes
- `createColorPicker(container, initialColor)` — 10-color palette, returns `{ getColor }`
- `renderTrainingPair(container, { input, output })` — side-by-side input→output display

The editable grid supports click-and-drag painting. Mouse events are handled on the container (event delegation). The grid maintains a mutable internal copy that's returned by `getGrid()`.

## State transition log

Open the browser console to see transitions:

```
[experiment] render: instructions
[experiment] render: trial-0-showTraining-0
[experiment] render: trial-0-testPresentation-0
[experiment] render: trial-0-responseCollection-0
[experiment] render: trial-0-feedback-1
[experiment] render: trial-1-showTraining-0
...
[experiment] render: results
```

## Console debugging

The experiment actor is exposed as `window.__experimentActor`:

```js
// Get current state
__experimentActor.getSnapshot().value

// Get trial actor
__experimentActor.getSnapshot().children.currentTrial

// Get trial state
__experimentActor.getSnapshot().children.currentTrial?.getSnapshot()

// Send events manually
__experimentActor.getSnapshot().children.currentTrial?.send({ type: 'START_TEST' })
```
