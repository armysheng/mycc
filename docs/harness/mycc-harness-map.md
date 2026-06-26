# MyCC Harness Map

This map applies the ETCLOVG harness model to the current MyCC codebase and turns the research from OpenAI, Claude Agent SDK, LLM-Harness, and sandbox providers into an implementation roadmap.

## E: Execution

Current assets:

- `mycc-backend/src/agent-runtime/claude-agent-sdk-runtime.ts`
- `mycc-backend/src/agent-runtime/e2b-claude-agent-sdk-runtime.ts`
- `mycc-backend/src/agent-runtime/e2b-claude-cli-runtime.ts`
- `mycc-backend/src/ide/e2b-provider.ts`
- `mycc-sandbox/templates/e2b-assistant-sandbox/scripts/agent-sdk-bridge.mjs`

Target:

- Keep Claude Agent SDK as the primary agent loop.
- Treat E2B as the default sandbox provider, not the only possible execution abstraction.
- Add readiness checks before a sandbox is considered usable.
- Use `mycc-backend/src/sandbox` for provider-neutral sandbox vocabulary and readiness reports.
- Use `E2bSandboxProviderAdapter` as the first bridge from the existing E2B IDE provider into the provider-neutral harness interface.

## T: Tooling

Current assets:

- Claude Code tools through the Agent SDK.
- Sandbox bridge request files.
- Skill catalog and sandbox-preloaded skills.
- Workspace and IDE routes.

Target:

- Tool traces should be captured as first-class run events.
- Tool inputs and outputs should be redacted and truncated before storage.
- Permission rules should be enforced with SDK hooks or a MyCC wrapper layer.

## C: Context

Current assets:

- User workspace bootstrap files.
- `AGENTS.md` instructions from the environment.
- Chat history and onboarding context.
- `docs/process` and `docs/superpowers` design history.

Target:

- Keep durable context in versioned files or database records, not only in conversation memory.
- Add run summaries and artifacts that future agents can read.
- Use `docs/harness` as the entry point for harness architecture.

## L: Lifecycle

Current assets:

- Chat sessions and request ids.
- Abort handling.
- E2B IDE session reuse and expiry.
- Conversation continuation behavior.

Target:

- Introduce `agent_run` as the lifecycle unit for each execution.
- Track run status independently from chat session and sandbox status.
- Preserve SDK session ids as resume metadata.

## O: Observability

Current assets:

- Streamed runtime events.
- E2B smoke script output.
- Playwright traces in frontend E2E.
- IDE session status.

Target:

- Store run timelines in an `AgentRunStore`.
- Expose run events, tool calls, artifacts, and verification status to the workbench.
- Make trace recording best-effort so observability failures do not break user requests.
- Emit best-effort OpenTelemetry spans for agent runs, observed tool events, sandbox readiness, evals, and harness verifier targets through `mycc-backend/src/harness/telemetry.ts`.

## V: Verification

Current assets:

- Backend Vitest tests.
- Frontend Playwright E2E fixtures.
- Sandbox contract tests.
- E2B smoke and release-readiness scripts.

Target:

- Standardize a harness verifier that can run unit, contract, E2E, sandbox readiness, and agent eval targets.
- Add eval cases that judge final answer, tool trajectory, file state, and policy compliance.
- Use `npm run harness:verify` from `mycc-backend` as the first unified verifier entry point.
- Use `mycc-backend/src/harness/agent-eval.ts` for the first model-independent eval case schema and checker.
- Use `npm run harness:verify -- --target=agent-eval-static` to run checked-in static eval fixtures.
- Run the lightweight harness gate in CI with `npm run harness:verify -- --target=agent-eval-static,e2b-release --no-write`; keep provider-dependent doctors in the local/full release gate.

## G: Governance

Current assets:

- Permission mode parameters.
- Workspace path validation.
- Provider env redaction in tests.
- Error sanitization in selected routes.

Target:

- Add executable policy for dangerous tools, network levels, secret redaction, and approval gates.
- Keep credentials outside sandbox files where possible.
- Test governance rules as contracts.

## First Implementation Slice

1. Create the harness docs and glossary.
2. Add a generic `AgentRunStore` and trace recorder.
3. Wrap existing runtimes with a `TracedAgentRuntime`.
4. Keep the wrapper low-intrusion so existing runtime behavior remains unchanged.
5. Add tests proving trace timelines are recorded, terminal status is inferred, and secrets are redacted.

This slice moves MyCC from "can run an agent" to "can observe an agent" without forcing a sandbox provider rewrite.
