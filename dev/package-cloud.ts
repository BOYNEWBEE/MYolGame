// 生成可复现的部署输入备份；Qoder 正式草稿仍须由平台 prepare_site 创建。
import { mkdir, readdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createZip, type ZipEntry } from '../functions/shared/zip.ts';

const output = '.runtime/m0-release';
const entries: ZipEntry[] = [];
async function add(source: string, name: string) {
  if ((await lstat(source)).isSymbolicLink()) throw new Error('不允许把符号链接加入部署输入包');
  const content = await readFile(source);
  entries.push({ name, content });
}
async function collect(source: string, target: string) {
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(source, entry.name), name = target + '/' + entry.name;
    if (entry.isSymbolicLink() || entry.name === '_qoder' || entry.name === 'node_modules') throw new Error('部署输入包含不允许的目录或链接');
    if (entry.isDirectory()) await collect(path, name);
    else await add(path, name);
  }
}
await collect('web/dist', 'web');
await collect('functions', 'functions');
await collect('infra', 'infra');
await add('dev/m0-worker.ts', 'dev/m0-worker.ts');
await add('docs/M0云端部署.md', 'docs/M0云端部署.md');
entries.push({ name: 'README.txt', content: `MYolGame 云端 M0 部署输入包\n\n这不是 Qoder 已准备的草稿或已发布站点。\n使用原工程目录中的 Qoder 会话完成正式 prepare_site 和发布。\n本目录 web/ 是静态产物，functions/ 是函数源码；infra/ 是待审阅迁移。\nAPP_ORIGIN 和 APP_M0_WORKER_KEY 仅通过安全配置提供，本包不包含其值。\n独立调度部署位置待定；在已配置环境的云端 Node 22.18+ 服务中可执行 node dev/m0-worker.ts。\n完整步骤见 docs/M0云端部署.md。不得把本目录整体作为公开网页目录。\n` });
entries.sort((a, b) => a.name.localeCompare(b.name));
entries.push({ name: 'SHA256SUMS', content: entries.map(entry => createHash('sha256').update(entry.content).digest('hex') + '  ' + entry.name).join('\n') + '\n' });
// 输出路径为程序固定目录，只清理本工具上次生成的产物。
await rm(output, { recursive: true, force: true });
for (const entry of entries) {
  const path = join(output, entry.name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, entry.content);
}
await writeFile('.runtime/myolgame-m0-qoder-inputs.zip', createZip(entries));
console.log('已生成部署输入目录：' + relative(process.cwd(), output));
console.log('已生成归档：.runtime/myolgame-m0-qoder-inputs.zip（此打包命令不执行远端迁移或发布）');
