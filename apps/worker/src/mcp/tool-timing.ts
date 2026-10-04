/** Approximate elapsed time includes I/O; CPU time comes from Workers Logs. */
export function withToolTiming<Args extends unknown[], Result>(
  tool: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const started = performance.now();
    let outcome = "exception";
    try {
      const result = await handler(...args);
      outcome =
        result &&
        typeof result === "object" &&
        "isError" in result &&
        result.isError
          ? "tool_error"
          : "ok";
      return result;
    } finally {
      // Workers Logs adds the request ID, so this event can be joined to the
      // invocation's cpuTimeMs. Never log arguments, output, tokens or user data.
      console.log({
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        event: "mcp_tool_timing",
        outcome,
        tool,
      });
    }
  };
}
