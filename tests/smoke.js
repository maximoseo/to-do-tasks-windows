// Smoke test — validates the shell without launching Electron (CI-safe).
'use strict';
const assert = require('assert');
const path = require('path');

const cfg = require('../src/config');
assert.strictEqual(cfg.PROD_ORIGIN, 'https://to-do-tasks.maximo-seo.ai');
assert.ok(cfg.DASHBOARD_PATH.startsWith('/dashboard'));
assert.ok(cfg.ALLOWED_HOSTS.includes('to-do-tasks.maximo-seo.ai'));
assert.strictEqual(cfg.GITHUB_REPO, 'maximoseo/to-do-tasks-windows');

// URL allowlist logic — replicate the main-process check here.
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return cfg.ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

// Allowed
assert.ok(isAllowedUrl('https://to-do-tasks.maximo-seo.ai/dashboard'));
assert.ok(isAllowedUrl('https://to-do-tasks.maximo-seo.ai/login'));
assert.ok(isAllowedUrl('https://wtpczvyupmavzrxisvcm.supabase.co/auth/v1/token'));
// Blocked
assert.ok(!isAllowedUrl('https://evil.com/phish'));
assert.ok(!isAllowedUrl('http://to-do-tasks.maximo-seo.ai/dashboard')); // http blocked
assert.ok(!isAllowedUrl('javascript:alert(1)'));
assert.ok(!isAllowedUrl('https://evil-to-do-tasks.maximo-seo.ai.example.com/'));
assert.ok(!isAllowedUrl('https://supabase.co/'));

// API key format validation (mirrors main.js)
const keyRe = /^mtk_[A-Za-z0-9_-]{8,}$/;
assert.ok(keyRe.test('mtk_abcd1234_x'));
assert.ok(!keyRe.test('mtk_'));
assert.ok(!keyRe.test('sk-or-v1-abc'));

console.log('smoke test: all assertions passed');
