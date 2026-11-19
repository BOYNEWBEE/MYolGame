// 模型只返回源码修改片段，由服务端逐条应用到当前源码并校验结果。
// find 必须与源码逐字一致且全文唯一，避免模型输出整份 HTML 触发长度截断。

import { MAX_ARTIFACT_BYTES } from '../../functions/shared/artifact.ts';

export interface SourceEdit {
  find: string;
  replace: string;
}

export class SourceEditError extends Error {
  readonly code = 'invalid_edit';
}

const MAX_EDITS = 64;

function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```([^\r\n]*)\r?\n?([\s\S]*?)```/g;
  for (;;) {
    const match = fence.exec(text);
    if (!match) break;
    if (match[2]) blocks.push(match[2]);
  }
  return blocks;
}

function asEditList(value: unknown): SourceEdit[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as { edits?: unknown }).edits;
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > MAX_EDITS) {
    throw new SourceEditError('edits 必须包含 1–' + MAX_EDITS + ' 条修改');
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SourceEditError('第 ' + (index + 1) + ' 条修改格式不正确');
    }
    const { find, replace } = item as { find?: unknown; replace?: unknown };
    if (typeof find !== 'string' || find.length === 0) {
      throw new SourceEditError('第 ' + (index + 1) + ' 条修改缺少非空 find');
    }
    if (typeof replace !== 'string') {
      throw new SourceEditError('第 ' + (index + 1) + ' 条修改缺少字符串 replace');
    }
    if (find === replace) {
      throw new SourceEditError('第 ' + (index + 1) + ' 条修改没有产生任何变化');
    }
    return { find, replace };
  });
}

function tryParse(candidate: string): SourceEdit[] | null {
  let value: unknown;
  try {
    value = JSON.parse(candidate.trim());
  } catch {
    return null;
  }
  return asEditList(value);
}

// 解析模型输出中的修改片段；不是修改 JSON 时返回 null，由调用方按完整 HTML 兜底。
export function parseSourceEdits(output: string): SourceEdit[] | null {
  const text = output.replace(/^\uFEFF/, '').trim();
  for (const candidate of [text, ...fencedBlocks(text)]) {
    const edits = tryParse(candidate);
    if (edits) return edits;
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const edits = tryParse(text.slice(start, end + 1));
    if (edits) return edits;
  }
  // 明显想返回修改 JSON 但无法解析时给出可修复的反馈，而不是误当成完整 HTML。
  if (/"edits"\s*:/.test(text) || /^[{[]/.test(text)) {
    throw new SourceEditError('模型返回的修改 JSON 无法解析，必须为 {"edits":[...]}');
  }
  return null;
}

export function applySourceEdits(source: string, edits: SourceEdit[]): string {
  let result = source;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]!;
    const first = result.indexOf(edit.find);
    if (first < 0) {
      throw new SourceEditError(
        '第 ' + (index + 1) + ' 条修改的 find 未在源码中找到，请逐字复制源码中唯一存在的片段',
      );
    }
    if (result.indexOf(edit.find, first + 1) >= 0) {
      throw new SourceEditError(
        '第 ' + (index + 1) + ' 条修改的 find 在源码中出现多次，请扩大 find 范围使其唯一',
      );
    }
    result = result.slice(0, first) + edit.replace + result.slice(first + edit.find.length);
  }
  if (result === source) {
    throw new SourceEditError('修改没有产生任何源码变化');
  }
  if (new TextEncoder().encode(result).length > MAX_ARTIFACT_BYTES) {
    throw new SourceEditError('修改后的源码超过 512 KiB 限制');
  }
  if (!/<!doctype html>/i.test(result) || !/<\/html>/i.test(result)) {
    throw new SourceEditError('修改后不再是完整的 HTML 文档，不能删除 doctype 或 </html>');
  }
  return result;
}