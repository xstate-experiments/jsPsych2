/**
 * Grid rendering and interaction for ARC-style puzzles.
 * Pure DOM — no framework dependency.
 */

/**
 * Render a grid into a container element.
 * @param {HTMLElement} container
 * @param {number[][]} gridData - 2D array of color indices (0–9)
 * @param {object} [options]
 * @param {boolean} [options.editable]
 * @param {() => number} [options.selectedColor] - Returns current paint color
 * @param {(r: number, c: number, color: number) => void} [options.onChange]
 * @returns {{ getGrid: () => number[][] }}
 */
export function renderGrid(container, gridData, options = {}) {
  container.innerHTML = '';
  container.classList.add('grid-container');

  const rows = gridData.length;
  const cols = gridData[0].length;
  const grid = gridData.map(row => [...row]);

  for (let r = 0; r < rows; r++) {
    const rowEl = document.createElement('div');
    rowEl.classList.add('grid-row');

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.classList.add('grid-cell', `color-${grid[r][c]}`);
      cell.dataset.row = r;
      cell.dataset.col = c;
      if (options.editable) cell.classList.add('editable');
      rowEl.appendChild(cell);
    }

    container.appendChild(rowEl);
  }

  if (options.editable) {
    let painting = false;

    function paintCell(cell) {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      const color = options.selectedColor ? options.selectedColor() : 0;
      grid[r][c] = color;
      cell.className = `grid-cell editable color-${color}`;
      if (options.onChange) options.onChange(r, c, color);
    }

    container.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.grid-cell');
      if (!cell) return;
      e.preventDefault();
      painting = true;
      paintCell(cell);
    });

    container.addEventListener('mouseover', (e) => {
      if (!painting) return;
      const cell = e.target.closest('.grid-cell');
      if (cell) paintCell(cell);
    });

    const stopPainting = () => { painting = false; };
    document.addEventListener('mouseup', stopPainting);

    // Store cleanup ref on the container for potential teardown
    container._gridCleanup = () => {
      document.removeEventListener('mouseup', stopPainting);
    };
  }

  return { getGrid: () => grid.map(row => [...row]) };
}

/**
 * Create a color picker.
 * @param {HTMLElement} container
 * @param {number} [initialColor=1]
 * @returns {{ getColor: () => number }}
 */
export function createColorPicker(container, initialColor = 1) {
  container.innerHTML = '';
  container.classList.add('color-picker');

  let selectedColor = initialColor;

  for (let i = 0; i <= 9; i++) {
    const swatch = document.createElement('div');
    swatch.classList.add('color-swatch', `color-${i}`);
    if (i === selectedColor) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      container.querySelector('.selected')?.classList.remove('selected');
      swatch.classList.add('selected');
      selectedColor = i;
    });

    container.appendChild(swatch);
  }

  return { getColor: () => selectedColor };
}

/**
 * Render a training pair (input -> output) side by side.
 * @param {HTMLElement} container
 * @param {{ input: number[][], output: number[][] }} pair
 */
export function renderTrainingPair(container, pair) {
  container.innerHTML = '';
  container.classList.add('training-pair');

  const inputEl = document.createElement('div');
  renderGrid(inputEl, pair.input);

  const arrow = document.createElement('div');
  arrow.classList.add('arrow');
  arrow.textContent = '\u2192';

  const outputEl = document.createElement('div');
  renderGrid(outputEl, pair.output);

  container.appendChild(inputEl);
  container.appendChild(arrow);
  container.appendChild(outputEl);
}
