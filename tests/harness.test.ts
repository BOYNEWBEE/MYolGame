import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node:test 能直接运行 TypeScript', () => {
  const x: number = 1;
  assert.equal(x, 1);
});
