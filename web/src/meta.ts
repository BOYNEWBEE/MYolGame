// 平台元信息（模板目录、主题、生成模式标记）只拉取一次并缓存。

import { useEffect, useState } from 'react';
import { requestJson } from './api.ts';
import type { TemplateMeta, ThemeId, Palette, Difficulty } from '@shared/spec.ts';

export interface MetaInfo {
  siteName: string;
  generationMode: 'template' | 'model' | 'agent';
  agent: {
    configured: boolean;
    name: string | null;
    provider: string | null;
    model: string | null;
    sourceDevelopment: boolean;
    accountModelConfig: boolean;
  };
  model: { configured: boolean; name: string | null };
  identityNotice: string;
  templates: TemplateMeta[];
  themes: { id: ThemeId; name: string; palette: Palette }[];
  difficulties: { id: Difficulty; name: string }[];
  limits: { promptMaxLength: number; descriptionMaxLength: number };
}

let cached: MetaInfo | null = null;
let inflight: Promise<MetaInfo> | null = null;

export function fetchMeta(): Promise<MetaInfo> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = requestJson<MetaInfo>('/meta', { auth: false })
      .then((meta) => {
        cached = meta;
        return meta;
      })
      .catch((error) => {
        inflight = null;
        throw error;
      });
  }
  return inflight;
}

export function useMeta(): { meta: MetaInfo | null; error: string | null } {
  const [meta, setMeta] = useState<MetaInfo | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMeta()
      .then((result) => {
        if (!cancelled) setMeta(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '元信息加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { meta, error };
}
