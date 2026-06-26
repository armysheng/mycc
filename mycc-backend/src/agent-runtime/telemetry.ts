export type RuntimeSpanStatus = 'ok' | 'error' | 'unset';

export type RuntimeSpanHandle = {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
  recordException(error: unknown): void;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
  setStatus(status: RuntimeSpanStatus, message?: string): void;
};

export function startRuntimeSpan(
  _name: string,
  _attributes: Record<string, unknown> = {},
): RuntimeSpanHandle {
  return noopRuntimeSpan;
}

export function setRuntimeSpanStatus(
  span: RuntimeSpanHandle,
  status: RuntimeSpanStatus,
  message?: string,
): void {
  span.setStatus(status, message);
}

const noopRuntimeSpan: RuntimeSpanHandle = {
  addEvent: () => {},
  end: () => {},
  recordException: () => {},
  setAttribute: () => {},
  setAttributes: () => {},
  setStatus: () => {},
};
