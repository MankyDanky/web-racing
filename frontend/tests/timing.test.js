// Unit tests for timing helpers (#32, #44). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatTimeMMSS, parseTime, sanitizePreciseTime } from '../src/modules/timing.js';

test('formatTime renders millisecond precision', () => {
  assert.equal(formatTime(0), '0:00.000');
  assert.equal(formatTime(72345), '1:12.345');
  assert.equal(formatTime(5), '0:00.005');
  assert.equal(formatTime(61000), '1:01.000');
});

test('formatTime clamps negatives / NaN', () => {
  assert.equal(formatTime(-100), '0:00.000');
  assert.equal(formatTime(NaN), '0:00.000');
});

test('formatTimeMMSS renders MM:SS', () => {
  assert.equal(formatTimeMMSS(72000), '01:12');
  assert.equal(formatTimeMMSS(0), '00:00');
});

test('parseTime round-trips precise and legacy forms', () => {
  assert.equal(parseTime('1:12.345'), 72345);
  assert.equal(parseTime('01:12'), 72000);
  assert.equal(parseTime('0:00.005'), 5);
  assert.equal(parseTime('garbage'), null);
  assert.equal(parseTime('1:99.000'), null); // invalid seconds
});

test('sanitizePreciseTime normalises and rejects junk', () => {
  assert.equal(sanitizePreciseTime('1:12.345'), '1:12.345');
  assert.equal(sanitizePreciseTime('01:12'), '1:12.000');
  assert.equal(sanitizePreciseTime('<script>'), null);
  assert.equal(sanitizePreciseTime(42), null);
});
