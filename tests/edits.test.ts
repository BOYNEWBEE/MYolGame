// 修改片段协议：只接受唯一锚点，逐条应用并保证结果仍是完整 HTML。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceEditError, applySourceEdits, parseSourceEdits } from '../dev/agent/edits.ts';

const doc = '<!doctype html><html><body><h1>标题</h1><canvas></canvas><script>let lives=3;</script></body></html>';

function editError(action: () => unknown): SourceEditError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof SourceEditError, '必须抛出 SourceEditError');
    return error;
  }
  throw new Error('预期抛出 SourceEditError');
}

test('解析纯 JSON、代码块 JSON，完整 HTML 返回 null', () => {
  const payload = '{"edits":[{"find":"lives=3","replace":"lives=5"}]}';
  assert.deepEqual(parseSourceEdits(payload), [{ find: 'lives=3', replace: 'lives=5' }]);
  assert.deepEqual(
    parseSourceEdits('说明文字\n```json\n' + payload + '\n```\n'),
    [{ find: 'lives=3', replace: 'lives=5' }],
  );
  assert.equal(parseSourceEdits(doc), null, '完整 HTML 应走旧格式兜底');
  const broken = editError(() => parseSourceEdits('{"edits":['));
  assert.equal(broken.code, 'invalid_edit');
  assert.match(broken.message, /无法解析/);
});

test('按顺序应用多条修改，插入与删除都以唯一锚点为准', () => {
  const result = applySourceEdits(doc, [
    { find: '<h1>标题</h1>', replace: '<h1>新标题</h1><p>得分：0</p>' },
    { find: 'let lives=3;', replace: 'let lives=5;let score=0;' },
  ]);
  assert.match(result, /<h1>新标题<\/h1><p>得分：0<\/p>/);
  assert.match(result, /let lives=5;let score=0;/);
  assert.doesNotMatch(result, /lives=3/);
  assert.ok(result.startsWith('<!doctype html>') && result.endsWith('</html>'));
});

test('锚点缺失、重复、无效条目与破坏文档都会被拒绝', () => {
  const missing = editError(() => applySourceEdits(doc, [{ find: '不存在', replace: 'x' }]));
  assert.match(missing.message, /未在源码中找到/);
  const repeated = editError(() => applySourceEdits('ab ab', [{ find: 'ab', replace: 'x' }]));
  assert.match(repeated.message, /出现多次/);
  const empty = editError(() => parseSourceEdits('{"edits":[]}'));
  assert.match(empty.message, /1–64/);
  const noop = editError(() => parseSourceEdits('{"edits":[{"find":"a","replace":"a"}]}'));
  assert.match(noop.message, /没有产生任何变化/);
  const broken = editError(() => applySourceEdits(doc, [{ find: '</html>', replace: '' }]));
  assert.match(broken.message, /不再是完整/);
});

test('修改结果超过 512 KiB 被拒绝', () => {
  const oversized = '<!doctype html><html><canvas></canvas>' + 'x'.repeat(512 * 1024) + '</html>';
  const error = editError(() => applySourceEdits(doc, [{ find: '<canvas></canvas>', replace: oversized.slice(31, -7) }]));
  assert.match(error.message, /512 KiB/);
});