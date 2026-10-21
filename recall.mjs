/**
 * 查记忆：向量 + BM25（jieba 分词）+ 时间衰减 + 重要标记。
 *
 * 用法：
 *   node recall.mjs "要查的事"
 *   node recall.mjs "某个决定是怎么定的" --top=3
 *   node recall.mjs "夜班" --tag=日记 --full
 *   node recall.mjs "旧事" --no-decay
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';
import { loadConfig, ROOT_DIR } from './config.mjs';
import { loadDict, tokenize } from './tokenize.mjs';

const cfg = loadConfig();
const VEC_FILE = path.join(cfg.dataDir, 'vectors.json');

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const query = argv.filter((a) => !a.startsWith('--')).join(' ').trim();

const opt = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const topK = Number(opt('top', '5')) || 5;
const tagFilter = opt('tag', '');
const showFull = flags.includes('--full');
const noDecay = flags.includes('--no-decay');

if (!query) {
  console.log('用法: node recall.mjs "要查的事" [--top=5] [--tag=日记] [--full] [--no-decay]');
  process.exit(1);
}
if (!fs.existsSync(VEC_FILE)) {
  console.log('还没有索引，先跑：node index.mjs');
  process.exit(1);
}

// ---------- 索引过期检查 ----------
// 手动改过日记的人最容易踩的坑：文件变了，索引还是旧的，搜什么都搜不到。
// 默认自动重建，可以用 --no-auto 关掉。
const autoReindex = cfg.autoReindex !== false && !flags.includes('--no-auto');

function newestSourceMtime() {
  let newest = 0;
  for (const s of cfg.sources || []) {
    try {
      const m = fs.statSync(s.file).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      // 文件不在就跳过，index.mjs 会报
    }
  }
  return newest;
}

const vecMtime = fs.statSync(VEC_FILE).mtimeMs;
const srcMtime = newestSourceMtime();

if (srcMtime > vecMtime) {
  if (autoReindex) {
    console.log('检测到源文件比索引新，正在重建索引…');
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT_DIR, 'index.mjs')], { stdio: 'inherit' });
    console.log('');
  } else {
    console.log('⚠️  索引比源文件旧，结果可能不全。跑一下：node index.mjs');
    console.log('');
  }
}

// ---------- 分词：有词表就用 jieba，没有退回二字 ----------
const dictFile = path.resolve(ROOT_DIR, cfg.dictPath || 'data/jieba-dict.txt');
if (fs.existsSync(dictFile)) {
  loadDict(dictFile);
}

const data = JSON.parse(fs.readFileSync(VEC_FILE, 'utf8'));
const docs = data.segments;
const N = docs.length;

// ---------- BM25 ----------
const docTerms = docs.map((d) => tokenize(d.text));
const avgLen = docTerms.reduce((a, t) => a + t.length, 0) / N || 1;
const df = new Map();
for (const terms of docTerms) {
  for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
}

const K1 = 1.5;
const B = 0.75;

function bm25(queryText) {
  const qTerms = tokenize(queryText);
  return docTerms.map((terms) => {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of qTerms) {
      const n = df.get(t);
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = tf.get(t) || 0;
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * terms.length) / avgLen));
    }
    return score;
  });
}

// ---------- 向量 ----------
env.cacheDir = path.join(cfg.dataDir, 'models');
const extractor = await pipeline('feature-extraction', data.model || cfg.model);
const out = await extractor([cfg.queryPrefix + query], {
  pooling: 'mean',
  normalize: true,
  truncation: true,
  max_length: 512,
});
const qv = out.tolist()[0];

const cosScores = docs.map((d) => {
  let s = 0;
  for (let i = 0; i < qv.length; i++) s += qv[i] * d.vec[i];
  return s;
});

const bmScores = bm25(query);

// ---------- RRF 融合 ----------
const vecOrder = docs.map((_, i) => i).sort((a, b) => cosScores[b] - cosScores[a]);
const bmOrder = docs.map((_, i) => i).sort((a, b) => bmScores[b] - bmScores[a]);

const RRF_K = 60;
const fused = new Array(N).fill(0);
vecOrder.forEach((idx, rank) => { fused[idx] += 1 / (RRF_K + rank + 1); });
bmOrder.forEach((idx, rank) => { fused[idx] += 1 / (RRF_K + rank + 1); });

// ---------- 时间 + 重要度微调 ----------
const decayWeight = Number(cfg.decayWeight ?? 0.15);
const halfLifeDays = Number(cfg.halfLifeDays ?? 30);
const importantWeight = Number(cfg.importantWeight ?? 0.25);
const now = Date.now();

function timeFactor(seg) {
  if (noDecay || !seg.date) return 0;
  const t = new Date(seg.date + 'T00:00:00').getTime();
  if (Number.isNaN(t)) return 0;
  const ageDays = Math.max(0, (now - t) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

const final = fused.map((base, i) => {
  let score = base * (1 + decayWeight * timeFactor(docs[i]));
  if (docs[i].important) score *= 1 + importantWeight;
  return score;
});

// ---------- 过滤 + 输出 ----------
let pool = docs.map((_, i) => i);
if (tagFilter) {
  const kept = pool.filter((i) => docs[i].tag === tagFilter);
  if (kept.length) pool = kept;
  else console.log(`（没有 tag=${tagFilter} 的内容，忽略该过滤）\n`);
}
pool.sort((a, b) => final[b] - final[a]);

console.log(`查询：${query}`);
console.log(`命中 ${pool.length} 段中的前 ${Math.min(topK, pool.length)}：`);

for (const i of pool.slice(0, topK)) {
  const d = docs[i];
  const where = [d.source, d.section].filter(Boolean).join(' / ');
  const marks = [];
  if (d.date) marks.push(d.date);
  if (d.important) marks.push('重要');
  const tag = marks.length ? ` (${marks.join(' · ')})` : '';
  console.log(`\n───── [${d.tag}] ${where}${tag}`);
  console.log(`      向量 ${cosScores[i].toFixed(3)}   BM25 ${bmScores[i].toFixed(1)}   最终 ${final[i].toFixed(4)}`);
  const body = showFull ? d.text : d.text.length > 180 ? d.text.slice(0, 180) + '…' : d.text;
  console.log(body);
}
