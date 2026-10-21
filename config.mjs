import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** 把 ~ 展开成用户主目录。 */
export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * 读 config.json，缺失字段用默认值。
 * dataDir 和 sources 里的相对路径都相对仓库根目录。
 */
export function loadConfig(overrides = {}) {
  const file = path.join(ROOT, 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error('config.json 解析失败：' + e.message);
    }
  }

  const cfg = {
    sources: [],
    diary: { public: '', private: '' },
    model: 'Xenova/bge-large-zh-v1.5',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    dataDir: './data',
    maxChars: 400,
    ...user,
    ...overrides,
  };

  cfg.dataDir = path.resolve(ROOT, expandHome(cfg.dataDir));
  cfg.sources = (cfg.sources || []).map((s) => ({ ...s, file: expandHome(s.file) }));
  cfg.diary = Object.fromEntries(
    Object.entries(cfg.diary || {}).map(([k, v]) => [k, expandHome(v)])
  );

  return cfg;
}

export const ROOT_DIR = ROOT;
