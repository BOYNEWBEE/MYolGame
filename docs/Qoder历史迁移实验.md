# Qoder 历史迁移实验

## 目的

本实验仅验证 **Qoder CLI 会话历史** 能否格式化为 **Codex rollout JSONL**，
供后续在 Qoder 桌面端使用官方“从 Codex 导入”功能时测试兼容性。

- 不读取完整游戏源码或产品方案；
- 不转换真实 CLI 历史；
- 不修改现有会话、应用数据库或桌面内部数据；
- 不写 `~/.codex` 目录；
- 本次产出为临时 fixture，不入 git。

## 工具位置

```text
tools/qoder_history_to_codex.py
```

```text
tools/qoder_history_to_codex_test.py
```

## 使用命令

### dry-run（默认输出到 stdout）

```bash
python3 tools/qoder_history_to_codex.py /tmp/myolgame-import-test/source-qoder.jsonl
```

### 写入指定目录

```bash
python3 tools/qoder_history_to_codex.py /tmp/myolgame-import-test/source-qoder.jsonl \
  --output-dir /tmp/myolgame-import-test/output
```

### 同时生成 event_msg 展示事件

```bash
python3 tools/qoder_history_to_codex.py /tmp/myolgame-import-test/source-qoder.jsonl \
  --output-dir /tmp/myolgame-import-test/output \
  --emit-events
```

### 运行单元测试

```bash
cd tools
PYTHONPATH=tools python3 -m unittest qoder_history_to_codex_test -v
```

## 输出路径

- 输入 fixture（模拟 Qoder CLI 历史）：
  `/tmp/myolgame-import-test/source-qoder.jsonl`
- 输出目录：
  `/tmp/myolgame-import-test/output/`
- 输出文件名格式：
  `YYYY-MM-DDTHH-MM-SS-<uuid4>.jsonl`

> 以上路径均为 `/tmp` 下的临时文件，删除即可回滚，不会影响项目仓库。

## 转换规则

1. 仅转换 `role` / `type` 为 `user` 或 `assistant` 的消息；
2. 仅保留可见文本块；
3. 跳过 `thinking`、`tool_result`、`signature`、`image_url` 等块，并计数；
4. 过滤空消息；
5. 同一 `message id` 内对重复文本块去重；
6. 生成新的 `uuid4` 会话 id，文件命名与该会话时间一致；
7. 首行为 `session_meta`，随后为 `response_item` 消息行；
8. 助手消息附加 `phase: "final"`。

## 验证标记

本次 fixture 中的消息文本包含明确标记，便于在桌面端确认导入的是实验数据：

- 用户消息：
  `【导入实验】这是Qoder CLI转换兼容性测试，不是真实Codex开发记录。`
- 助手消息：
  `【测试回复】原始CLI会话与项目文件均未修改。验证标记 MYOL-QODER-IMPORT-20261107。`

## 实验性质声明

- 本工具输出的格式参考 Codex rollout JSONL 的 `{timestamp, type, payload}` 结构，
  但**尚未证明 Qoder 桌面官方导入器接受此格式**；
- 通过单元测试和 JSONL 格式校验，**不等于导入成功**；
- 实际导入结果必须在拥有桌面操控连接后，由用户单独授权并验证。

## 桌面导入限制

Qoder 桌面“从 Codex 导入”功能目前只能按类别（如任务记录、记忆等）整体导入，
**不能逐条选择任务或记录**。任何整批导入操作均需用户确认，并建议先备份现有会话数据。

## 回滚方式

如需清除本次实验产物，直接删除临时目录即可：

```bash
rm -rf /tmp/myolgame-import-test
```

项目仓库中的 `tools/qoder_history_to_codex.py`、测试文件与本文档可单独保留或删除，
与正式游戏运行无关。
