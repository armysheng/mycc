# MyCC Harness Glossary

This document fixes the vocabulary for MyCC agent harness work. Use these terms consistently in code, docs, tests, and product copy.

## Core Objects

**Chat session**

A user-facing conversation thread. It owns visible messages, title, continuation behavior, and product-level history. A chat session may contain many agent runs.

**Agent run**

One execution of an agent runtime for a user request, resume, automation step, or verification task. It has a start, terminal status, runtime kind, inputs, streamed events, tool calls, artifacts, and verification results.

**SDK session**

The Claude Agent SDK session identifier used for resume inside the SDK. It belongs to the SDK transcript and must not be treated as the MyCC chat session id.

**Sandbox**

An isolated execution environment such as an E2B workspace. It can be created, resumed, snapshotted, checked for readiness, or destroyed. It is replaceable infrastructure, not the source of truth for conversation state.

**Workspace**

The user file space exposed to the agent. A workspace may live inside a sandbox, be mounted into one, or be restored from durable storage. Product code should avoid implying that every chat session has a dedicated workspace unless that mapping exists.

**Tool call**

A tool invocation made by the Claude Agent SDK or the bridge process. MyCC records the tool name, redacted input, redacted output summary, timing, and result status when available.

**Artifact**

Evidence or output produced by a run: file diffs, screenshots, logs, trace files, verification reports, preview URLs, generated documents, or deliverables.

**Verification**

A machine-checkable judgement that a run or sandbox is healthy: unit tests, contract tests, readiness probes, smoke checks, agent eval assertions, and release gates.

## Required Separations

- `chat session != agent run`
- `chat session != SDK session`
- `agent run != sandbox`
- `sandbox != workspace`
- `permission != sandbox isolation`
- `final answer != verification`

These separations let MyCC resume work, rebuild sandboxes, audit behavior, and evaluate agents without losing the durable record of what happened.
