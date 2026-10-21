/**
 * 写日记 + 自动重建索引（一步搞定，不会忘）。
 *
 * 用法：
 *   node diary-add.mjs "今天发生了什么"
 *   node diary-add.mjs --file private "只有自己知道的事"
 *   node diary-add.mjs --file public --title "标题" "正文"
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, ROOT_DIR } from './config.mjs';

const cfg = loadConfig();

const argv = process.argv.slice(2);
let slot = 'public';
let title = '';
const texts = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--file' && argv[i + 1]) {
    slot = argv[++i] === 'private' ? 'private' : 'public';
  } else if (a === '--title' && argv[i + 1]) {
    title = argv[++i];
  } else {
    texts.push(a);
  }
}

const body = texts.join(' ').trim();
if (!body) {
  console.log('用法: node diary-add.mjs "正文" [--file private] [--title 标题]');
  process.exit(1);
}

const target = cfg.diary[slot];
if (!target) {
  console.error(`❌ config.json 里没配 diary.${slot}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const head = title ? `### ${stamp} · ${title}` : `### ${stamp}`;

fs.appendFileSync(target, `\n---\n\n${head}\n\n${body}\n`, 'utf8');
console.log(`✅ 已写入 ${target}（${body.length} 字）`);

console.log('重建索引…');
try {
  execFileSync(process.execPath, [path.join(ROOT_DIR, 'index.mjs')], { stdio: 'inherit' });
  console.log('✅ 索引已更新');
} catch (e) {
  console.error('⚠️ 索引重建失败：' + (e.message || e));
  process.exitCode = 1;
}
