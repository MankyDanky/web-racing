// Unit tests for shared sanitizers (#30, #32). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePlayerName, sanitizePlayerColor, sanitizeTrackId,
  sanitizeFinishTime, sanitizePeerId,
} from '../src/modules/sanitize.js';

test('sanitizePlayerName strips control chars and caps length', () => {
  assert.equal(sanitizePlayerName('Alice'), 'Alice');
  assert.equal(sanitizePlayerName('  spaced  '), 'spaced');
  assert.equal(sanitizePlayerName('x'.repeat(50)).length, 15);
  assert.equal(sanitizePlayerName('\u0000\u001f'), 'Player');
  assert.equal(sanitizePlayerName(123), 'Player');
  assert.equal(sanitizePlayerName('', 'Guest'), 'Guest');
});

test('sanitizePlayerColor whitelists palette', () => {
  assert.equal(sanitizePlayerColor('blue'), 'blue');
  assert.equal(sanitizePlayerColor('violet'), 'violet');
  assert.equal(sanitizePlayerColor('hotpink'), 'red');
  assert.equal(sanitizePlayerColor('../../etc'), 'red');
});

test('sanitizeTrackId whitelists shipped maps', () => {
  assert.equal(sanitizeTrackId('map1'), 'map1');
  assert.equal(sanitizeTrackId('map2'), 'map2');
  assert.equal(sanitizeTrackId('../secret'), 'map1');
});

test('sanitizeFinishTime accepts MM:SS only', () => {
  assert.equal(sanitizeFinishTime('01:23'), '01:23');
  assert.equal(sanitizeFinishTime('1:99'), null);
  assert.equal(sanitizeFinishTime('nope'), null);
});

test('sanitizePeerId enforces shape', () => {
  assert.equal(sanitizePeerId('racez-abc-123'), 'racez-abc-123');
  assert.equal(sanitizePeerId('bad id!'), null);
  assert.equal(sanitizePeerId('xx'), null); // too short
});
