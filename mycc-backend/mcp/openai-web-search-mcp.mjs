#!/usr/bin/env node
/**
 * OpenAI Web Search MCP Server (stdio)
 *
 * Exposes one MCP tool:
 * - web_search(query, max_results?)
 *
 * Env:
 * - OPENAI_API_KEY (required)
 * - OPENAI_BASE_URL (optional, default: https://api.openai.com/v1)
 * - OPENAI_SEARCH_MODEL (optional, default: gpt-4o-mini-search-preview)
 * - OPENAI_SEARCH_TOOL_TYPE (optional, default: web_search)
 * - OPENAI_SEARCH_TIMEOUT_MS (optional, default: 45000)
 * - OPENAI_SEARCH_EXTERNAL_WEB_ACCESS (optional, true/false)
 */

import process from "node:process";

const SERVER_NAME = "mycc-openai-search";
const SERVER_VERSION = "0.1.0";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_SEARCH_MODEL =
  process.env.OPENAI_SEARCH_MODEL || "gpt-4o-mini-search-preview";
const OPENAI_SEARCH_TOOL_TYPE =
  process.env.OPENAI_SEARCH_TOOL_TYPE || "web_search";
const OPENAI_SEARCH_TIMEOUT_MS = Number.parseInt(
  process.env.OPENAI_SEARCH_TIMEOUT_MS || "45000",
  10,
);
const OPENAI_SEARCH_EXTERNAL_WEB_ACCESS =
  process.env.OPENAI_SEARCH_EXTERNAL_WEB_ACCESS;
const OPENAI_ALLOW_EMPTY_API_KEY = parseBool(
  process.env.OPENAI_ALLOW_EMPTY_API_KEY,
  false,
);

function writeRpcMessage(message) {
  const body = JSON.stringify(message);
  const bytes = Buffer.byteLength(body, "utf8");
  const header = `Content-Length: ${bytes}\r\nContent-Type: application/json\r\n\r\n`;
  process.stdout.write(header + body);
}

function writeResult(id, result) {
  writeRpcMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message, data) {
  writeRpcMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

function parseBool(value, defaultValue) {
  if (typeof value !== "string") return defaultValue;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return defaultValue;
}

function stripControlChars(input) {
  return String(input).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
}

function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const item of results) {
    const key = `${item.url || ""}|${item.title || ""}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function collectSearchResultsFromNode(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectSearchResultsFromNode(item, out);
    return;
  }

  const record = node;
  if (Array.isArray(record.results)) {
    for (const item of record.results) {
      if (!item || typeof item !== "object") continue;
      const url = stripControlChars(item.url || item.link || "");
      const title = stripControlChars(item.title || "");
      const snippet = stripControlChars(item.snippet || item.description || "");
      if (url) out.push({ title, url, snippet });
    }
  }

  for (const value of Object.values(record)) {
    collectSearchResultsFromNode(value, out);
  }
}

function extractOutputText(responseJson) {
  if (typeof responseJson?.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const texts = [];
  const output = Array.isArray(responseJson?.output) ? responseJson.output : [];
  for (const item of output) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === "string" && content.text.trim()) {
        texts.push(content.text.trim());
      }
    }
  }
  return texts.join("\n\n").trim();
}

async function callOpenAIWebSearch(query, maxResults) {
  if (!OPENAI_API_KEY && !OPENAI_ALLOW_EMPTY_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置");
  }

  const tool = { type: OPENAI_SEARCH_TOOL_TYPE };
  if (OPENAI_SEARCH_TOOL_TYPE === "web_search") {
    tool.external_web_access = parseBool(
      OPENAI_SEARCH_EXTERNAL_WEB_ACCESS,
      true,
    );
  }

  const payload = {
    model: OPENAI_SEARCH_MODEL,
    input: `请搜索并回答：${query}\n\n要求：\n1. 给出简洁结论\n2. 附上关键来源 URL\n3. 如果信息不确定，明确说明`,
    tools: [tool],
    tool_choice: "auto",
    include: ["web_search_call.results"],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_SEARCH_TIMEOUT_MS);
  try {
    const headers = {
      "Content-Type": "application/json",
    };
    if (OPENAI_API_KEY) {
      headers.Authorization = `Bearer ${OPENAI_API_KEY}`;
    }

    const resp = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenAI API ${resp.status}: ${body.slice(0, 1200)}`);
    }

    const json = await resp.json();
    const answer = extractOutputText(json);

    const rawResults = [];
    collectSearchResultsFromNode(json, rawResults);
    const deduped = dedupeResults(rawResults);
    const limited = deduped.slice(0, maxResults);

    let text = answer || "未返回可读答案。";
    if (limited.length > 0) {
      const sources = limited
        .map((r, idx) => {
          const title = r.title || `Source ${idx + 1}`;
          return `${idx + 1}. ${title}\n   ${r.url}${
            r.snippet ? `\n   ${r.snippet}` : ""
          }`;
        })
        .join("\n");
      text += `\n\nSources:\n${sources}`;
    }

    return { text, sourceCount: limited.length };
  } finally {
    clearTimeout(timer);
  }
}

function validateWebSearchArgs(args) {
  const query = stripControlChars(args?.query || "");
  const maxRaw = Number.parseInt(String(args?.max_results || "5"), 10);
  const maxResults = Number.isFinite(maxRaw)
    ? Math.max(1, Math.min(10, maxRaw))
    : 5;

  if (!query) {
    throw new Error("query 不能为空");
  }
  return { query, maxResults };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (typeof method !== "string") {
    writeError(id ?? null, -32600, "Invalid Request: method is required");
    return;
  }

  // Notifications do not require a response.
  const isNotification = id === undefined || id === null;

  try {
    if (method === "initialize") {
      if (isNotification) return;
      const protocolVersion =
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : "2025-06-18";
      writeResult(id, {
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      return;
    }

    if (method === "ping") {
      if (isNotification) return;
      writeResult(id, {});
      return;
    }

    if (method === "tools/list") {
      if (isNotification) return;
      writeResult(id, {
        tools: [
          {
            name: "web_search",
            description:
              "通过 OpenAI Web Search 工具进行互联网搜索，返回结论和来源链接。",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "搜索问题，例如：今天 AI 领域有什么重要新闻？",
                },
                max_results: {
                  type: "integer",
                  minimum: 1,
                  maximum: 10,
                  description: "返回来源条数，默认 5。",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
        ],
      });
      return;
    }

    if (method === "tools/call") {
      if (isNotification) return;
      const name = params?.name;
      if (name !== "web_search") {
        writeError(id, -32602, `Unknown tool: ${String(name)}`);
        return;
      }

      const { query, maxResults } = validateWebSearchArgs(params?.arguments || {});
      const result = await callOpenAIWebSearch(query, maxResults);
      writeResult(id, {
        content: [
          {
            type: "text",
            text: result.text,
          },
        ],
      });
      return;
    }

    if (isNotification) return;
    writeError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    if (isNotification) return;
    writeResult(id, {
      content: [
        {
          type: "text",
          text: `搜索失败: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    });
  }
}

function readContentLength(headerText) {
  const lines = headerText.split("\r\n");
  for (const line of lines) {
    const m = /^content-length:\s*(\d+)$/i.exec(line.trim());
    if (m) {
      return Number.parseInt(m[1], 10);
    }
  }
  return null;
}

let stdinBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);

  while (true) {
    const headerEnd = stdinBuffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;

    const header = stdinBuffer.slice(0, headerEnd).toString("utf8");
    const contentLength = readContentLength(header);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      // Invalid frame; drop buffer to avoid infinite loop.
      stdinBuffer = Buffer.alloc(0);
      return;
    }

    const total = headerEnd + 4 + contentLength;
    if (stdinBuffer.length < total) return;

    const body = stdinBuffer
      .slice(headerEnd + 4, total)
      .toString("utf8");
    stdinBuffer = stdinBuffer.slice(total);

    let message;
    try {
      message = JSON.parse(body);
    } catch {
      writeError(null, -32700, "Parse error");
      continue;
    }

    Promise.resolve(handleRequest(message)).catch((err) => {
      writeError(message?.id ?? null, -32603, `Internal error: ${String(err)}`);
    });
  }
});

process.stdin.resume();
