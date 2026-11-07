#!/usr/bin/env python3
"""Qoder CLI JSONL 历史转换为 Codex rollout JSONL。

本工具为局部兼容性实验，仅读取显式传入的 Qoder JSONL 文件，输出独立的
Codex rollout JSONL。默认执行 dry-run（输出到 stdout），可通过 --output-dir
指定写入目录。不访问应用内部数据库，不修改现有会话，不写 ~/.codex。

转换规则：
- 仅保留 role/type 为 user/assistant 的可见文本消息；
- 仅转换文本内容块，跳过 thinking、tool_result、signature、image_url 等；
- 同一 message id 内对重复文本块去重；
- 过滤空消息后输出；
- 生成新的 uuid4 session id，文件命名与会话时间一致；
- 输出首行为 session_meta，随后为 response_item 消息行。
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone


# 允许转换的角色
_ALLOWED_ROLES = {"user", "assistant"}

# 视为可见文本的块类型
_TEXT_BLOCK_TYPES = {"text", "input_text", "output_text"}

# Qoder 记录中可能表示角色的字段，按优先级尝试
_ROLE_FIELDS = ("role", "type", "actor", "sender")

# Qoder 记录中可能表示时间的字段
_TIME_FIELDS = ("timestamp", "created_at", "time", "ts")

# Qoder 记录中可能表示消息 id 的字段
_ID_FIELDS = ("id", "message_id", "msg_id")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="将 Qoder CLI JSONL 历史转换为 Codex rollout JSONL（实验性）。",
    )
    parser.add_argument(
        "input",
        help="输入的 Qoder JSONL 文件路径。",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="输出目录；未指定时执行 dry-run，将结果打印到 stdout。",
    )
    parser.add_argument(
        "--cwd",
        default="/home/sakara/MYolGame",
        help="会话工作目录，写入 session_meta。",
    )
    parser.add_argument(
        "--emit-events",
        action="store_true",
        help="同时为每条消息输出 event_msg 行（user_message/agent_message），"
             "仅用于展示兼容，不增加消息内容。",
    )
    return parser.parse_args()


def _now_iso() -> str:
    """返回当前 UTC ISO 8601 字符串。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _filename_timestamp() -> str:
    """返回用于文件名的 UTC 时间字符串。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")


def _resolve_role(record: dict) -> str | None:
    """从记录中解析 user/assistant 角色，无法识别则返回 None。"""
    for key in _ROLE_FIELDS:
        value = record.get(key)
        if isinstance(value, str):
            normalized = value.lower()
            if normalized in _ALLOWED_ROLES:
                return normalized
    return None


def _resolve_timestamp(record: dict, fallback: str) -> str:
    """从记录中解析时间戳，失败则返回 fallback。"""
    for key in _TIME_FIELDS:
        ts = record.get(key)
        if ts is None:
            continue
        if isinstance(ts, (int, float)):
            # 毫秒时间戳常见长度大于 12 位
            if ts > 1e12:
                ts = ts / 1000.0
            try:
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except (ValueError, OSError):
                continue
        if isinstance(ts, str):
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                # 保持原始字符串作为最后手段
                return ts
    return fallback


def _resolve_message_id(record: dict) -> str:
    """从记录中解析消息 id，用于同一消息内文本去重。"""
    for key in _ID_FIELDS:
        value = record.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _make_text_block(role: str, text: str) -> dict:
    """根据角色生成 Codex 内容块。"""
    if role == "user":
        return {"type": "input_text", "text": text}
    return {"type": "output_text", "text": text}


def _extract_text_blocks(record: dict, role: str) -> tuple[list[dict], int]:
    """提取记录中的可见文本块，返回 (blocks, unsupported_count)。

    跳过 thinking、tool_result、image_url、signature 等非文本块；
    同一 message id 内对重复文本去重；过滤空文本。
    """
    content = record.get("content")
    blocks: list[dict] = []
    unsupported_count = 0
    seen_texts: set[str] = set()
    msg_id = _resolve_message_id(record)

    def _add_text(text: str) -> None:
        text = text.strip()
        if not text:
            return
        # 同一 message id 内去重
        dedup_key = f"{msg_id}::{text}"
        if dedup_key in seen_texts:
            return
        seen_texts.add(dedup_key)
        blocks.append(_make_text_block(role, text))

    if isinstance(content, str):
        _add_text(content)
        return blocks, unsupported_count

    if isinstance(content, dict):
        content = [content]

    if not isinstance(content, list):
        # 无法识别的内容格式，计为不支持
        return blocks, unsupported_count + 1

    for block in content:
        if not isinstance(block, dict):
            unsupported_count += 1
            continue
        btype = (block.get("type") or "").lower()
        text = block.get("text")
        if btype in _TEXT_BLOCK_TYPES:
            if isinstance(text, str):
                _add_text(text)
            else:
                unsupported_count += 1
        else:
            # thinking、tool_result、signature、image_url 等均跳过并计数
            unsupported_count += 1

    return blocks, unsupported_count


def _build_session_meta(session_id: str, ts: str, cwd: str) -> dict:
    """构造首行 session_meta。"""
    return {
        "timestamp": ts,
        "type": "session_meta",
        "payload": {
            "id": session_id,
            "timestamp": ts,
            "cwd": cwd,
            "originator": "qoder-cli-history-converter",
            "cli_version": "migration-test",
            "source": "cli",
            "model_provider": "external",
            "migration": {
                "source": "qoder-cli",
                "synthetic": True,
            },
        },
    }


def _build_response_item(role: str, ts: str, blocks: list[dict]) -> dict:
    """构造 response_item 消息行。"""
    payload: dict = {
        "type": "message",
        "role": role,
        "content": blocks,
    }
    if role == "assistant":
        payload["phase"] = "final"
    return {"timestamp": ts, "type": "response_item", "payload": payload}


def _build_event_msg(role: str, ts: str, blocks: list[dict]) -> dict:
    """构造 event_msg 展示事件行（与 response_item 同行对应，不新增消息）。"""
    joined_text = " ".join(block["text"] for block in blocks)
    event_type = "user_message" if role == "user" else "agent_message"
    return {
        "timestamp": ts,
        "type": "event_msg",
        "payload": {
            "type": event_type,
            "role": role,
            "text": joined_text,
        },
    }


def convert(
    input_path: str,
    *,
    output_dir: str | None = None,
    cwd: str = "/home/sakara/MYolGame",
    emit_events: bool = False,
) -> tuple[list[dict], str, dict]:
    """执行转换，返回 (输出行, session_id, 统计信息)。"""
    session_id = str(uuid.uuid4())
    session_ts = _now_iso()
    out_lines: list[dict] = []
    stats = {
        "input_lines": 0,
        "converted_messages": 0,
        "filtered_messages": 0,
        "unsupported_blocks": 0,
        "output_path": None,
    }

    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            stats["input_lines"] += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                stats["filtered_messages"] += 1
                continue

            role = _resolve_role(record)
            if role is None:
                # 系统消息、thinking 记录、工具输出等直接跳过
                stats["filtered_messages"] += 1
                continue

            msg_ts = _resolve_timestamp(record, session_ts)
            blocks, unsupported = _extract_text_blocks(record, role)
            stats["unsupported_blocks"] += unsupported

            if not blocks:
                stats["filtered_messages"] += 1
                continue

            stats["converted_messages"] += 1
            out_lines.append(_build_response_item(role, msg_ts, blocks))
            if emit_events:
                out_lines.append(_build_event_msg(role, msg_ts, blocks))

    meta = _build_session_meta(session_id, session_ts, cwd)
    out_lines.insert(0, meta)

    if output_dir:
        stats["output_path"] = _write_output(out_lines, output_dir, session_id)

    return out_lines, session_id, stats


def _write_output(out_lines: list[dict], output_dir: str, session_id: str) -> str:
    """将转换结果写入指定目录，返回输出文件绝对路径。"""
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{_filename_timestamp()}-{session_id}.jsonl"
    out_path = os.path.join(output_dir, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        for line in out_lines:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    return os.path.abspath(out_path)


def main() -> int:
    args = _parse_args()
    out_lines, session_id, stats = convert(
        args.input,
        output_dir=args.output_dir,
        cwd=args.cwd,
        emit_events=args.emit_events,
    )

    if args.output_dir:
        print(f"已生成 Codex rollout: {stats['output_path']}")
        print(f"会话 ID: {session_id}")
        print(
            f"统计: 输入行 {stats['input_lines']}, "
            f"转换消息 {stats['converted_messages']}, "
            f"跳过/过滤 {stats['filtered_messages']}, "
            f"不支持块 {stats['unsupported_blocks']}"
        )
    else:
        # dry-run：输出到 stdout，便于人工检查
        for line in out_lines:
            print(json.dumps(line, ensure_ascii=False))
        print(
            f"\n# dry-run 统计: 输入行 {stats['input_lines']}, "
            f"转换消息 {stats['converted_messages']}, "
            f"跳过/过滤 {stats['filtered_messages']}, "
            f"不支持块 {stats['unsupported_blocks']}",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
