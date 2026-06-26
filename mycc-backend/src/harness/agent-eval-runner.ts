import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateAgentEvalCase,
  loadAgentEvalCase,
  type AgentEvalObservedResult,
  type AgentEvalReport,
} from './agent-eval.js';
import {
  setHarnessSpanStatus,
  startHarnessSpan,
} from './telemetry.js';

export type StaticAgentEvalCaseResult = AgentEvalReport & {
  casePath: string;
  observedPath: string;
};

export type StaticAgentEvalSuiteReport = {
  ok: boolean;
  root: string;
  reports: StaticAgentEvalCaseResult[];
};

export async function runStaticAgentEvalSuite(root: string): Promise<StaticAgentEvalSuiteReport> {
  const span = startHarnessSpan('mycc.agent_eval.suite', {
    'mycc.agent_eval.kind': 'static',
    'mycc.agent_eval.root': root,
  });

  try {
    const casePaths = await findAgentEvalCaseFiles(root);
    const reports = await Promise.all(casePaths.map(runStaticAgentEvalCase));
    const ok = reports.every((report) => report.ok);

    span.setAttributes({
      'mycc.agent_eval.case_count': reports.length,
      'mycc.agent_eval.failed_count': reports.filter((report) => !report.ok).length,
      'mycc.agent_eval.ok': ok,
    });
    setHarnessSpanStatus(span, ok ? 'ok' : 'error', ok ? 'passed' : 'failed');

    return {
      ok,
      root,
      reports,
    };
  } catch (error) {
    span.recordException(error);
    setHarnessSpanStatus(span, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    span.end();
  }
}

export async function findAgentEvalCaseFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'case.json') {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

async function runStaticAgentEvalCase(casePath: string): Promise<StaticAgentEvalCaseResult> {
  const span = startHarnessSpan('mycc.agent_eval.case', {
    'mycc.agent_eval.case_path': casePath,
    'mycc.agent_eval.kind': 'static',
  });

  try {
    const evalCase = await loadAgentEvalCase(casePath);
    const observedPath = path.join(path.dirname(casePath), 'observed.json');
    const observed = await loadObservedResult(observedPath);
    const report = evaluateAgentEvalCase(evalCase, observed);
    const failedChecks = report.checks.filter((check) => check.status === 'fail');

    span.setAttributes({
      'mycc.agent_eval.case_id': report.caseId,
      'mycc.agent_eval.check_count': report.checks.length,
      'mycc.agent_eval.failed_check_count': failedChecks.length,
      'mycc.agent_eval.observed_path': observedPath,
      'mycc.agent_eval.ok': report.ok,
    });
    for (const check of report.checks) {
      span.addEvent('mycc.agent_eval.check', {
        'mycc.agent_eval.case_id': report.caseId,
        'mycc.agent_eval.check_id': check.id,
        'mycc.agent_eval.check_status': check.status,
      });
    }
    setHarnessSpanStatus(span, report.ok ? 'ok' : 'error', report.ok ? 'passed' : 'failed');

    return {
      ...report,
      casePath,
      observedPath,
    };
  } catch (error) {
    span.recordException(error);
    setHarnessSpanStatus(span, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    span.end();
  }
}

async function loadObservedResult(filePath: string): Promise<AgentEvalObservedResult> {
  const raw = await readFile(filePath, 'utf8');
  const value = JSON.parse(raw) as AgentEvalObservedResult;
  return {
    finalResponse: typeof value.finalResponse === 'string' ? value.finalResponse : '',
    changedFiles: Array.isArray(value.changedFiles) ? value.changedFiles : [],
    events: Array.isArray(value.events) ? value.events : [],
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : [],
  };
}
