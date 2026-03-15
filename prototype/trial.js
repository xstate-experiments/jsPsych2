import { setup, assign } from 'https://esm.sh/xstate@5';

/**
 * Cell-by-cell grid comparison.
 * @param {number[][]} submitted
 * @param {number[][]} expected
 * @returns {{ correct: boolean, accuracy: number, totalCells: number, correctCells: number }}
 */
export function evaluateGrid(submitted, expected) {
  let total = 0;
  let correctCells = 0;

  for (let r = 0; r < expected.length; r++) {
    for (let c = 0; c < expected[0].length; c++) {
      total++;
      if (submitted?.[r]?.[c] === expected[r][c]) correctCells++;
    }
  }

  return {
    correct: total === correctCells,
    accuracy: total > 0 ? correctCells / total : 0,
    totalCells: total,
    correctCells
  };
}

/**
 * Trial machine — single ARC task lifecycle:
 *   showTraining -> testPresentation -> responseCollection -> evaluation -> feedback -> (retry | done)
 *
 * Input: { task, taskIndex }
 * Output: { taskIndex, correct, accuracy, attempts, rt }
 */
export const trialMachine = setup({
  actions: {
    recordResponseStart: assign({
      responseStartTime: () => performance.now()
    }),
    recordSubmission: assign({
      submittedGrid: ({ event }) => event.grid,
      rt: ({ context }) => performance.now() - context.responseStartTime
    }),
    evaluate: assign(({ context }) => {
      const result = evaluateGrid(
        context.submittedGrid,
        context.task.test[0].output
      );
      return {
        correct: result.correct,
        accuracy: result.accuracy,
        attempt: context.attempt + 1
      };
    })
  },
  guards: {
    isCorrect: ({ context }) => context.correct,
    canRetry: ({ context }) => !context.correct && context.attempt < 3
  }
}).createMachine({
  id: 'trial',
  initial: 'showTraining',
  context: ({ input }) => ({
    task: input.task,
    taskIndex: input.taskIndex,
    attempt: 0,
    submittedGrid: null,
    rt: null,
    responseStartTime: null,
    correct: false,
    accuracy: 0
  }),
  states: {
    showTraining: {
      on: { START_TEST: 'testPresentation' }
    },
    testPresentation: {
      on: { BEGIN_RESPONSE: 'responseCollection' }
    },
    responseCollection: {
      entry: 'recordResponseStart',
      on: {
        SUBMIT_GRID: {
          target: 'evaluation',
          actions: 'recordSubmission'
        }
      }
    },
    evaluation: {
      entry: 'evaluate',
      always: 'feedback'
    },
    feedback: {
      after: {
        1500: [
          { target: 'done', guard: 'isCorrect' },
          { target: 'responseCollection', guard: 'canRetry' },
          { target: 'done' }
        ]
      }
    },
    done: { type: 'final' }
  },
  output: ({ context }) => ({
    taskIndex: context.taskIndex,
    correct: context.correct,
    accuracy: context.accuracy,
    attempts: context.attempt,
    rt: context.rt
  })
});
