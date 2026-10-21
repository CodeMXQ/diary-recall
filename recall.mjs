/**
 * 查记忆：向量 + BM25 混合检索（RRF 融合）。
 *
 * 用法：
 *   node recall.mjs "要查的事"
 *   node recall.mjs "某个决定是怎么定的" --top=3
 *   node recall.mjs "夜班" --tag=日记 --full
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';
import { loadConfig } from './config.mjs';

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

if (!query) {
  console.log('用法: node recall.mjs "要查的事" [--top=5] [--tag=日记] [--full]');
  process.exit(1);
}
if (!fs.existsSync(VEC_FILE)) {
  console.log('还没有索引，先跑：node index.mjs');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(VEC_FILE, 'utf8'));
const docs = data.segments;
const N = docs.length;

// ---------- BM25：中文按二字切分 ----------
function bigrams(text) {
  const clean = String(text).toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  const out = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  if (!out.length && clean) out.push(clean);
  return out;
}

const docTerms = docs.map((d) => bigrams(d.text));
const avgLen = docTerms.reduce((a, t) => a + t.length, 0) / N || 1;
const df = new Map();
for (const terms of docTerms) {
  for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
}

const K1 = 1.5;
const B = 0.75;

function bm25(queryText) {
  const qTerms = bigrams(queryText);
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

// ---------- 过滤 + 输出 ----------
let pool = docs.map((_, i) => i);
if (tagFilter) {
  const kept = pool.filter((i) => docs[i].tag === tagFilter);
  if (kept.length) pool = kept;
  else console.log(`（没有 tag=${tagFilter} 的内容，忽略该过滤）\n`);
}
pool.sort((a, b) => fused[b] - fused[a]);

console.log(`查询：${query}`);
console.log(`命中 ${pool.length} 段中的前 ${Math.min(topK, pool.length)}：`);

for (const i of pool.slice(0, topK)) {
  const d = docs[i];
  const where = [d.source, d.section].filter(Boolean).join(' / ');
  console.log(`\n───── [${d.tag}] ${where}`);
  console.log(`      向量 ${cosScores[i].toFixed(3)}   BM25 ${bmScores[i].toFixed(1)}`);
  const body = showFull ? d.text : d.text.length > 180 ? d.text.slice(0, 180) + '…' : d.text;
  console.log(body);
}
