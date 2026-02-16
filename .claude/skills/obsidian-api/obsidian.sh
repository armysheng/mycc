#!/bin/bash
# Obsidian API 工具脚本

API_URL="https://127.0.0.1:27124"
API_KEY="63b2fc8cfcd49d66486cab083c676cf22816fd271f8315d0b3461a33108f8c8f"

# 列出目录
list() {
    local path="${1:-}"
    curl -k -s "$API_URL/vault/$path" \
        -H "Authorization: Bearer $API_KEY"
}

# 读取笔记
read() {
    local path="$1"
    curl -k -s "$API_URL/vault/$path" \
        -H "Authorization: Bearer $API_KEY"
}

# 创建/更新笔记
write() {
    local path="$1"
    local content="$2"
    curl -k -s -X PUT "$API_URL/vault/$path" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: text/markdown" \
        -d "$content"
}

# 删除笔记
delete() {
    local path="$1"
    curl -k -s -X DELETE "$API_URL/vault/$path" \
        -H "Authorization: Bearer $API_KEY"
}

# 主函数
case "$1" in
    list) list "$2" ;;
    read) read "$2" ;;
    write) write "$2" "$3" ;;
    delete) delete "$2" ;;
    *) echo "Usage: $0 {list|read|write|delete} [path] [content]" ;;
esac
