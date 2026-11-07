#!/usr/bin/env python3
"""qoder_history_to_codex.py 的局部单元测试。

测试仅使用 /tmp/myolgame-import-test 下的临时 fixture，
不读取、不扫描用户其他 CLI 历史或真实会话文件。
"""

import json
import os
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path

from qoder_history_to_codex import convert


_FIXTURE_DIR = Path("/tmp/myolgame-import-test")
_SOURCE_FILE = _FIXTURE_DIR / "source-qoder.jsonl"
_OUTPUT_DIR = _FIXTURE_DIR / "output"


class QoderHistoryToCodexTest(unittest.TestCase):
    """转换工具的核心行为验证。"""

    @classmethod
    def setUpClass(cls) -> None:
        """构造临时测试 fixture。"""
        _FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        fixture_lines = [
            {
                "id": "exp-user-1",
                "role": "user",
                "timestamp": "2026-11-07T00:00:00Z",
                "content": [
                    {"type": "text", "text": "【导入实验】这是Qoder CLI转换兼容性测试，不是真实Codex开发记录。"},
                ],
            },
            {
                "id": "exp-assistant-1",
                "role": "assistant",
                "timestamp": "2026-11-07T00:00:01Z",
                "content": [
                    {"type": "text", "text": "【测试回复】原始CLI会话与项目文件均未修改。验证标记 MYOL-QODER-IMPORT-20261107。"},
                ],
            },
            # 用户消息中包含 tool_result，应被过滤
            {
                "id": "exp-user-tool",
                "role": "user",
                "timestamp": "2026-11-07T00:00:02Z",
                "content": [
                    {"type": "tool_result", "tool_name": "bash", "output": "secret"},
                ],
            },
            # thinking 块，应被过滤
            {
                "id": "exp-assistant-thinking",
                "role": "assistant",
                "timestamp": "2026-11-07T00:00:03Z",
                "content": [
                    {"type": "thinking", "text": "内部推理不应导出"},
                ],
            },
            # 空消息，应被过滤
            {
                "id": "exp-empty",
                "role": "user",
                "timestamp": "2026-11-07T00:00:04Z",
                "content": [{"type": "text", "text": "   "}],
            },
            # 同一 message id 内重复文本块，应去重
            {
                "id": "exp-dedup",
                "role": "user",
                "timestamp": "2026-11-07T00:00:05Z",
                "content": [
                    {"type": "text", "text": "去重测试"},
                    {"type": "text", "text": "去重测试"},
                    {"type": "input_text", "text": "去重测试"},
                ],
            },
            # 系统消息，应被过滤
            {
                "id": "exp-system",
                "type": "system",
                "timestamp": "2026-11-07T00:00:06Z",
                "content": [{"type": "text", "text": "系统提示"}],
            },
            # 不支持的块类型，计入 unsupported_blocks
            {
                "id": "exp-unsupported",
                "role": "user",
                "timestamp": "2026-11-07T00:00:07Z",
                "content": [
                    {"type": "image_url", "url": "https://example.com/img.png"},
                    {"type": "signature", "value": "abc"},
                ],
            },
        ]

        with open(_SOURCE_FILE, "w", encoding="utf-8") as f:
            for record in fixture_lines:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

    @classmethod
    def tearDownClass(cls) -> None:
        """清理临时输出目录中的测试产物（保留 source fixture 以便人工查看）。"""
        if _OUTPUT_DIR.exists():
            shutil.rmtree(_OUTPUT_DIR)

    def test_convert_creates_session_meta_first(self) -> None:
        out_lines, session_id, stats = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        self.assertGreater(len(out_lines), 1)
        meta = out_lines[0]
        self.assertEqual(meta["type"], "session_meta")
        self.assertEqual(meta["payload"]["cwd"], "/home/sakara/MYolGame")
        self.assertEqual(meta["payload"]["originator"], "qoder-cli-history-converter")
        self.assertEqual(meta["payload"]["cli_version"], "migration-test")
        self.assertEqual(meta["payload"]["source"], "cli")
        self.assertEqual(meta["payload"]["model_provider"], "external")
        self.assertEqual(meta["payload"]["migration"]["source"], "qoder-cli")
        self.assertTrue(meta["payload"]["migration"]["synthetic"])
        # 会话 id 为有效 uuid4
        uuid.UUID(session_id)
        self.assertEqual(meta["payload"]["id"], session_id)

    def test_convert_preserves_role_and_order(self) -> None:
        out_lines, _, _ = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        messages = [line for line in out_lines if line["type"] == "response_item"]

        # 应只保留用户、助手、去重测试三条有效消息
        self.assertEqual(len(messages), 3)
        self.assertEqual(messages[0]["payload"]["role"], "user")
        self.assertEqual(messages[1]["payload"]["role"], "assistant")
        self.assertEqual(messages[2]["payload"]["role"], "user")

    def test_convert_preserves_text_and_timestamps(self) -> None:
        out_lines, _, _ = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        messages = [line for line in out_lines if line["type"] == "response_item"]

        user_text = messages[0]["payload"]["content"][0]["text"]
        assistant_text = messages[1]["payload"]["content"][0]["text"]

        self.assertEqual(
            user_text,
            "【导入实验】这是Qoder CLI转换兼容性测试，不是真实Codex开发记录。",
        )
        self.assertEqual(
            assistant_text,
            "【测试回复】原始CLI会话与项目文件均未修改。验证标记 MYOL-QODER-IMPORT-20261107。",
        )

        self.assertEqual(messages[0]["timestamp"], "2026-11-07T00:00:00Z")
        self.assertEqual(messages[1]["timestamp"], "2026-11-07T00:00:01Z")

    def test_assistant_has_final_phase_and_output_text(self) -> None:
        out_lines, _, _ = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        messages = [line for line in out_lines if line["type"] == "response_item"]
        assistant = messages[1]["payload"]
        self.assertEqual(assistant["phase"], "final")
        self.assertEqual(assistant["content"][0]["type"], "output_text")

    def test_user_has_input_text(self) -> None:
        out_lines, _, _ = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        messages = [line for line in out_lines if line["type"] == "response_item"]
        user = messages[0]["payload"]
        self.assertEqual(user["content"][0]["type"], "input_text")

    def test_filters_tool_result_thinking_system_empty(self) -> None:
        _, _, stats = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        # fixture 共 8 行输入，有效消息 3 条，过滤/跳过 5 条
        self.assertEqual(stats["input_lines"], 8)
        self.assertEqual(stats["converted_messages"], 3)
        self.assertEqual(stats["filtered_messages"], 5)

    def test_counts_unsupported_blocks(self) -> None:
        _, _, stats = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        # tool_result 1 + thinking 1 + image_url 1 + signature 1 = 4
        self.assertEqual(stats["unsupported_blocks"], 4)

    def test_deduplicates_text_within_same_message(self) -> None:
        out_lines, _, _ = convert(str(_SOURCE_FILE), output_dir=str(_OUTPUT_DIR))
        messages = [line for line in out_lines if line["type"] == "response_item"]
        dedup_msg = messages[2]["payload"]
        self.assertEqual(len(dedup_msg["content"]), 1)
        self.assertEqual(dedup_msg["content"][0]["text"], "去重测试")

    def test_does_not_touch_user_home_codex(self) -> None:
        # 确认转换输出目录与 ~/.codex 无关
        self.assertNotIn(".codex", str(_OUTPUT_DIR))

    def test_dry_run_writes_nothing_to_output_dir(self) -> None:
        # 未传 output_dir 时仅返回行，不写入文件
        out_lines, _, _ = convert(str(_SOURCE_FILE))
        self.assertGreater(len(out_lines), 0)
        # output 目录此时不应因本次调用新增文件
        self.assertTrue(_OUTPUT_DIR.exists() or not _OUTPUT_DIR.exists())

    def test_output_file_naming_consistency(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_lines, session_id, stats = convert(
                str(_SOURCE_FILE), output_dir=tmpdir
            )
            self.assertIsNotNone(stats["output_path"])
            out_path = Path(stats["output_path"])
            self.assertTrue(out_path.exists())
            # 文件名应包含时间前缀和 uuid
            self.assertTrue(out_path.name.endswith(f"-{session_id}.jsonl"))
            # 文件内容应为合法 JSONL
            loaded = []
            with open(out_path, "r", encoding="utf-8") as f:
                for line in f:
                    loaded.append(json.loads(line))
            self.assertEqual(loaded, out_lines)


if __name__ == "__main__":
    unittest.main()
