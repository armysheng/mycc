---
name: api-debug
description: API 开发调试工具，构造请求、解析响应、生成文档和客户端代码
version: 1.0.0
source: mycc-marketplace
triggers:
  - /api-debug
---

## Overview

api-debug 是 API 开发和调试的一站式工具。给它一个接口地址或 API 文档，它能帮你构造完整的 HTTP 请求，包括 headers、认证信息和请求体。支持 REST 和 GraphQL 两种风格，直接生成可执行的 curl 命令，复制粘贴就能跑。

调试接口时，api-debug 会格式化并高亮响应数据，快速定位异常字段。遇到错误状态码，它会根据响应内容分析可能的原因——是参数格式不对、认证过期，还是服务端逻辑出了问题，给出针对性的排查建议。

在接口开发完成后，api-debug 还能根据实际的请求和响应生成 API 文档片段，包括参数说明、响应结构和错误码列表。它也支持生成主流语言的客户端调用代码（JavaScript fetch、Python requests、Go http 等），方便前后端联调和接口对接。

## 示例

> 帮我调试这个 API 接口
> 生成一个 POST 请求
> 把这个 API 的响应格式化
