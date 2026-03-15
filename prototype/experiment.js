import { setup, assign, createActor } from 'https://esm.sh/xstate@5';
import { trialMachine } from './trial.js';
import { renderGrid, createColorPicker, renderTrainingPair } from './grid.js';

// ---------------------------------------------------------------------------
// Load task definitions
// ---------------------------------------------------------------------------
const tasks = await fetch('./tasks.json').then(r => r.json());

// ---------------------------------------------------------------------------
// Experiment machine
// ---------------------------------------------------------------------------
const experimentMachine = setup({
  actors: {
    trialMachine
  },
  actions: {
    collectResult: assign({
      responses: ({ context, event }) => [...context.responses, event.output],
      currentIndex: ({ context }) => context.currentIndex + 1
    }),
    recordStartTime: assign({
      startTime: () => performance.now()
    })
  },
  guards: {
    hasMoreTasks: ({ context }) => context.currentIndex < context.tasks.length
  }
}).createMachine({
  id: 'experiment',
  initial: 'instructions',
  context: {
    tasks,
    currentIndex: 0,
    responses: [],
    startTime: null
  },
  states: {
    instructions: {
      on: {
        START: { target: 'runningTrials', actions: 'recordStartTime' }
      }
    },
    runningTrials: {
      initial: 'active',
      states: {
        active: {
          invoke: {
            id: 'currentTrial',
            src: 'trialMachine',
            input: ({ context }) => ({
              task: context.tasks[context.currentIndex],
              taskIndex: context.currentIndex
            }),
            onDone: {
              target: 'checkNext',
              actions: 'collectResult'
            }
          }
        },
        checkNext: {
          always: [
            { target: 'active', guard: 'hasMoreTasks' },
            { target: '#experiment.results' }
          ]
        }
      }
    },
    results: { type: 'final' }
  }
});

// ---------------------------------------------------------------------------
// Actor + rendering
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
let lastRenderKey = '';
let colorPicker = null;
let editableGrid = null;

const actor = createActor(experimentMachine, {
  inspect: (inspEvent) => {
    if (inspEvent.type === '@xstate.snapshot') {
      requestAnimationFrame(() => render());
    }
  }
});

/** Get the currently invoked trial actor (if any). */
function getTrialActor() {
  return actor.getSnapshot().children.currentTrial;
}

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------
function render() {
  const snapshot = actor.getSnapshot();

  // Build a key to avoid redundant DOM rebuilds (especially during editing)
  let renderKey;
  if (snapshot.matches('instructions')) {
    renderKey = 'instructions';
  } else if (snapshot.matches('runningTrials')) {
    const trialRef = snapshot.children.currentTrial;
    const ts = trialRef?.getSnapshot();
    renderKey = `trial-${snapshot.context.currentIndex}-${ts?.value}-${ts?.context?.attempt}`;
  } else {
    renderKey = 'results';
  }

  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;

  console.log(`[experiment] render: ${renderKey}`);

  if (snapshot.matches('instructions')) {
    renderInstructions();
  } else if (snapshot.matches('runningTrials')) {
    const trialRef = snapshot.children.currentTrial;
    if (trialRef) {
      renderTrial(snapshot.context, trialRef.getSnapshot());
    }
  } else if (snapshot.status === 'done') {
    renderResults(snapshot.context);
  }
}

// ---------------------------------------------------------------------------
// Instructions screen
// ---------------------------------------------------------------------------
function renderInstructions() {
  app.innerHTML = `
    <h1>XState Experiment: ARC Pattern Tasks</h1>
    <section>
      <p>You will be shown <strong>${tasks.length} pattern-completion tasks</strong>.</p>
      <p>For each task:</p>
      <ol>
        <li>Study the training examples to discover the transformation rule</li>
        <li>Apply the rule to the test input by painting the output grid</li>
        <li>You get up to <strong>3 attempts</strong> per task</li>
      </ol>
      <button id="btn-start">Begin Experiment</button>
    </section>
    <section>
      <p style="color:#666;font-size:0.85rem;">
        State machine transitions are logged to the browser console.<br/>
        Paste the machine config into
        <a href="https://stately.ai/viz" target="_blank" style="color:#7FDBFF;">stately.ai/viz</a>
        to visualise the statechart.
      </p>
    </section>
  `;
  document.getElementById('btn-start').onclick = () => actor.send({ type: 'START' });
}

// ---------------------------------------------------------------------------
// Trial screen
// ---------------------------------------------------------------------------
function renderTrial(expCtx, trialSnap) {
  const task = expCtx.tasks[expCtx.currentIndex];
  const trialState = trialSnap.value;
  const ctx = trialSnap.context;

  let html = `
    <h1>Task ${expCtx.currentIndex + 1} of ${expCtx.tasks.length}</h1>
    <div class="task-name">${task.name}</div>
    <div class="state-badge">trial: ${trialState} &middot; attempt: ${ctx.attempt} / 3</div>
  `;

  // --- showTraining ---
  if (trialState === 'showTraining') {
    html += `<h2>Training Examples</h2><div id="training-pairs"></div>
             <button id="btn-start-test">I see the pattern &mdash; show me the test</button>`;
    app.innerHTML = html;

    const container = document.getElementById('training-pairs');
    task.train.forEach((pair) => {
      const el = document.createElement('div');
      renderTrainingPair(el, pair);
      container.appendChild(el);
    });

    document.getElementById('btn-start-test').onclick = () =>
      getTrialActor().send({ type: 'START_TEST' });

  // --- testPresentation ---
  } else if (trialState === 'testPresentation') {
    html += `<h2>Test Input</h2>
             <p>Study the test input, then click below to start editing your answer.</p>
             <div id="test-input"></div>
             <button id="btn-begin">Begin Editing</button>`;
    app.innerHTML = html;

    renderGrid(document.getElementById('test-input'), task.test[0].input);

    document.getElementById('btn-begin').onclick = () =>
      getTrialActor().send({ type: 'BEGIN_RESPONSE' });

  // --- responseCollection ---
  } else if (trialState === 'responseCollection') {
    html += `
      <h2>Your Answer</h2>
      <div class="test-area">
        <div class="test-input-section">
          <label>Test Input (reference)</label>
          <div id="test-ref"></div>
        </div>
        <div class="test-response-section">
          <label>Your Output (click/drag to paint)</label>
          <div id="color-picker-container"></div>
          <div id="response-grid"></div>
        </div>
      </div>
      <button id="btn-submit">Submit Answer</button>
      <button id="btn-reset" class="secondary">Reset Grid</button>
    `;
    app.innerHTML = html;

    renderGrid(document.getElementById('test-ref'), task.test[0].input);

    colorPicker = createColorPicker(document.getElementById('color-picker-container'));

    // On retry, start from previous submission; otherwise start from test input
    const startGrid = ctx.submittedGrid
      ? ctx.submittedGrid.map(r => [...r])
      : task.test[0].input.map(r => [...r]);

    editableGrid = renderGrid(
      document.getElementById('response-grid'),
      startGrid,
      { editable: true, selectedColor: () => colorPicker.getColor() }
    );

    document.getElementById('btn-submit').onclick = () => {
      const grid = editableGrid.getGrid();
      getTrialActor().send({ type: 'SUBMIT_GRID', grid });
    };

    document.getElementById('btn-reset').onclick = () => {
      const fresh = task.test[0].input.map(r => [...r]);
      editableGrid = renderGrid(
        document.getElementById('response-grid'),
        fresh,
        { editable: true, selectedColor: () => colorPicker.getColor() }
      );
    };

  // --- evaluation / feedback ---
  } else if (trialState === 'evaluation' || trialState === 'feedback') {
    const isCorrect = ctx.correct;
    const outOfAttempts = ctx.attempt >= 3;
    const pct = (ctx.accuracy * 100).toFixed(0);

    let msg;
    if (isCorrect) {
      msg = `Correct! ${pct}% accuracy.`;
    } else if (outOfAttempts) {
      msg = `Incorrect after 3 attempts. ${pct}% accuracy. The expected output is shown below.`;
    } else {
      msg = `Incorrect &mdash; ${3 - ctx.attempt} attempt(s) remaining. ${pct}% accuracy.`;
    }

    html += `<div class="feedback ${isCorrect ? 'correct' : 'incorrect'}">${msg}</div>`;

    if (!isCorrect) {
      html += `<div class="test-area">
        <div><label>Your answer</label><div id="submitted-grid"></div></div>
        ${outOfAttempts ? '<div><label>Expected</label><div id="expected-grid"></div></div>' : ''}
      </div>`;
    }

    app.innerHTML = html;

    if (!isCorrect && ctx.submittedGrid) {
      renderGrid(document.getElementById('submitted-grid'), ctx.submittedGrid);
      if (outOfAttempts) {
        renderGrid(document.getElementById('expected-grid'), task.test[0].output);
      }
    }

  // --- done (brief interstitial before next task) ---
  } else if (trialState === 'done') {
    html += `<p>Loading next task&hellip;</p>`;
    app.innerHTML = html;
  }
}

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
function renderResults(context) {
  const totalTime = ((performance.now() - context.startTime) / 1000).toFixed(1);
  const correctCount = context.responses.filter(r => r.correct).length;

  let rows = '';
  context.responses.forEach((r, i) => {
    const cls = r.correct ? 'correct' : 'incorrect';
    rows += `<tr>
      <td>${i + 1}. ${context.tasks[i].name}</td>
      <td class="${cls}">${r.correct ? 'Yes' : 'No'}</td>
      <td>${(r.accuracy * 100).toFixed(0)}%</td>
      <td>${r.attempts}</td>
      <td>${r.rt ? r.rt.toFixed(0) + ' ms' : '\u2014'}</td>
    </tr>`;
  });

  app.innerHTML = `
    <h1>Results</h1>
    <p><strong>${correctCount}</strong> of ${context.responses.length} tasks correct &mdash;
       completed in ${totalTime} s</p>
    <table class="results-table">
      <thead><tr>
        <th>Task</th><th>Correct</th><th>Accuracy</th><th>Attempts</th><th>Response Time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <section>
      <h2>What just happened</h2>
      <p style="color:#aaa;line-height:1.6;">
        Every screen transition above was driven by an <strong>XState v5 statechart</strong>.<br/>
        The experiment machine invoked a child <em>trial actor</em> for each task.<br/>
        Guards determined retry logic; entry actions recorded timing.<br/>
        Open the console to see the full state-transition log.
      </p>
      <button onclick="location.reload()">Run Again</button>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
actor.start();
render();

// Expose for console debugging
window.__experimentActor = actor;
console.log(
  '%c[xstate-experiment] actor started — inspect with window.__experimentActor',
  'color: #7FDBFF'
);
