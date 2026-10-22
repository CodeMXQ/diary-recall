# diary-recall

![diary-recall](assets/cover.jpg)

把日记做成**可语义检索**的记忆。纯本地，离线可用。

## 它解决什么

AI 每次开新会话都是白纸。手写规则文件越写越长，每轮都在吃 token。

这里换个思路：

- **人设留在明面**（一小段常驻）
- **长尾事实沉进库**（要用才捞）

查的时候不用记得原话，问意思就行。

### 两层分工

```
记什么、什么时候记   →  AI 自己判断（靠 AGENTS.md 里那段规则）
存下来、怎么翻回来   →  这个工具
```

**所以「自动记」是有的**，只不过不是工具在记——是**你的 AI 读了那段规则之后，自己决定要记**。

工具帮它做的只有两件事：**写进去不费劲**（`diary-add.mjs` 一步搞定），**想起来不费劲**（问意思就能查到）。

## 能干什么

- **问意思就能找到** —— 不用记得原话，也不用记得关键词
- **写下的都在** —— **不淡忘，不自动删**。日记的意义就是别忘，旧的那条永远还在
- **新的事稍微靠前** —— 时间衰减只影响排序，不影响存留：旧的还在，只是不会抢新的位置
- **增量更新** —— 每段算内容指纹，**改一段就只重算一段**。第二次之后通常零点几秒
- **纯本地** —— 模型在你机器上跑，日记不出门
- **文件是你的** —— 就是普通 markdown，记事本能改、git 能管、换工具能带走
- **写日记一步到位** —— `diary-add.mjs` 追加完自动重建索引
- **索引过期会自己发现** —— 手动改过日记的话，下次查询会自动重建
- **`[重要]` 加权** —— 标了 `[重要]` 的条目检索时优先
- **没有界面，但有命令** —— 一条命令就完事，不用点鼠标。想自动化也方便，任何脚本都能调

## 不能干什么

- **它自己不记事** —— 这个工具只负责「存」和「翻」，**不判断该记什么**。
  判断是 AI 的活。配合 [`AGENTS-snippet.md`](./AGENTS-snippet.md) 把那套规则贴进 `AGENTS.md`，你的 AI 就会在合适的时候自己写——**工具只提供入口，记什么由它决定**。
- **不会自动瘦身** —— 什么都留着，所以索引会一直变大。想删只能自己删原文件
- **不处理图片和 PDF** —— 只认 markdown / 纯文本
- **第一次总是慢** —— 头一回要下模型 + 全量算，之后才是增量
- **它替不了你判断轻重** —— 什么值得记、什么该标 `[重要]`，还是写的人自己的事

## 快速开始

### 一键安装（推荐）

```bash
git clone https://github.com/CodeMXQ/diary-recall
cd diary-recall
node install.mjs --diary ~/notes/diary.md
```

它会：检查 Node 版本 → 装依赖 → 生成配置 → 建索引 → **打印一段可以直接贴进 `AGENTS.md` 的话**（路径已填好）→ 跑一次验证。

**日记文件不存在会帮你建一个空的。**

模型想用小一点（23MB 而不是 313MB）：

```bash
node install.mjs --diary ~/notes/diary.md --model small
```

### 手动装

```bash
npm install
cp config.example.json config.json
node index.mjs        # 第一次会下载模型，约 313MB
node recall.mjs "示例日记里说了什么"
```

**开箱用的是仓库自带的示例日记**，先跑通再改成自己的。

### clone 卡住不动？

**大概率不是仓库大**（整个仓库才 1 MB 出头），是 **git 不走系统代理**。

浏览器能打开 GitHub，不代表 `git` 也能——它俩读代理的方式不一样。

如果你有代理，给它单独配一次：

```bash
git config --global http.proxy  http://127.0.0.1:你的端口
git config --global https.proxy http://127.0.0.1:你的端口
```

不知道端口是多少？看你代理软件的系统代理设置，或者：

```bash
# Windows
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

**配完记得梯子关掉时要撤销**，不然 git 会一直往那个端口上撞：

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

## 三个命令

| 命令 | 干什么 |
|---|---|
| `node index.mjs` | 全量重建索引 |
| `node recall.mjs "..."` | 查记忆（发现索引过期会自动重建） |
| `node diary-add.mjs "正文"` | 写日记 + 自动重建索引 |

**给 AI 用的话，看 [`AGENTS-snippet.md`](./AGENTS-snippet.md)** —— 那里有一段可以直接贴进 `AGENTS.md` 的话，说清楚什么时候该写日记。

查询参数：

```
node recall.mjs "某个决定是怎么定的" --top=3
node recall.mjs "夜班" --tag=日记 --full
node recall.mjs "很久以前的事" --no-decay
```

## 配置

复制 `config.example.json` 为 `config.json`：

```json
{
  "sources": [
    { "file": "~/notes/diary.md", "tag": "日记" },
    { "file": "~/notes/profile.md", "tag": "人设" }
  ],
  "diary": {
    "public": "~/notes/diary.md",
    "private": "~/notes/diary-private.md"
  },
  "model": "Xenova/bge-large-zh-v1.5",
  "dataDir": "./data",
  "maxChars": 400,
  "decayWeight": 0.15,
  "halfLifeDays": 30,
  "importantWeight": 0.25
}
```

`~` 展开成用户主目录，相对路径相对仓库根目录。

| 字段 | 作用 |
|---|---|
| `sources` | 要索引的 markdown 文件，`tag` 是分组名 |
| `diary` | `diary-add.mjs` 往哪写 |
| `model` | `bge-small-zh-v1.5`（512 维，快）或 `bge-large-zh-v1.5`（1024 维，准） |
| `maxChars` | 单段上限，超过按句号切 |
| `decayWeight` | 时间衰减权重，0 关闭 |
| `halfLifeDays` | 多久新近度减半 |
| `importantWeight` | `[重要]` 标记的加权 |

## 写日记的格式

不用学新语法，普通 markdown 就行：

```markdown
## 看过的

| 时间 | 标题 | 想法 |
|---|---|---|
| 2026-10-20 12:41 | 某个视频 | 看完的想法 |

## 想说的

- 一条一条写，空行分段，每段是一个独立记忆。

## [重要] 这个别忘

打了 [重要] 标记的条目，检索时会加权。
```

**切段规则**：

- 按 markdown 标题分块，记下所属小节
- **表格的每一行单独成段**（一行 = 一条独立记忆）
- 其余按空行分段
- 太短的并到上一段，太长的按句号切开

**自动识别的两样东西**：

- **日期**：段里出现 `2026-10-20` 这类就会被记下来，用于时间衰减
- **重要**：`[重要]` / `【重要】` 会被标记，检索时加权

## 原理

```
查询 → 加 bge 前缀 → 向量（512 或 1024 维）
     ↘ jieba 分词 → BM25
        ↓
     RRF 融合（两路各取排名，1/(60+rank) 相加）
        ↓
     时间衰减 + 重要度微调
        ↓
     top-k
```

**为什么要双路**：纯向量对专有名词不敏感，纯关键词对同义改写不敏感，合起来才稳。

**为什么用 jieba 词表**：二字切分会把「车站」拆成「车」+「站」，搜「车」的时候全撞进来。用词表就没这个问题。

**时间衰减干什么**：算的是「新近度」，不是「重要性」。问旧事时它影响很小，因为向量/BM25 的基础分差距更大。

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

### 4. Windows 的 UTF-8 BOM

记事本和 PowerShell 保存 UTF-8 都会带 BOM，`JSON.parse` 直接炸：

```
Unexpected token '﻿'
```

代码里已经把 BOM 去掉了。

### 5. `silenceremove` 会切掉中间的静音

（跟本工具无关，但同一个作者踩过的坑）

录音去静音时，`stop_periods=1` 遇到第一段停顿就当结尾了。只想去头尾的话，用 `-ss` / `-t` 手动切。

## 成本

| 项 | 数字 |
|---|---|
| 模型 | 约 313 MB（`large`）/ 约 23 MB（`small`），一次性 |
| 词表 | 1.5 MB（已附在仓库） |
| 索引 | 100 段约 1 MB，1000 段约 10 MB |
| 首次建索引 | large 约 15 段/秒 |
| **之后重建** | **只算改过的段**，通常零点几秒 |
| 单次查询 | 几秒（含模型加载） |
| 网络 | **零**（装完模型之后） |

### 增量是怎么做的

每段算一个内容指纹（`sha1` 前 16 位），存进索引。

下次重建时：

```
段落没变  → 指纹一样 → 直接复用上次的向量
段落改过  → 指纹变了 → 重新算这一段
段落新增  → 没有指纹 → 重新算这一段
段落删掉  → 不在列表里 → 自然消失
```

所以**改一段就只算一段**。实测：10 段全复用 **0.2 秒**；加一行后 **只算 1 段**。

> ⚠️ 换模型会全部重算——向量维度和含义都变了，旧的没法用。代码会自动检测。

## 限制

- 索引文件是**整体重写**的，不是真正的数据库追加（但重写很快，几 MB 而已）
- 只索引 markdown
- 查询要现加载模型，没做常驻服务
- 时间衰减只认文本里的日期，不认文件修改时间

## 词表来源

`data/jieba-dict.txt` 来自 [jieba](https://github.com/fxsjy/jieba) 的 `extra_dict/dict.txt.small`，
MIT 协议，只保留了词条本身，去掉了词频和词性两列。

## License

MIT
