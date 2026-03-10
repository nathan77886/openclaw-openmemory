# openclaw-openmemory

OpenClaw 的长期记忆插件，通过 HTTP 对接 [OpenMemory](https://github.com/mem0ai/mem0) 后端，为 AI 对话提供跨会话的持久记忆能力。

---

## 功能特性

- **自动召回（Auto Recall）**：每次 Agent 运行前，自动检索与当前对话相关的历史记忆并注入上下文。
- **自动捕获（Auto Capture）**：每次新建会话时，自动将当前对话摘要持久化到 OpenMemory。
- **手动工具（Manual Tools）**：提供四个可供 Agent 调用的工具：
  - `memory_search` — 语义搜索记忆
  - `memory_store` — 手动存储一条记忆
  - `memory_list` — 列出当前用户的全部记忆
  - `memory_forget` — 按 ID 删除指定记忆

---

## 插件信息

| 字段 | 值 |
|------|-----|
| 插件 ID | `memory-openmemory` |
| 类型 | `memory` |
| 版本 | `1.0.0` |
| 许可证 | MIT |

---

## 前置要求

- 已部署并运行的 [OpenMemory](https://github.com/mem0ai/mem0) HTTP 后端（默认监听 `http://127.0.0.1:8765`）。
- OpenClaw 宿主环境（支持 `registerTool` / `registerHook` API）。

---

## 安装

将 `memory-openmemory` 目录放入 OpenClaw 的插件目录，OpenClaw 会自动加载 `openclaw.plugin.json` 并注册插件。

---

## 配置

在 OpenClaw 的插件配置中，可为 `memory-openmemory` 插件指定以下选项：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `baseUrl` | `string` | `http://127.0.0.1:8765` | OpenMemory HTTP 后端的基础 URL（**必填**） |
| `userId` | `string` | `default-user` | 记忆所关联的用户 ID（**必填**） |
| `apiKey` | `string` | `""` | 可选的 API Key，以 `Bearer` Token 方式发送 |
| `autoRecall` | `boolean` | `true` | 是否在每次 Agent 运行前自动注入相关记忆 |
| `autoCapture` | `boolean` | `true` | 是否在新建会话时自动捕获会话摘要 |
| `recallLimit` | `number` | `5` | 每次自动召回最多注入的记忆条数 |
| `captureMaxChars` | `number` | `2000` | 捕获会话摘要时的最大字符数 |
| `timeoutMs` | `number` | `8000` | HTTP 请求超时时间（毫秒） |
| `searchPath` | `string` | `/memories/search` | 记忆搜索接口路径 |
| `storePath` | `string` | `/memories` | 记忆存储接口路径 |
| `listPath` | `string` | `/memories` | 记忆列表接口路径 |
| `deletePathTemplate` | `string` | `/memories/{id}` | 记忆删除接口路径模板，`{id}` 为占位符 |

---

## 工具说明

### `memory_search`

语义搜索与 `query` 最相关的记忆。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | `string` | ✅ | 搜索关键词或语句 |
| `limit` | `number` | ❌ | 最大返回条数，默认为 `recallLimit` |

---

### `memory_store`

将一段文本手动存储为记忆。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | `string` | ✅ | 要存储的文本内容 |
| `metadata` | `object` | ❌ | 附加元数据（可选） |

---

### `memory_list`

列出当前配置用户的所有记忆，返回记忆 ID 与内容。

---

### `memory_forget`

按 ID 删除指定记忆。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | ✅ | 要删除的记忆 ID |

---

## 钩子说明

| 钩子事件 | 触发条件 | 行为 |
|----------|----------|------|
| `agent:before-run` | 每次 Agent 执行前 | 检索与最新用户消息相关的记忆，以 `<relevant-memories>` XML 块注入到 `system` 消息（需启用 `autoRecall`） |
| `command:new` | 每次新建对话/会话时 | 将当前会话内容摘要存储到 OpenMemory（需启用 `autoCapture`） |

---

## 目录结构

```
memory-openmemory/
├── index.ts               # 插件主逻辑
├── openclaw.plugin.json   # 插件元数据与配置 Schema
└── package.json           # 包描述文件
```

---

## 许可证

MIT
