# 让 OpenClaw 自己安装 memory-openmemory 插件（提示词）

将下方提示词直接发送给 OpenClaw，它会利用自身的文件系统操作能力自动完成插件安装。

---

## 基础安装提示词

```
请帮我安装 memory-openmemory 插件。步骤如下：

1. 确认当前操作系统，找到 OpenClaw 用户级插件目录：
   - macOS / Linux：~/.openclaw/plugins/
   - Windows：%USERPROFILE%\.openclaw\plugins\
2. 如果该目录不存在，先创建它。
3. 将当前目录下的 memory-openmemory 文件夹（包含 index.ts、openclaw.plugin.json、package.json）完整复制到上述插件目录中。
4. 完成后告知我插件已就绪，并提示我重启 OpenClaw 以使插件生效。
```

---

## 带配置的安装提示词

如果你需要在安装的同时指定 OpenMemory 后端地址和用户 ID，可使用下方版本（按需替换 `<...>` 中的值）：

```
请帮我安装并配置 memory-openmemory 插件。步骤如下：

1. 确认当前操作系统，找到 OpenClaw 用户级插件目录：
   - macOS / Linux：~/.openclaw/plugins/
   - Windows：%USERPROFILE%\.openclaw\plugins\
2. 如果该目录不存在，先创建它。
3. 将当前目录下的 memory-openmemory 文件夹（包含 index.ts、openclaw.plugin.json、package.json）完整复制到上述插件目录中。
4. 打开 OpenClaw 的配置文件（macOS/Linux：~/.openclaw/openclaw.json，Windows：%USERPROFILE%\.openclaw\openclaw.json），在 plugins.entries 下为 memory-openmemory 添加如下配置：
   {
     "memory-openmemory": {
       "enabled": true,
       "config": {
         "baseUrl": "<OpenMemory 后端地址，例如 http://127.0.0.1:8765>",
         "userId": "<你的用户 ID，例如 alice>"
       }
     }
   }
5. 保存配置文件后告知我已完成，并提示我重启 OpenClaw 以使插件生效。
```

---

## 说明

| 项目 | 说明 |
|------|------|
| 适用场景 | 你希望让 OpenClaw 代劳文件复制与配置写入，无需手动操作终端 |
| 前提条件 | 本仓库已克隆到本地，且当前工作目录位于仓库根目录 |
| 必填配置 | `baseUrl`（OpenMemory 后端地址）和 `userId`（用户 ID）在使用前必须配置 |
| 重启说明 | 插件文件复制完成后，需重启 OpenClaw 才能加载新插件 |
