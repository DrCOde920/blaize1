import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSITIVE_CONTROL_PATTERN,
  SENSITIVE_WINDOW_PATTERN,
  isSensitiveAccessibleValue,
} from './privacy_detector';

test('known protected apps and sensitive field labels are recognized locally', () => {
  assert.equal(SENSITIVE_WINDOW_PATTERN.test('Bitwarden Password Manager'), true);
  assert.equal(SENSITIVE_WINDOW_PATTERN.test('Banking - Online Account'), true);
  assert.equal(SENSITIVE_WINDOW_PATTERN.test('Plain text editor'), false);
  assert.equal(SENSITIVE_CONTROL_PATTERN.test('One-time verification code'), true);
  assert.equal(SENSITIVE_CONTROL_PATTERN.test('Search files'), false);
});

test('common sensitive values are recognized without a model or network call', () => {
  assert.equal(isSensitiveAccessibleValue('person@example.com'), true);
  assert.equal(isSensitiveAccessibleValue('4111 1111 1111 1111'), true);
  assert.equal(isSensitiveAccessibleValue('123-45-6789'), true);
  assert.equal(isSensitiveAccessibleValue('+1 (415) 555-0199'), true);
  assert.equal(isSensitiveAccessibleValue('GB29NWBK60161331926819'), true);
  assert.equal(isSensitiveAccessibleValue('sk_live_0123456789abcdefghijkl'), true);
  assert.equal(isSensitiveAccessibleValue('Quarterly revenue summary'), false);
  assert.equal(isSensitiveAccessibleValue(null), false);
});
