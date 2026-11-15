import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAccess } from '../server/access.mjs';
test('remote access permits only configured HTTPS origins and keeps localhost', () => {
  const access = allowedAccess(4317, 'https://workstation.example.com:8462');
  assert.ok(access.origins.has('https://workstation.example.com:8462'));
  assert.ok(access.hosts.has('workstation.example.com:8462'));
  assert.ok(access.hosts.has('127.0.0.1:4317'));
  assert.ok(!access.hosts.has('attacker.example.com'));
  assert.ok(!access.origins.has('http://workstation.example.com:8462'));
  assert.throws(() => allowedAccess(4317, 'https://user:password@example.com'));
  assert.throws(() => allowedAccess(4317, 'https://example.com/path'));
});
