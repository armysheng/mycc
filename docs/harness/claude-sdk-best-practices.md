# Claude Agent SDK Best Practices For MyCC

MyCC uses the Claude Agent SDK as the agent loop runtime. We should not reimplement the loop, message protocol, or base permission primitives. MyCC's harness layer should productize the SDK into a durable, observable, governed, and testable platform.

## Runtime Boundary

Claude Agent SDK owns:

- Agent loop execution.
- Claude Code tool semantics.
- SDK session resume.
- SDK messages and result events.
- Base permission modes and tool policy hooks.

MyCC owns:

- Chat sessions and product history.
- Durable run trace and audit storage.
- Sandbox provisioning and readiness.
- Secret handling and redaction.
- Workspace lifecycle and artifacts.
- Agent evals and release verification.
- User-facing workbench visibility.

## Session Model

Persist MyCC state outside the sandbox. The sandbox can fail or be rebuilt; the durable record is the chat session, agent run trace, artifacts, and verification evidence.

Use the SDK session id for SDK resume only. Store it as metadata on an agent run and mirror it into durable storage, but do not use it as the MyCC chat session id.

## Hooks And Governance

Use SDK hooks and MyCC wrapper hooks for:

- `PreToolUse`: permission checks, dangerous command guards, input redaction, approval routing.
- `PostToolUse`: output truncation, artifact extraction, tool timing, result status.
- `Stop`: terminal status, usage, summary, verification trigger.
- `PreCompact`: preserve MyCC context that must survive compaction.
- `SubagentStart` / `SubagentStop`: subtask boundaries and trace grouping when subagents are enabled.

Rules should be executable and covered by contract tests. Do not rely on prompt-only reminders for security, redaction, or architecture boundaries.

The first MyCC SDK hook is implemented in `mycc-backend/src/agent-runtime/claude-hooks.ts`: a `PreToolUse` guard that denies obviously dangerous Bash commands before execution.

## Trace Requirements

Every agent run should produce a timeline that is useful to both humans and future agents:

- Run start and finish.
- Runtime kind and execution environment.
- User id, request id, chat session id, cwd, permission mode.
- SDK session id when known.
- Streamed SDK events.
- Tool calls and tool results when available.
- Errors after redaction.
- Token, cost, and duration when available.
- Artifacts and verification results.

Trace recording must be best-effort. A trace store failure should not break the user-facing agent run.

The first durable trace store is `PostgresAgentRunStore`, backed by `db/migrations/007-add-agent-run-trace.sql`. P2+ environments should apply migrations before startup and set `MYCC_AGENT_RUN_STORE=postgres` so run traces survive process restarts. The in-memory store remains a local fallback only.

## OpenTelemetry Requirements

Harness telemetry is implemented in `mycc-backend/src/harness/telemetry.ts`. It uses the OpenTelemetry API global tracer, so it is a no-op until the process installs an OTEL provider/exporter. This keeps instrumentation safe for local development and production paths that have not configured an exporter yet.

Current span coverage:

- `mycc.agent_run`: one span per traced agent run.
- `mycc.agent_tool`: short spans for tool-use and tool-result events observed in SDK stream events.
- `mycc.sandbox_readiness`: sandbox readiness probe summary and per-check events.
- `mycc.agent_eval.suite` and `mycc.agent_eval.case`: static eval suite and case outcomes.
- `mycc.harness_verify` and `mycc.harness_verify.target`: verifier run and target outcomes.

Telemetry attributes are sanitized before reaching OpenTelemetry. Secret-looking keys are redacted and long values are truncated. Set `MYCC_HARNESS_OTEL=false` or `MYCC_OTEL_ENABLED=false` to disable harness spans without disabling trace storage.

## Sandbox Requirements

Keep provider-specific sandbox code behind a provider boundary. E2B is the current default provider, but MyCC should not spread E2B-specific assumptions through chat routes, agent runtime code, or eval harnesses.

Sandbox readiness is separate from sandbox creation. A sandbox is ready only after required directories, runtime files, tools, ports, skills, and probes pass.

`mycc-backend/src/sandbox/provider.ts` defines the provider-neutral vocabulary. `E2bSandboxProviderAdapter` bridges the existing E2B IDE provider into that interface without storing E2B traffic tokens on the generic `SandboxSession`.

## Evaluation Requirements

Agent evals should judge final response, trajectory, and state:

- Did the agent call the expected tools?
- Did it avoid forbidden tools or dangerous commands?
- Did files change as expected?
- Were secrets and low-level provider details hidden?
- Did artifacts and verification commands pass?
- Can the run be resumed or inspected later?

Static model-independent evals live under `evals/agent/*`. Each case pairs `case.json` with `observed.json` and is runnable through `npm run eval:agent-static` or the unified `npm run harness:verify -- --target=agent-eval-static`.

This is the practical harness layer on top of the Claude Agent SDK.

## Release Gate

CI runs the lightweight harness gate:

```bash
npm run harness:verify -- --target=agent-eval-static,e2b-release --no-write
```

The full local release gate remains:

```bash
npm run harness:verify -- --target=release
```

The full gate includes provider doctors and sandbox template checks that may need local credentials or published template state, so it should be used before environment-specific releases rather than as the default PR gate.
