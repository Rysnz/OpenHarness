/**
 * Git Graph MiniApp build: concatenate source parts into the importable bundle.
 * Run from the app root: node source/build.js
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname);
const ROOT = path.dirname(SOURCE_DIR);
const UI_PARTS_DIR = path.join(ROOT, 'parts-ui');
const STYLE_PARTS_DIR = path.join(ROOT, 'parts-styles');

const UI_ORDER = [
  'state.js',
  'theme.js',
  'graph/layout.js',
  'graph/renderRowSvg.js',
  'services/gitClient.js',
  'components/contextMenu.js',
  'components/modal.js',
  'components/findWidget.js',
  'panels/remotePanel.js',
  'panels/detailPanel.js',
  'main.js',
  'bootstrap.js',
];

const STYLES_ORDER = [
  'tokens.css',
  'layout.css',
  'graph.css',
  'detail-panel.css',
  'overlay.css',
];

function concat(files, dir) {
  let out = '';
  for (const fileName of files) {
    const fullPath = path.join(dir, fileName);
    if (!fs.existsSync(fullPath)) {
      console.warn('Missing:', fullPath);
      continue;
    }
    out += '/* ' + fileName + ' */\n' + fs.readFileSync(fullPath, 'utf8') + '\n';
  }
  return out;
}

const uiOut = path.join(SOURCE_DIR, 'ui.js');
const styleOut = path.join(SOURCE_DIR, 'style.css');

fs.writeFileSync(uiOut, concat(UI_ORDER, UI_PARTS_DIR), 'utf8');
fs.writeFileSync(styleOut, concat(STYLES_ORDER, STYLE_PARTS_DIR), 'utf8');

console.log('Built', uiOut, 'and', styleOut);
