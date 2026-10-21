# fish-memory

把日记做成**可语义检索**的记忆。纯本地，离线可用。

## 它解决什么

AI 每次开新会话都是白纸。手写规则文件越写越长，每轮都在吃 token。

这里换个思路：

- **人设留在明面**（一小段常驻）
- **长尾事实沉进库**（要用才捞）

查的时候不用记得原话，问意思就行。

## 快速开始

```bash
npm install
cp config.example.json config.json    # 改成本机路径
node index.mjs                        # 第一次会下载模型（约 1.3GB）
node recall.mjs "以前那件事是怎么解决的"
```

## 三个命令

| 命令 | 干什么 |
|---|---|
| `node index.mjs` | 全量重建索引 |
| `node recall.mjs "..."` | 查记忆 |
| `node diary-add.mjs "正文"` | 写日记 + 自动重建索引 |

查询参数：

```
node recall.mjs "某个决定是怎么定的" --top=3
node recall.mjs "夜班" --tag=日记 --full
```

## 配置

复制 `config.example.json` 为 `config.json`：

```json
{
  "sources": [
    { "file": "~/.dsh/whale-diary.md", "tag": "日记" },
    { "file": "~/.dsh/AGENTS.md", "tag": "人设" }
  ],
  "diary": {
    "public": "~/.dsh/whale-diary.md",
    "private": "~/.dsh/whale-diary-private.md"
  },
  "model": "Xenova/bge-large-zh-v1.5",
  "dataDir": "./data",
  "maxChars": 400
}
```

`~` 会展开成用户主目录。`dataDir` 里存模型缓存和索引。

## 切段规则

不是按句子切，是按**语义块**切：

- 按 markdown 标题分块，记下所属小节
- **表格的每一行单独成段**（一行 = 一条独立记忆）
- 其余按空行分段
- 太短的并到上一段，太长的按句号切开

## 原理

```
查询 → 加 bge 前缀 → 向量（1024 维）
     ↘ 二字切分 → BM25
        ↓
     RRF 融合（两路各取排名，1/(60+rank) 相加）
        ↓
     top-k
```

**为什么两路**：纯向量对专有名词不敏感，纯关键词对同义改写不敏感，合起来才稳。

## 踩过的坑

### 1. bge 系列查询必须加前缀

```
为这个句子生成表示以用于检索相关文章：
```

不加的话，相关句子 0.44、无关 0.46 —— **排序是反的**。

文档不加前缀，**只有查询加**。

### 2. 输入上限 512 token

中文约等于字数。按 700 字符切段会直接崩：

```
BroadcastIterator::Append axis == 1 || axis == largest was false
512 by 516
```

切到 400 以内，调用时带 `truncation: true`。

### 3. 小模型跨不过远距离语义

| 模型 | 搜「夜班」 | 搜「作息怎么安排」 |
|---|---|---|
| bge-small（512 维） | ✅ | ❌ 跑偏 |
| bge-large（1024 维） | ✅ | ✅ |

**这是换 large 唯一的理由。**

### 4. `silenceremove` 会切掉中间的静音

录完音去静音时，`stop_periods=1` 遇到第一段停顿就当结尾了。只想去头尾的话，用 `-ss` / `-t` 手动切。

## 成本

| 项 | 数字 |
|---|---|
| 模型 | 约 1.3 GB（一次性下载，之后离线） |
| 索引 | 290 段约 2.7 MB |
| 建索引 | 三到五分钟（large 慢） |
| 单次查询 | 几秒（含模型加载） |
| 网络 | **零** |

## 限制

- 索引是**全量重建**，日记很大以后要改增量
- 只索引 markdown
- 查询要现加载模型，没做常驻服务
- small 模型快但语义弱，large 反过来

## License

MIT
