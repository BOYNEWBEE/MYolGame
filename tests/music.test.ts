import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGame } from '../functions/generate.ts';
import { MAX_MUSIC_PROMPT, defaultSpec, sanitizeSpec, type GameSpec } from '../functions/shared/spec.ts';

function baseSpec(): GameSpec {
  return defaultSpec('breakout', 'neon');
}

describe('浏览器合成配乐规格', () => {
  test('只接受内置合成配乐，旧 AI 配乐迁移为霓虹街机', () => {
    assert.equal(sanitizeSpec({ ...baseSpec(), music: 'neon-arcade' }).music, 'neon-arcade');
    assert.equal(sanitizeSpec({ ...baseSpec(), music: 'ai-arranged' }).music, 'ai-arranged');
    assert.equal(sanitizeSpec({ ...baseSpec(), music: 'none' }).music, 'none');
    assert.equal(sanitizeSpec({ ...baseSpec(), music: 'ai-generated' }).music, 'neon-arcade');
    assert.equal(
      sanitizeSpec({ ...baseSpec(), music: 'unknown' }, { ...baseSpec(), music: 'ai-arranged' }).music,
      'ai-arranged',
    );
  });

  test('配乐提示词被清理、保留并在显式清空时移除', () => {
    const saved = sanitizeSpec({ ...baseSpec(), musicPrompt: '  温柔\n钢琴   与雨声  ' });
    assert.equal(saved.musicPrompt, '温柔 钢琴 与雨声');
    assert.equal(sanitizeSpec({ ...baseSpec() }, saved).musicPrompt, '温柔 钢琴 与雨声');
    assert.equal(sanitizeSpec({ ...baseSpec(), musicPrompt: '' }, saved).musicPrompt, undefined);
    assert.equal(sanitizeSpec({ ...baseSpec(), musicPrompt: '音'.repeat(400) }).musicPrompt?.length, MAX_MUSIC_PROMPT);
  });

  test('生成的 HTML 使用内置合成器，不依赖外部音频', async () => {
    const result = await generateGame({
      prompt: '霓虹打砖块',
      baseSpec: { ...baseSpec(), music: 'ai-arranged' },
      env: {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.spec.music, 'ai-arranged');
    assert.ok(result.html.includes('createArcadeAudio('));
    assert.ok(!result.html.includes('music-track'));
    assert.ok(!result.html.includes('data:audio/'));
  });
});
