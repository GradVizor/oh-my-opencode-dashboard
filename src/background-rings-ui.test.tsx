import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BackgroundTasksSection, computeTaskRing, formatTaskEta } from "./App";

type BackgroundTask = React.ComponentProps<typeof BackgroundTasksSection>["tasks"][number];

function mkTask(override?: Partial<BackgroundTask>): BackgroundTask {
  return {
    id: "task-1",
    description: "Explore: find HTTP/SSE patterns",
    subline: "task-1",
    agent: "explore",
    lastModel: "opencode/gpt-5-nano",
    sessionId: null,
    status: "running",
    toolCalls: 3,
    lastTool: "grep",
    timeline: "",
    startedAtMs: null,
    expectedDurationMs: null,
    ...override,
  };
}

describe("BackgroundTasksSection (SSR)", () => {
  it("should render a progress ring card for a running task with agent, description, model and ETA", () => {
    // #given
    const startedAtMs = Date.now() - 5_000;
    const task = mkTask({ startedAtMs, expectedDurationMs: 10_000 });

    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={[task]} />);

    // #then
    expect(html).toContain("bgTaskRing");
    expect(html).toContain("Explore");
    expect(html).toContain("Explore: find HTTP/SSE patterns");
    expect(html).toContain("opencode/gpt-5-nano");
    expect(html).toContain("~5s left");
    expect(html).toContain('data-tone="teal"');
  });

  it("should render an indeterminate pulsing ring and estimating ETA when timing fields are missing", () => {
    // #given
    const task = mkTask();

    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={[task]} />);

    // #then
    expect(html).toContain("bgTaskRing--indeterminate");
    expect(html).toContain("estimating…");
    expect(html).not.toContain("~");
  });

  it("should render a queued task as a compact row with a status pill and no ring", () => {
    // #given
    const task = mkTask({ status: "queued" });

    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={[task]} />);

    // #then
    expect(html).not.toContain("bgTaskRing");
    expect(html).toContain("bgTaskCompactRow");
    expect(html).toContain("queued");
    expect(html).toContain("pill");
  });

  it("should render completed and error tasks as compact rows without rings", () => {
    // #given
    const tasks = [
      mkTask({ id: "t-done", status: "completed", agent: "atlas" }),
      mkTask({ id: "t-err", status: "error", agent: "prometheus" }),
    ];

    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={tasks} />);

    // #then
    expect(html).not.toContain("bgTaskRing");
    expect(html).toContain("completed");
    expect(html).toContain("error");
  });

  it("should show the running count in the badge", () => {
    // #given
    const tasks = [
      mkTask({ id: "t-run", status: "running" }),
      mkTask({ id: "t-q", status: "queued" }),
      mkTask({ id: "t-done", status: "completed" }),
    ];

    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={tasks} />);

    // #then
    expect(html).toContain("Background tasks");
    expect(html).toContain("bgTaskRing");
    expect(html).toContain("bgTaskCompactRow");
  });

  it("should render the empty state when there are zero tasks", () => {
    // #when
    const html = renderToStaticMarkup(<BackgroundTasksSection tasks={[]} />);

    // #then
    expect(html).toContain("No background tasks detected yet. When you run background agents, they will appear here.");
    expect(html).not.toContain("bgTaskRing");
    expect(html).not.toContain("bgTaskCompactRow");
  });
});

describe("computeTaskRing", () => {
  it("should count down when both timing fields are present", () => {
    // #given
    const ring = computeTaskRing(1_000, 4_000, 3_000);

    // #then
    expect(ring.cadence).toBe("countdown");
    expect(ring.progress).toBe(0.5);
    expect(ring.etaMs).toBe(2_000);
  });

  it("should clamp progress at 1 and eta at 0 while still running", () => {
    // #given
    const ring = computeTaskRing(1_000, 4_000, 10_000);

    // #then
    expect(ring.progress).toBe(1);
    expect(ring.etaMs).toBe(0);
  });

  it("should be indeterminate when either field is null", () => {
    // #then
    expect(computeTaskRing(null, 4_000, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(1_000, null, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(null, null, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(1_000, 4_000, 3_000).cadence).toBe("countdown");
  });

  it("should treat a non-positive expected duration as indeterminate", () => {
    // #then
    expect(computeTaskRing(1_000, 0, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(1_000, -5, 3_000).cadence).toBe("indeterminate");
  });

  it("should treat a future startedAt as zero elapsed", () => {
    // #given
    const ring = computeTaskRing(5_000, 4_000, 3_000);

    // #then
    expect(ring.progress).toBe(0);
    expect(ring.etaMs).toBe(4_000);
  });

  it("should stay in countdown cadence with zero progress when nowMs is before startedAtMs", () => {
    // #given
    const ring = computeTaskRing(5_000, 4_000, 3_000);

    // #then
    expect(ring.cadence).toBe("countdown");
    expect(ring.progress).toBe(0);
    expect(ring.etaMs).toBe(4_000);
  });

  it("should be indeterminate when expected duration is non-positive", () => {
    // #then
    expect(computeTaskRing(1_000, -1, 3_000).cadence).toBe("indeterminate");
  });

  it("should be fully indeterminate when startedAtMs is null", () => {
    // #then
    expect(computeTaskRing(null, 4_000, 3_000)).toEqual({
      progress: null,
      etaMs: null,
      cadence: "indeterminate",
    });
  });

  it("should be indeterminate for non-finite timing fields", () => {
    // #then
    expect(computeTaskRing(NaN, 4_000, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(1_000, NaN, 3_000).cadence).toBe("indeterminate");
    expect(computeTaskRing(1_000, Infinity, 3_000).cadence).toBe("indeterminate");
  });
});

describe("formatTaskEta", () => {
  it("should format whole seconds under a minute", () => {
    // #then
    expect(formatTaskEta(12_000)).toBe("~12s left");
    expect(formatTaskEta(59_400)).toBe("~59s left");
  });

  it("should format minutes with one decimal or whole minutes", () => {
    // #then
    expect(formatTaskEta(120_000)).toBe("~2m left");
    expect(formatTaskEta(150_000)).toBe("~2.5m left");
  });

  it("should format hours above a minute", () => {
    // #then
    expect(formatTaskEta(3_600_000)).toBe("~1h left");
    expect(formatTaskEta(5_400_000)).toBe("~1.5h left");
  });

  it("should say finishing when zero remains", () => {
    // #then
    expect(formatTaskEta(0)).toBe("finishing…");
    expect(formatTaskEta(-1)).toBe("finishing…");
  });

  it("should say estimating when null", () => {
    // #then
    expect(formatTaskEta(null)).toBe("estimating…");
  });

  it("should handle the sub-second boundary from zero up to 500ms", () => {
    // #then
    expect(formatTaskEta(0)).toBe("finishing…");
    expect(formatTaskEta(1)).toBe("~1s left");
    expect(formatTaskEta(499)).toBe("~1s left");
    expect(formatTaskEta(500)).toBe("~1s left");
  });

  it("should round 59.5 seconds up to a minute", () => {
    // #then
    expect(formatTaskEta(59_400)).toBe("~59s left");
    expect(formatTaskEta(59_500)).toBe("~1m left");
  });
});