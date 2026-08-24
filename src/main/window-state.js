const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = { width: 1200, height: 800, isMaximized: false };

function loadState(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const state = { ...DEFAULT_STATE };
    if (Number.isFinite(raw.width) && raw.width >= 400) state.width = raw.width;
    if (Number.isFinite(raw.height) && raw.height >= 300) state.height = raw.height;
    if (Number.isFinite(raw.x)) state.x = raw.x;
    if (Number.isFinite(raw.y)) state.y = raw.y;
    if (raw.isMaximized === true) state.isMaximized = true;
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function isVisibleOnSomeDisplay(bounds, displays) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return true;
  return displays.some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width &&
    bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height &&
    bounds.y + bounds.height > workArea.y
  );
}

function trackWindow(win, filePath, delay = 500) {
  let timer = null;
  const persist = () => {
    if (win.isDestroyed()) return;
    saveState(filePath, { ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, delay);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', persist);
}

module.exports = { DEFAULT_STATE, loadState, saveState, isVisibleOnSomeDisplay, trackWindow };
