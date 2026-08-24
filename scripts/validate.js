// Validation script — checks project integrity without launching Electron.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('package.json parses', Boolean(pkg.name && pkg.version && pkg.main));
check('main entry exists', fs.existsSync(path.join(root, pkg.main)));
check('electron-builder config present', Boolean(pkg.build && pkg.build.win));
check('appId set', Boolean(pkg.build && pkg.build.appId));

const cfg = require('../src/config');
check('config has PROD_ORIGIN', /^https:\/\/to-do-tasks\.maximo-seo\.ai$/.test(cfg.PROD_ORIGIN));
check('config ALLOWED_HOSTS non-empty', Array.isArray(cfg.ALLOWED_HOSTS) && cfg.ALLOWED_HOSTS.length > 0);
check('no http:// in config', !JSON.stringify(cfg).includes('http://'));

// main.js must parse
const src = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
check('main.js requires electron', src.includes("require('electron')"));
check('navigation lockdown present', src.includes('setWindowOpenHandler') && src.includes('will-navigate'));
check('no nodeIntegration:true', !src.includes('nodeIntegration: true'));
check('contextIsolation:true', src.includes('contextIsolation: true'));
check('AppUserModelId set (Windows toasts)', src.includes('setAppUserModelId'));
try {
  new Function(src.replace(/require\([^)]+\)/g, '({})'));
  check('main.js syntactically valid', true);
} catch (e) {
  check('main.js syntactically valid', false, e.message);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed.');
