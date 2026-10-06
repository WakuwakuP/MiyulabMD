import { createLineMatcher, grepRows } from "../src/services/search.ts";

// Synthetic warm scan only: no DB/auth/network or Cloudflare CPU accounting.
const filler = `${"ordinary text ".repeat(12)}\n`;
const workloads = {
  early_match: ["needle\n", filler.repeat(400)].join(""),
  late_match: [filler.repeat(400), "needle\n"].join(""),
  no_match: filler.repeat(400),
};
const matcher = createLineMatcher("needle");
if (matcher.kind !== "ok") {
  throw new Error("Unexpected matcher error");
}

for (const [workload, markdown] of Object.entries(workloads)) {
  for (const variant of ["line_scan", "indexed"]) {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      id: `note-${index}`,
      markdown_snapshot: markdown,
      snapshot_updated_at: 1,
      title: `Note ${index}`,
    }));
    const samples = [];
    let result;
    for (let i = 0; i < 220; i++) {
      const cpu = process.cpuUsage();
      const started = performance.now();
      result = grepRows(
        rows,
        variant === "indexed"
          ? matcher.matcher
          : { match: matcher.matcher.match },
        { maxMatchesPerNote: 1 },
      );
      const spent = process.cpuUsage(cpu);
      if (i >= 20) {
        samples.push({
          cpu: (spent.user + spent.system) / 1000,
          wall: performance.now() - started,
        });
      }
    }
    const median = (key) => {
      const values = samples.map((sample) => sample[key]).sort((a, b) => a - b);
      return (values[99] + values[100]) / 2;
    };
    console.log({
      chars: markdown.length * rows.length,
      cpuMedianMs: median("cpu"),
      matches: result.matches.length,
      samples: samples.length,
      scannedNotes: result.scannedNotes,
      truncated: result.truncated,
      variant,
      wallMedianMs: median("wall"),
      workload,
    });
  }
}
