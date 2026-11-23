// 社区创作模板只提供需求数据和源码快照，不能配置平台工具、密钥或模型端点。
import type { GameSpec, GenerationMode } from './spec.ts';

export type TemplateParameter =
  | { id: string; label: string; type: 'number'; min: number; max: number; default: number }
  | { id: string; label: string; type: 'choice'; choices: string[]; default: string };

export interface TemplateAttribution {
  templateId: string;
  title: string;
  authorName: string;
  versionLabel: string;
  license: 'MIT';
}

export interface TemplateOrigin {
  templateId: string;
  title: string;
  versionLabel: string;
  parameters: Record<string, string | number>;
  attributions: TemplateAttribution[];
}

export interface CreationTemplate {
  id: string;
  ownerToken: string;
  title: string;
  description: string;
  prompt: string;
  parameters: TemplateParameter[];
  license: 'MIT';
  versionLabel: string;
  authorName: string;
  official: boolean;
  published: boolean;
  sourceVersionNote: string;
  spec: GameSpec;
  html: string;
  generationMode: GenerationMode;
  verification: 'browser-smoke' | 'template-render' | 'unverified';
  attributions: TemplateAttribution[];
  createdAt: string;
}

export type CreationTemplatePublic = Omit<CreationTemplate, 'ownerToken' | 'html'> & { owned: boolean };

export interface CreationTemplateFilter {
  q?: string;
  kind?: 'official' | 'community';
  ownerToken?: string;
  limit: number;
  offset: number;
}

function invalid(message: string): never {
  throw { status: 400, code: 'invalid_template', message };
}

export function templateText(raw: unknown, label: string, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) {
    invalid(label + ' 必须为 1–' + max + ' 字符的文本');
  }
  return raw.trim();
}

export function parseParameters(raw: unknown): TemplateParameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 6) invalid('最多设置 6 个可调参数');
  const ids = new Set<string>();
  return raw.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('参数格式错误');
    const p = value as Record<string, unknown>;
    const id = templateText(p.id, '参数标识', 32);
    if (!/^[a-z][a-z0-9_]*$/.test(id) || ['constructor', 'prototype'].includes(id) || ids.has(id)) invalid('参数标识重复或不合法');
    ids.add(id);
    const label = templateText(p.label, '参数名称', 24);
    if (p.type === 'number') {
      const { min, max, default: value } = p;
      if (typeof min !== 'number' || typeof max !== 'number' || typeof value !== 'number' ||
          ![min, max, value].every(Number.isInteger) || min < 0 || max > 10000 || min >= max || value < min || value > max) {
        invalid('数字参数必须为 0–10000 范围内的整数，默认值须在最小值与最大值之间');
      }
      return { id, label, type: 'number', min, max, default: value };
    }
    if (p.type === 'choice') {
      if (!Array.isArray(p.choices) || p.choices.length < 2 || p.choices.length > 8) invalid('每个下拉参数需要 2–8 个选项');
      const choices = p.choices.map((c) => templateText(c, '选项', 40));
      if (new Set(choices).size !== choices.length || !choices.includes(p.default as string)) invalid('选项不能重复，默认值必须属于选项');
      return { id, label, type: 'choice', choices, default: p.default as string };
    }
    return invalid('参数类型只能为 number 或 choice');
  });
}

export function compileTemplatePrompt(
  template: Pick<CreationTemplate, 'prompt' | 'parameters'>,
  rawValues: unknown,
  extraPrompt = '',
): { prompt: string; values: Record<string, string | number> } {
  if (rawValues !== undefined && (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues))) invalid('参数取值必须为对象');
  const supplied = (rawValues || {}) as Record<string, unknown>;
  if (Object.keys(supplied).some((key) => !template.parameters.some((p) => p.id === key))) invalid('包含模板未声明的参数');
  const values: Record<string, string | number> = {};
  for (const p of template.parameters) {
    const value = Object.hasOwn(supplied, p.id) ? supplied[p.id] : p.default;
    if (p.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < p.min || value > p.max) invalid(p.label + ' 超出允许范围');
    } else if (typeof value !== 'string' || !p.choices.includes(value)) invalid(p.label + ' 不在允许选项中');
    values[p.id] = value as string | number;
  }
  const rendered = template.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) invalid('需求模板引用了未声明参数：' + key);
    return String(values[key]);
  });
  const selections = template.parameters.map((p) => p.label + '：' + values[p.id]).join('；');
  const prompt = rendered + (selections ? '\n本次选择：' + selections : '') + (extraPrompt ? '\n用户补充需求：' + extraPrompt : '');
  if (prompt.length > 2000) invalid('组合后的需求超过 2000 字符，请缩短模板或补充需求');
  return { prompt, values };
}

export function mitLicense(authorName: string): string {
  return `MIT License\n\nCopyright (c) ${authorName}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.\n`;
}

export function retainAttributions(html: string, origin?: TemplateOrigin): string {
  if (!origin) return html;
  const text = origin.attributions.map((a) => a.title + ' / ' + a.versionLabel + ' / ' + a.authorName + ' / ' + a.templateId).join('\n') +
    '\n\n' + mitLicense([...new Set(origin.attributions.map((a) => a.authorName))].join(', '));
  // 署名作为注释保存到单文件交付物中，防止标题中的注释闭合符形成代码。
  const notice = '<!-- MYOLGAME_ATTRIBUTION\n' + text.replace(/--/g, '—').replace(/>/g, '&gt;') + '-->';
  const clean = html.replace(/\n?<!-- MYOLGAME_ATTRIBUTION[\s\S]*?-->/g, '');
  return clean.replace(/<!doctype html>/i, '<!doctype html>\n' + notice);
}
