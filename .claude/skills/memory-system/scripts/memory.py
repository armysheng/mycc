#!/usr/bin/env python3
"""
记忆系统 - 基于 Obsidian 知识库的四层记忆管理

功能：
- recall: 检索相关记忆
- remember: 存入短期记忆
- consolidate: 沉淀到长期记忆
- forget: 清理过期记忆
"""

import os
import sys
import json
from datetime import datetime
from pathlib import Path

# 记忆库路径
MEMORY_BASE = Path(os.environ.get("MEMORY_PATH", "E:/AI/Obsidian/data/记忆/.memory"))
KNOWLEDGE_BASE = Path(os.environ.get("KNOWLEDGE_PATH", "E:/AI/Obsidian/data/记忆"))
LONG_TERM = MEMORY_BASE / "long"
SHORT_TERM = MEMORY_BASE / "short"
VECTOR_DB = MEMORY_BASE / "vectordb"

# 记忆文件
PREFERENCES_FILE = LONG_TERM / "preferences.md"
HABITS_FILE = LONG_TERM / "habits.md"
WORKFLOWS_FILE = LONG_TERM / "workflows.md"
SESSION_FILE = SHORT_TERM / "session.md"
RECENT_FILE = SHORT_TERM / "recent.md"


def ensure_dirs():
    """确保记忆目录存在"""
    LONG_TERM.mkdir(parents=True, exist_ok=True)
    SHORT_TERM.mkdir(parents=True, exist_ok=True)
    VECTOR_DB.mkdir(parents=True, exist_ok=True)


def append_to_file(filepath, content):
    """追加内容到文件"""
    ensure_dirs()
    filepath.parent.mkdir(parents=True, exist_ok=True)

    if not filepath.exists():
        filepath.touch()

    with open(filepath, 'a', encoding='utf-8') as f:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        f.write(f"\n## {timestamp}\n{content}\n")


def read_file(filepath):
    """读取文件内容"""
    if filepath.exists():
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    return ""


def recall(query=None):
    """
    检索相关记忆
    用法: recall [query]
    """
    ensure_dirs()

    memories = {
        "preferences": read_file(PREFERENCES_FILE),
        "habits": read_file(HABITS_FILE),
        "workflows": read_file(WORKFLOWS_FILE),
        "session": read_file(SESSION_FILE),
        "recent": read_file(RECENT_FILE)
    }

    if query:
        # 简单的关键词匹配（可以升级为向量检索）
        results = {}
        for name, content in memories.items():
            if query.lower() in content.lower():
                results[name] = content
        return json.dumps(results, ensure_ascii=False, indent=2)
    else:
        # 返回所有记忆
        return json.dumps(memories, ensure_ascii=False, indent=2)


def remember(content):
    """
    存入短期记忆
    用法: remember "内容"
    """
    ensure_dirs()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 存入会话记忆
    session_entry = f"\n## {timestamp}\n{content}\n"
    append_to_file(SESSION_FILE, session_entry)

    # 同时存入最近记忆
    recent_entry = f"\n## {timestamp}\n{content}\n"
    append_to_file(RECENT_FILE, recent_entry)

    return f"✓ 已记到短期记忆: {content[:50]}..."


def consolidate(content, category="preferences"):
    """
    沉淀到长期记忆
    用法: consolidate "内容" [category]
    category: preferences | habits | workflows
    """
    ensure_dirs()

    category_files = {
        "preferences": PREFERENCES_FILE,
        "habits": HABITS_FILE,
        "workflows": WORKFLOWS_FILE
    }

    target_file = category_files.get(category, PREFERENCES_FILE)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    entry = f"\n## {timestamp}\n{content}\n"
    append_to_file(target_file, entry)

    return f"✓ 已沉淀到长期记忆[{category}]: {content[:50]}..."


def forget(pattern):
    """
    清理过期记忆
    用法: forget "pattern"
    """
    ensure_dirs()

    # 清理短期记忆中的匹配内容
    for filepath in [SESSION_FILE, RECENT_FILE]:
        if filepath.exists():
            content = read_file(filepath)
            lines = content.split('\n')

            # 简单的模式匹配删除
            new_lines = [line for line in lines if pattern.lower() not in line.lower()]

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write('\n'.join(new_lines))

    return f"✓ 已清理包含 '{pattern}' 的记忆"


def snapshot():
    """
    生成记忆快照
    将长期记忆聚合到一个文件，方便 AI 一次读完
    """
    ensure_dirs()

    snapshot_content = f"""# 记忆快照

生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## 偏好 (preferences)
{read_file(PREFERENCES_FILE)}

## 习惯 (habits)
{read_file(HABITS_FILE)}

## 工作流程 (workflows)
{read_file(WORKFLOWS_FILE)}
"""

    snapshot_file = MEMORY_BASE / "snapshot.md"
    with open(snapshot_file, 'w', encoding='utf-8') as f:
        f.write(snapshot_content)

    return f"✓ 记忆快照已生成: {snapshot_file}"


def find_backlinks(note_name):
    """
    查找反向链接
    用法: find_backlinks "笔记名称"
    返回所有链接到该笔记的文件列表
    """
    ensure_dirs()

    # 搜索目标：[[笔记名]] 或 [[笔记名|显示名]]
    target_patterns = [f"[[{note_name}]]", f"[[{note_name}|"]

    backlinks = []

    # 在知识库中搜索
    for md_file in KNOWLEDGE_BASE.rglob("*.md"):
        try:
            content = read_file(md_file)
            for pattern in target_patterns:
                if pattern in content:
                    backlinks.append({
                        "file": str(md_file.relative_to(KNOWLEDGE_BASE)),
                        "path": str(md_file)
                    })
                    break
        except Exception:
            continue

    return json.dumps(backlinks, ensure_ascii=False, indent=2)


def link_memory_to_knowledge(memory_content, note_name):
    """
    将记忆链接到知识库笔记
    用法: link_memory_to_knowledge "记忆内容" "笔记名"
    自动创建双链：[[笔记名]]
    """
    ensure_dirs()

    # 自动添加双链
    linked_content = f"{memory_content} [[{note_name}]]"

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"\n## {timestamp}\n{linked_content}\n"
    append_to_file(SESSION_FILE, entry)

    return f"✓ 已记忆并链接到 [[{note_name}]]"


def search_notes(query):
    """
    在知识库中搜索笔记
    用法: search_notes "关键词"
    """
    ensure_dirs()

    results = []

    for md_file in KNOWLEDGE_BASE.rglob("*.md"):
        try:
            content = read_file(md_file)
            if query.lower() in content.lower():
                # 提取标题（第一个 # 标题）
                title = md_file.stem
                for line in content.split('\n')[:10]:
                    if line.startswith('#'):
                        title = line.lstrip('#').strip()
                        break

                results.append({
                    "title": title,
                    "file": str(md_file.relative_to(KNOWLEDGE_BASE)),
                    "path": str(md_file)
                })
        except Exception:
            continue

    return json.dumps(results, ensure_ascii=False, indent=2)


def main():
    if len(sys.argv) < 2:
        print("""
记忆系统 - 四层记忆管理 + 双链支持

用法:
  python memory.py recall [query]              - 检索记忆
  python memory.py remember "内容"            - 记到短期记忆
  python memory.py consolidate "内容"         - 沉淀到长期记忆
  python memory.py forget "pattern"           - 清理记忆
  python memory.py snapshot                   - 生成快照
  python memory.py backlink "笔记名"          - 查找反向链接
  python memory.py link "内容" "笔记名"       - 记忆并链接到笔记
  python memory.py search "关键词"            - 搜索知识库

示例:
  python memory.py recall "简洁"
  python memory.py remember "喜欢简洁直接的风格"
  python memory.py consolidate "以后都用简洁风格" preferences
  python memory.py forget "过时的信息"
  python memory.py backlink "Obsidian插件开发"
  python memory.py link "插件开发要注意热重载" "Obsidian插件开发"
  python memory.py search "插件"
        """)
        return

    command = sys.argv[1].lower()

    if command == "recall":
        query = sys.argv[2] if len(sys.argv) > 2 else None
        print(recall(query))

    elif command == "remember":
        if len(sys.argv) > 2:
            content = ' '.join(sys.argv[2:])
            print(remember(content))
        else:
            print("错误: 请提供要记忆的内容")

    elif command == "consolidate":
        if len(sys.argv) > 2:
            content = ' '.join(sys.argv[2:])
            category = sys.argv[3] if len(sys.argv) > 3 else "preferences"
            print(consolidate(content, category))
        else:
            print("错误: 请提供要沉淀的内容")

    elif command == "forget":
        if len(sys.argv) > 2:
            pattern = ' '.join(sys.argv[2:])
            print(forget(pattern))
        else:
            print("错误: 请提供要清理的模式")

    elif command == "snapshot":
        print(snapshot())

    elif command in ["backlink", "backlinks"]:
        if len(sys.argv) > 2:
            note_name = ' '.join(sys.argv[2:])
            print(find_backlinks(note_name))
        else:
            print("错误: 请提供笔记名称")

    elif command == "link":
        if len(sys.argv) > 3:
            content = sys.argv[2]
            note_name = ' '.join(sys.argv[3:])
            print(link_memory_to_knowledge(content, note_name))
        else:
            print("错误: 请提供内容和笔记名称")

    elif command == "search":
        if len(sys.argv) > 2:
            query = ' '.join(sys.argv[2:])
            print(search_notes(query))
        else:
            print("错误: 请提供搜索关键词")

    else:
        print(f"未知命令: {command}")


if __name__ == "__main__":
    main()
