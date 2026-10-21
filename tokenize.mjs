/**
 * 中文分词：用 jieba 词表做最大正向匹配。
 *
 * 为什么不用二字切分：
 *   「车站」会被拆成「车」+「车站」+「站」，
 *   搜「车」的时候就撞进了「车站」里。
 *
 * 词表来自 jieba 的 extra_dict/dict.txt.small（MIT），
 * 只保留词条，丢掉词频和词性。
 */
import fs from 'node:fs';

let DICT = null;
let MAX_LEN = 1;

/** 加载词表。返回词条数。 */
export function loadDict(file) {
  const words = new Set();
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const w = line.split(' ')[0].trim();
    if (!w) continue;
    words.add(w);
    if (w.length > MAX_LEN) MAX_LEN = w.length;
  }
  DICT = words;
  return words.size;
}

/** 词表加载了没有。 */
export function ready() {
  return DICT !== null;
}

/** 把一段中文按最大正向匹配切成词。 */
function cutChinese(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let matched = '';
    const limit = Math.min(MAX_LEN, text.length - i);
    for (let len = limit; len > 0; len--) {
      const candidate = text.slice(i, i + len);
      if (DICT.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      out.push(matched);
      i += matched.length;
    } else {
      // 没匹配上：退化成「单字 + 下一字的二元」，避免全是碎片
      if (i + 1 < text.length) {
        out.push(text.slice(i, i + 2));
        i += 1;
      } else {
        out.push(text[i]);
        i += 1;
      }
    }
  }
  return out;
}

/** 分词。中文用词表，英文数字按词切。 */
export function tokenize(text) {
  if (!DICT) {
    // 没加载词表就退回二字切分，至少能用
    const clean = String(text).toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
    const out = [];
    for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
    if (!out.length && clean) out.push(clean);
    return out;
  }

  const out = [];
  const parts = String(text).split(/([\u4e00-\u9fa5]+)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^[\u4e00-\u9fa5]+$/.test(part)) {
      out.push(...cutChinese(part));
    } else {
      const words = part.toLowerCase().match(/[a-z0-9]+/g);
      if (words) out.push(...words);
    }
  }
  return out;
}
