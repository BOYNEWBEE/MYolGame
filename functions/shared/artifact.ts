// 预览与浏览器检查使用同一限制；生成代码只能在无同源权限的页面中执行。
export const GAME_RESOURCE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
export const GAME_CSP = 'sandbox allow-scripts; ' + GAME_RESOURCE_CSP;
export const MAX_ARTIFACT_BYTES = 512 * 1024;

export function embedGamePolicy(html: string): string {
  // srcDoc 和下载文件不会继承 HTTP 响应头；在任何生成内容前插入资源限制。
  const prefix = '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + GAME_RESOURCE_CSP + '">\n';
  return html.startsWith(prefix) ? html : prefix + html.replace(/<!doctype html>/i, '');
}

export function validateArtifact(html: string): void {
  if (new TextEncoder().encode(html).length > MAX_ARTIFACT_BYTES ||
      !/<!doctype html>/i.test(html) || !/<canvas\b/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('产物必须为不超过 512 KiB 的完整单文件 Canvas HTML 游戏');
  }
}
