import test from 'node:test';
import assert from 'node:assert/strict';
import { OneTimeActionApprovalVault } from './action_approval';

test('one-time approval is bound to sender and exact action and cannot be replayed', () => {
  const vault = new OneTimeActionApprovalVault();
  vault.issue('token-1', { senderId: 7, actionDigest: 'digest-a', expiresAtMs: 2_000 });
  assert.equal(vault.consume('token-1', 8, 'digest-a', 1_000), false, 'another renderer cannot use the token');
  assert.equal(vault.consume('token-1', 7, 'digest-a', 1_000), false, 'mismatched attempt consumes the token');
  assert.equal(vault.size, 0);

  vault.issue('token-2', { senderId: 7, actionDigest: 'digest-a', expiresAtMs: 2_000 });
  assert.equal(vault.consume('token-2', 7, 'digest-b', 1_000), false, 'approval cannot be transferred to a different action');

  vault.issue('token-3', { senderId: 7, actionDigest: 'digest-a', expiresAtMs: 2_000 });
  assert.equal(vault.consume('token-3', 7, 'digest-a', 2_001), false, 'expired approvals are rejected');

  vault.issue('token-4', { senderId: 7, actionDigest: 'digest-a', expiresAtMs: 2_000 });
  assert.equal(vault.consume('token-4', 7, 'digest-a', 1_999), true);
  assert.equal(vault.consume('token-4', 7, 'digest-a', 1_999), false, 'successful approval is one-use');
});
