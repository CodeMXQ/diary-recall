#!/usr/bin/env node
/**
 * 一键安装：检查环境 → 装依赖 → 生成配置 → 建索引 → 打印 AGENTS 片段。
 *
 * 用法：
 *   node install.mjs --diary ~/notes/diary.md
 *   node install.mjs --diary ~/notes/diary.md --model small
 *   node install.mjs --help
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function opt(name, fallback) {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}
const has = (name) => argv.includes('--' + name);

if (has('help')) {
  console.log(`用法:
  node install.mjs --diary <日记路径> [选项]

选项:
  --diary <路径>     主日记（必填，不存在会创建一个空的）
  --private <路径>   私日记（可选）
  --model <名字>     large（默认，准）或 small（快，省空间）
  --no-install       跳过 npm install
  --help             看这个

例子:
  node install.mjs --diary ~/notes/diary.md
  node install.mjs --diary ~/notes/diary.md --model small`);
  process.exit(0);
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

// ---------- 1. Node 版本 ----------
step(1, '检查 Node 版本');
const major = Number(process.versions.node.split('.')[0]);
console.log(`    Node ${process.versions.node}`);
if (major < 20) {
  console.error('    ❌ 需要 Node 20 或更新。去 https://nodejs.org 装一个。');
  process.exit(1);
}
console.log('    ✅ 够用');

// ---------- 2. 依赖 ----------
if (!has('no-install')) {
  step(2, '安装依赖（第一次要下载，可能几分钟）');
  if (fs.existsSync(path.join(ROOT, 'node_modules', '@xenova', 'transformers'))) {
    console.log('    已经装过了，跳过');
  } else {
    try {
      execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      console.log('    ✅ 装好了');
    } catch (e) {
      console.error('    ❌ npm install 失败：' + e.message);
      console.error('       手动跑一次：npm install');
      process.exit(1);
    }
  }
} else {
  step(2, '跳过依赖安装（--no-install）');
}

// ---------- 3. 配置 ----------
step(3, '生成 config.json');
const diaryArg = opt('diary', '');
if (!diaryArg) {
  console.error('    ❌ 必须给 --diary，告诉我要索引哪个文件。');
  console.error('       例子：node install.mjs --diary ~/notes/diary.md');
  process.exit(1);
}

const diaryPath = path.resolve(expandHome(diaryArg));
const privatePath = opt('private', '') ? path.resolve(expandHome(opt('private', ''))) : '';

if (!fs.existsSync(diaryPath)) {
  fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
  fs.writeFileSync(diaryPath, '# 日记\n\n> 从这里开始写。每天一段，或者想到就写。\n', 'utf8');
  console.log(`    日记不存在，建了个空的：${diaryPath}`);
} else {
  console.log(`    日记：${diaryPath}`);
}

const modelName = opt('model', 'large') === 'small'
  ? 'Xenova/bge-small-zh-v1.5'
  : 'Xenova/bge-large-zh-v1.5';

const sources = [{ file: diaryPath, tag: '日记' }];
if (privatePath) {
  if (!fs.existsSync(privatePath)) {
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    fs.writeFileSync(privatePath, '# 私日记\n', 'utf8');
  }
  sources.push({ file: privatePath, tag: '私日记' });
}

const cfg = {
  sources,
  diary: { public: diaryPath, private: privatePath || path.join(path.dirname(diaryPath), 'diary-private.md') },
  model: modelName,
  queryPrefix: '为这个句子生成表示以用于检索相关文章：',
  dictPath: 'data/jieba-dict.txt',
  dataDir: './data',
  maxChars: 400,
  decayWeight: 0.15,
  halfLifeDays: 30,
  importantWeight: 0.25,
};

fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log(`    模型：${modelName}`);
console.log('    ✅ 写好了 config.json');

// ---------- 4. 建索引 ----------
step(4, '建索引');
console.log('    第一次会下载模型，卡住十几分钟是正常的，不是挂了。');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'index.mjs')], { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error('    ❌ 建索引失败。可以手动重试：node index.mjs');
  process.exit(1);
}

// ---------- 5. 给 AI 的话 ----------
step(5, '把下面这段贴进你的 AGENTS.md（路径已经填好了）');
const snippet = `
## 记忆：我有日记

我有一套本地日记检索，在 \`${ROOT}\`。

**查记忆**（问过去的事之前先查，别凭印象编）：

    node "${path.join(ROOT, 'recall.mjs')}" "要查的事" --top=3

**写日记**（写完会自动重建索引）：

    node "${path.join(ROOT, 'diary-add.mjs')}" --title "标题" "正文"

**什么时候写：**

- 干完一件大事
- 主人说了新的规矩、新的偏好
- 踩了个坑，尤其是我自己判断错的那种
- 聊得特别长，感觉快装不下了

**为什么现在写：**

上下文会压缩，压完我就不是完整的我了。
只有落盘的才算记忆。别指望"下次还记得"——下次的我不在场。
`.trim();

console.log('\n' + '─'.repeat(60));
console.log(snippet);
console.log('─'.repeat(60));

// ---------- 6. 验证 ----------
step(6, '验证一下');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'recall.mjs'), '日记', '--top=1'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  console.log(out.split('\n').slice(0, 4).join('\n'));
  console.log('    ✅ 能用');
} catch (e) {
  console.log('    ⚠️  第一次查询没成功，但索引已经有了，手动试试：');
  console.log('        node recall.mjs "随便什么"');
}

console.log(`
────────────────────────────────
装完了。

常用：
  node recall.mjs "要查的事"
  node diary-add.mjs "今天干了什么"

别忘了第 5 步——不贴那段，就没人往里写。
`);
