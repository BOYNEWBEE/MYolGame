// 发布前检查函数源码依赖和公开产物，不读取运行数据或密钥。
import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
const root = resolve('functions');
async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === '_qoder' || entry.name === 'node_modules' || entry.isSymbolicLink()) throw new Error('函数包包含不允许的注入目录或链接');
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (!path.endsWith('.ts') && !path.endsWith('.mjs')) throw new Error('函数目录中包含非源码文件');
    const source = await readFile(path, 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)].map(m => m[2]!);
    for (const specifier of imports) {
      if (specifier === './_qoder/backend.mjs' && path === join(root, 'index.ts')) continue;
      if (!specifier.startsWith('.')) throw new Error('函数依赖必须为本包内相对模块');
      const target = resolve(dirname(path), specifier);
      // 用相对路径判断，避免 Windows 反斜杠路径被误判为越界。
      const inside = relative(root, target);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('函数依赖越出上传目录');
      await access(target);
    }
  }
}
await inspect(root);
await access('web/dist/index.html');
for (const entry of await readdir('web/dist', { recursive: true })) {
  if (typeof entry === 'string' && /(?:\.map$|\.env|db\.json|\.pem$)/.test(entry)) throw new Error('公开目录中包含不应发布的文件');
}
console.log('云端包静态检查通过：functions/ 相对依赖完整，公开入口为 web/dist/。平台 SDK、迁移和公网运行仍需远端验收。');
