export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export class ApiCommunicationError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "ApiCommunicationError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancellationReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.aborted ? signal.reason : undefined;
}

function rethrowTransportError(
  error: unknown,
  signal: AbortSignal | null | undefined,
): never {
  const reason = cancellationReason(signal);
  if (reason !== undefined) {
    throw reason;
  }
  if (isAbortError(error)) {
    throw error;
  }
  if (error instanceof TypeError) {
    throw new ApiCommunicationError("Request communication failed", {
      cause: error,
    });
  }
  throw error;
}

function fallbackError(response: Response): string {
  return response.statusText;
}

function parseErrorBody(response: Response, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string"
      ? parsed.error
      : fallbackError(response);
  } catch {
    return fallbackError(response);
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const requestSignal = input instanceof Request ? input.signal : undefined;
  const signal =
    init?.signal === undefined
      ? requestSignal
      : (init.signal as AbortSignal | null);

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    rethrowTransportError(error, signal);
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    const reason = cancellationReason(signal);
    if (reason !== undefined) {
      throw reason;
    }
    if (isAbortError(error)) {
      throw error;
    }
    if (!response.ok && error instanceof TypeError) {
      return {
        error: fallbackError(response),
        ok: false,
        status: response.status,
      };
    }
    rethrowTransportError(error, signal);
  }

  if (!response.ok) {
    return {
      error: parseErrorBody(response, body),
      ok: false,
      status: response.status,
    };
  }

  return { data: JSON.parse(body) as T, ok: true };
}
