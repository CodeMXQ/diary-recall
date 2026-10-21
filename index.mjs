/**
 * 建索引：扫日记 → 切段 → 算向量 → 存 vectors.json
 *
 * 切段规则：
 *   - 按 markdown 标题分块，记下所属小节
 *   - 表格的每一行单独成段（一行 = 一条独立记忆）
 *   - 其余按空行分段
 *   - 太短的并到上一段，太长的按句号切开
 *
 * 第一次运行会下载模型，之后离线可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const OUT = path.join(cfg.dataDir, 'vectors.json');
const MIN_LEN = 12;

env.cacheDir = path.join(cfg.dataDir, 'models');

/** 把一份 markdown 切成记忆片段。 */
function segment(text, source, maxChars) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let buffer = [];
  let section = '';

  const push = (body) => {
    const t = body.trim();
    if (!t) return;
    if (t.length < MIN_LEN && segments.length) {
      segments[segments.length - 1].text += '\n' + t;
      return;
    }
    if (t.length > maxChars) {
      const parts = t.split(/(?<=[。！？；.!?;])/);
      let chunk = '';
      for (const part of parts) {
        if ((chunk + part).length > maxChars && chunk) {
          segments.push({ source: path.basename(source.file), tag: source.tag, section, text: chunk.trim() });
          chunk = part;
        } else {
          chunk += part;
        }
      }
      if (chunk.trim()) segments.push({ source: path.basename(source.file), tag: source.tag, section, text: chunk.trim() });
      return;
    }
    segments.push({ source: path.basename(source.file), tag: source.tag, section, text: t });
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
    console.log(`${String(src.tag).padEnd(6)} ${path.basename(src.file).padEnd(28)} ${segs.length} 段`);
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
