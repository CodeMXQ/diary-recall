/**
 * 建索引：扫日记 → 切段 → 算向量 → 存 vectors.json
 *
 * 切段规则：
 *   - 按 markdown 标题分块，记下所属小节
 *   - 表格的每一行单独成段（一行 = 一条独立记忆）
 *   - 其余按空行分段
 *   - 太短的并到上一段，太长的按句号切开
 *
 * 同时从每段里抽出：
 *   - date      这一条是什么时候的事（给时间衰减用）
 *   - important 有没有 [重要] 标记（检索时加权）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const OUT = path.join(cfg.dataDir, 'vectors.json');
const MIN_LEN = 12;

env.cacheDir = path.join(cfg.dataDir, 'models');

const DATE_RE = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/;
const IMPORTANT_RE = /\[重要\]|【重要】|\[!\]/;

function extractDate(text) {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const mo = String(m[2]).padStart(2, '0');
  const d = String(m[3]).padStart(2, '0');
  return `${m[1]}-${mo}-${d}`;
}

/** 把一份 markdown 切成记忆片段。 */
function segment(text, source, maxChars) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let buffer = [];
  let section = '';

  const emit = (body) => {
    const t = body.trim();
    if (!t) return;
    segments.push({
      source: path.basename(source.file),
      tag: source.tag,
      section,
      text: t,
      date: extractDate(t),
      important: IMPORTANT_RE.test(t),
    });
  };

  const push = (body) => {
    const t = body.trim();
    if (!t) return;
    // 太短的并进上一段，尽量保住上下文
    if (t.length < MIN_LEN && segments.length) {
      const prev = segments[segments.length - 1];
      prev.text += '\n' + t;
      prev.important = prev.important || IMPORTANT_RE.test(t);
      prev.date = prev.date || extractDate(t);
      return;
    }
    if (t.length > maxChars) {
      const parts = t.split(/(?<=[。！？；.!?;])/);
      let chunk = '';
      for (const part of parts) {
        if ((chunk + part).length > maxChars && chunk) {
          emit(chunk);
          chunk = part;
        } else {
          chunk += part;
        }
      }
      if (chunk.trim()) emit(chunk);
      return;
    }
    emit(t);
  };

  const flush = () => {
    if (buffer.length) {
      push(buffer.join('\n'));
      buffer = [];
    }
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flush();
      section = heading[1].trim();
      continue;
    }
    // 表格：跳过表头和分隔行，正文每行单独成段
    if (/^\s*\|/.test(line)) {
      flush();
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) continue;
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      if (/^(时间|BV|项目|字段|Time|Field)$/.test(cells[0])) continue;
      push(cells.join(' · '));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line.replace(/^>\s?/, '').replace(/^[-*]\s+/, ''));
  }
  flush();

  return segments;
}

async function main() {
  if (!cfg.sources.length) {
    console.error('❌ 没有配置任何来源。复制 config.example.json 成 config.json 再改。');
    process.exit(1);
  }

  const all = [];
  for (const src of cfg.sources) {
    if (!fs.existsSync(src.file)) {
      console.log(`跳过（不存在）：${src.file}`);
      continue;
    }
    const text = fs.readFileSync(src.file, 'utf8');
    const segs = segment(text, src, cfg.maxChars);
    const dated = segs.filter((s) => s.date).length;
    const important = segs.filter((s) => s.important).length;
    console.log(
      `${String(src.tag).padEnd(6)} ${path.basename(src.file).padEnd(28)} ${String(segs.length).padStart(4)} 段` +
        `  (带日期 ${dated}, 重要 ${important})`
    );
    all.push(...segs);
  }

  if (!all.length) {
    console.log('没有可索引的内容。');
    return;
  }

  console.log(`\n共 ${all.length} 段，开始算向量（模型：${cfg.model}）…`);
  const extractor = await pipeline('feature-extraction', cfg.model);

  const BATCH = 16;
  const vectors = [];
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const out = await extractor(batch.map((s) => s.text), {
      pooling: 'mean',
      normalize: true,
      truncation: true,
      max_length: 512,
    });
    const list = out.tolist();
    for (let j = 0; j < batch.length; j++) {
      vectors.push({ ...batch[j], vec: list[j].map((n) => Math.round(n * 1e6) / 1e6) });
    }
    process.stdout.write(`\r  已处理 ${Math.min(i + BATCH, all.length)}/${all.length}`);
  }
  console.log('');

  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const payload = {
    model: cfg.model,
    dims: vectors[0].vec.length,
    builtAt: new Date().toISOString(),
    count: vectors.length,
    segments: vectors,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
  const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ 写入 ${OUT}（${size} MB，${vectors.length} 段，${payload.dims} 维）`);
}

main().catch((e) => {
  console.error('❌ ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
