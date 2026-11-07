// 可选的真实模型接入：仅当服务端配置了 MYOLGAME_MODEL_* 环境变量时启用。
// 未配置时平台始终使用模板模式，并在接口与界面中如实标记 generationMode。
// 安全约束：模型返回的任何内容都必须经过 sanitizeSpec 白名单校验，
// 平台永远不执行模型或用户提供的代码，只允许其调整受限规格。

import { sanitizeSpec, type GameSpec } from './spec.ts';
import { parsePrompt } from './prompt.ts';

export interface ModelEnv {
  apiUrl?: string;
  apiKey?: string;
  name?: string;
}

export interface ModelResult {
  spec: GameSpec;
  modelName: string;
}

export function modelConfigured(env: ModelEnv): boolean {
  return Boolean(env.apiUrl && env.apiKey);
}

export async function modelAdjustSpec(
  prompt: string,
  baseSpec: GameSpec,
  env: ModelEnv,
): Promise<ModelResult | null> {
  if (!modelConfigured(env)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(env.apiUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.apiKey,
      },
      // 只发送提示词与当前规格，不发送任何密钥或用户数据以外的内容
      body: JSON.stringify({
        prompt,
        current_spec: baseSpec,
        instruction:
          '根据用户中文提示词调整游戏规格，返回 JSON：{"spec": {template, title, theme, speed, difficulty, options}}。' +
          'template 仅可为 breakout/snake/space-shooter；theme 仅可为内置主题 id；speed 为 0.5-2.0 数值。',
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('model_http_' + response.status);
    const data = (await response.json()) as { spec?: unknown };
    // 模型输出不可信：先用关键词解析兜底，再用白名单钳制模型结果
    const parsed = parsePrompt(prompt, baseSpec);
    const spec = sanitizeSpec(data.spec ?? parsed.spec, parsed.spec);
    return { spec, modelName: env.name || 'custom-model' };
  } catch (error) {
    // 不向上游泄露原始错误细节
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable';
    throw new Error('model_call_failed:' + reason);
  } finally {
    clearTimeout(timer);
  }
}
