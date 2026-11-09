// 源码包构建：把某个版本打包为可下载的 ZIP（游戏 HTML + 规格 + 说明）。

import { createZip, type ZipEntry } from './zip.ts';
import { DIFFICULTIES, getTemplate, getTheme, type GameSpec, type GenerationMode } from './spec.ts';

export interface SourcePackageInput {
  spec: GameSpec;
  html: string;
  mode: GenerationMode;
  versionNote: string;
  createdAt: string;
}

export function buildSourcePackage(input: SourcePackageInput): Uint8Array {
  const { spec, html, mode, versionNote, createdAt } = input;
  const template = getTemplate(spec.template);
  const theme = getTheme(spec.theme);
  const difficulty = DIFFICULTIES.find((d) => d.id === spec.difficulty)?.name ?? spec.difficulty;
  const optionNames = template.options
    .filter((o) => spec.options[o.key])
    .map((o) => o.name);

  const readme = `# ${spec.title}

由 MYolGame 平台生成（生成方式：${mode === 'agent' ? 'Agent 源码开发（浏览器烟测通过，具体玩法需人工试玩确认）' : mode === 'model' ? '真实模型辅助（结果仍限于内置模板与规格白名单）' : '模板生成，非任意 AI 创作'}）。

- 玩法模板：${template.name}
- 主题：${theme.name}
- 难度：${difficulty}
- 速度倍率：${spec.speed}
- 可选玩法：${optionNames.length > 0 ? optionNames.join('、') : '无'}
- 版本说明：${versionNote || '（无）'}
- 生成时间：${createdAt}

## 运行方式

本游戏为单文件 HTML5 游戏（\`index.html\`），无外部依赖、无网络请求：

1. 通过任意静态 HTTP 服务托管本目录后在浏览器打开；
2. 或直接双击 \`index.html\` 在本地浏览器游玩。

## 操作说明

${mode === 'agent' ? '请查看 index.html 游戏页面中的操作说明。' : template.controls}

## 说明与限制

${mode === 'agent' ? '- 游戏源码由 Agent 开发，spec.json 仅记录起始模板与元信息，重新渲染模板不能恢复此版本；请保留 index.html；' : '- 游戏代码来自 MYolGame 内置固定模板，配置由生成规格决定；'}
- \`spec.json\` 记录规格或起始元信息；Agent 版本的真实玩法以 HTML 源码为准；
${mode === 'agent' ? '- 本包不包含平台源码；使用和分发前请自行确认生成内容及素材的许可。' : '- 本包不包含平台源码；模板代码以 MIT 许可提供。'}
`;

  const entries: ZipEntry[] = [
    { name: 'index.html', content: html },
    { name: 'README.md', content: readme },
    { name: 'spec.json', content: JSON.stringify(spec, null, 2) + '\n' },
    ...(mode === 'agent' ? [] : [{ name: 'LICENSE', content: 'MIT License\n\nCopyright (c) 2026 MYolGame creators\n\n游戏模板代码以 MIT 许可发布。\n' }]),
  ];
  return createZip(entries);
}
