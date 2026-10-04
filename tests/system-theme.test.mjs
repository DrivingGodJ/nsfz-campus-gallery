import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import postcss from 'postcss';
import { createSystemThemeStore, mapColorForTheme } from '../src/theme.ts';

class Preference extends EventTarget {
  matches = false;
  change(dark) { this.matches = dark; this.dispatchEvent(new Event('change')); }
}

test('system theme starts with the current preference and follows both directions without reload', () => {
  const preference = new Preference();
  preference.matches = true;
  const store = createSystemThemeStore(preference);
  assert.equal(store.getSnapshot(), 'dark');
  const changes = [];
  const unsubscribe = store.subscribe(() => changes.push(store.getSnapshot()));
  preference.change(false);
  preference.change(true);
  assert.deepEqual(changes, ['light', 'dark']);
  unsubscribe();
  preference.change(false);
  assert.deepEqual(changes, ['light', 'dark'], 'The removed listener must not receive updates');
  assert.equal(store.getSnapshot(), 'light', 'Snapshots remain current even without a listener');
});

test('theme store handles unsupported environments and changes before subscription', () => {
  const fallback = createSystemThemeStore(null);
  assert.equal(fallback.getSnapshot(), 'light');
  assert.equal(fallback.getServerSnapshot(), 'light');
  fallback.subscribe(() => assert.fail('No media query means no event'))();
  const preference = new Preference();
  const store = createSystemThemeStore(preference);
  preference.change(true);
  assert.equal(store.getSnapshot(), 'dark');
  const notifications = [];
  const stop1 = store.subscribe(() => notifications.push(1));
  const stop2 = store.subscribe(() => notifications.push(2));
  preference.change(false);
  stop1();
  preference.change(true);
  stop2();
  assert.deepEqual(notifications, [1, 2, 2]);
});

function contrast(a, b) {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).slice(0, 3).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('night UI text, selected controls, notices and court lines remain legible', async () => {
  const css = postcss.parse(await fs.readFile(new URL('../src/styles.css', import.meta.url), 'utf8'));
  const tokens = {};
  css.walkAtRules('media', rule => {
    if (rule.params !== '(prefers-color-scheme:dark)') return;
    rule.walkDecls(decl => { tokens[decl.prop] = decl.value; });
  });
  for (const [fg, bg] of [
    ['--ink', '--paper'], ['--muted', '--paper'], ['--text', '--field'], ['--muted-text', '--surface-muted'],
    ['--on-primary', '--green'], ['--active-text', '--active-surface'], ['--success-text', '--success-surface'],
    ['--warn-text', '--warn-surface'], ['--danger-text', '--danger-surface'], ['--on-handle', '--handle'],
  ]) assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg} on ${bg} should be readable at small sizes`);
  for (const court of ['#80a093', '#78998a']) assert.ok(contrast(mapColorForTheme('dark', '#f0eedb'), mapColorForTheme('dark', court)) >= 3);
  assert.equal(mapColorForTheme('light', '#d7d2c3'), '#d7d2c3');
  assert.notEqual(mapColorForTheme('dark', '#b5cbc7'), mapColorForTheme('light', '#b5cbc7'));
});
