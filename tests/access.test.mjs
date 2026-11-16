import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAccess } from '../server/access.mjs';
test('remote access permits only configured HTTPS origins and keeps localhost', () => {
  const access = allowedAccess(8190, 'https://workstation.example.com:8190');
  assert.ok(access.origins.has('https://workstation.example.com:8190'));
  assert.ok(access.hosts.has('workstation.example.com:8190'));
  assert.ok(access.hosts.has('127.0.0.1:8190'));
  assert.ok(!access.hosts.has('attacker.example.com'));
  assert.ok(!access.origins.has('http://workstation.example.com:8190'));
  assert.throws(() => allowedAccess(8190, 'https://user:password@example.com'));
  assert.throws(() => allowedAccess(8190, 'https://example.com/path'));
});
