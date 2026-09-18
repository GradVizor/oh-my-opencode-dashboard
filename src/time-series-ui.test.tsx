import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TimeSeriesActivitySection,
  SourceSelect,
  buildDashboardUrl,
  resolveSelectedSourceId,
} from "./App";

type TimeSeriesProps = React.ComponentProps<typeof TimeSeriesActivitySection>;

function mkTimeSeries(override?: Partial<TimeSeriesProps["timeSeries"]>): TimeSeriesProps["timeSeries"] {
  const buckets = 3;
  const mkSeries = (id: TimeSeriesProps["timeSeries"]["series"][number]["id"], values: number[]) => ({
    id,
    label: id,
    tone: "muted" as const,
    values,
  });

  return {
    windowMs: 300_000,
    buckets,
    bucketMs: 2_000,
    anchorMs: 0,
    serverNowMs: 0,
    series: [
      mkSeries("overall-main", [0, 0, 0]),
      mkSeries("agent:sisyphus", [0, 0, 0]),
      mkSeries("agent:prometheus", [0, 0, 0]),
      mkSeries("agent:atlas", [0, 0, 0]),
      mkSeries("background-total", [0, 0, 0]),
    ],
    ...override,
  };
}

describe("TimeSeriesActivitySection (SSR)", () => {
  it("should not render top axis and should keep bottom axis", () => {
    // #given
    const timeSeries = mkTimeSeries();

    // #when
    const html = renderToStaticMarkup(<TimeSeriesActivitySection timeSeries={timeSeries} />);

    // #then
    expect(html).not.toContain("timeSeriesAxisTop");
    expect(html).toContain("timeSeriesAxisBottom");
  });

  it("should render the three agent rows with their tones and labels", () => {
    // #given
    const timeSeries = mkTimeSeries({
      series: [
        { id: "overall-main", label: "Overall", tone: "muted", values: [3, 3, 0] },
        { id: "agent:sisyphus", label: "Sisyphus", tone: "teal", values: [2, 0, 0] },
        { id: "agent:prometheus", label: "Prometheus", tone: "red", values: [1, 0, 0] },
        { id: "agent:atlas", label: "Atlas", tone: "green", values: [0, 3, 0] },
        { id: "background-total", label: "Background", tone: "muted", values: [0, 0, 0] },
      ],
    });

    // #when
    const html = renderToStaticMarkup(<TimeSeriesActivitySection timeSeries={timeSeries} />);

    // #then
    expect(html).toContain('data-tone="teal"');
    expect(html).toContain('data-tone="red"');
    expect(html).toContain('data-tone="green"');
    expect(html).toContain("Sisyphus");
    expect(html).toContain("Prometheus");
    expect(html).toContain("Atlas");
    expect(html).not.toContain("timeSeriesBar--sand");
  });

  it("should render no bars when all agent series are zero", () => {
    // #given
    const timeSeries = mkTimeSeries();

    // #when
    const html = renderToStaticMarkup(<TimeSeriesActivitySection timeSeries={timeSeries} />);

    // #then
    expect(html).not.toContain("<rect");
  });
});

describe("SourceSelect (SSR)", () => {
  it("should render all source labels in the dropdown", () => {
    // #given
    const sources = [
      { id: "src-a", label: "Work", updatedAt: 1_700_000_000_000 },
      { id: "src-b", label: "Personal", updatedAt: 1_700_000_100_000 },
      { id: "src-c", label: "Sandbox", updatedAt: 1_700_000_200_000 },
    ];

    // #when
    const html = renderToStaticMarkup(
      <SourceSelect
        sources={sources}
        selectedSourceId={"src-b"}
        disabled={false}
        onChange={() => {
          // noop
        }}
      />
    );

    // #then
    expect(html).toContain("Work");
    expect(html).toContain("Personal");
    expect(html).toContain("Sandbox");
  });
});

describe("source selection helpers", () => {
  it("buildDashboardUrl should include ?sourceId= for non-null ids", () => {
    // #given
    const url = buildDashboardUrl("abc-123");

    // #then
    expect(url).toContain("/api/dashboard");
    expect(url).toContain("?sourceId=");
    expect(url).toContain("abc-123");
  });

  it("resolveSelectedSourceId should prefer a valid stored sourceId, else fall back to defaultSourceId", () => {
    // #given
    const sources = [
      { id: "s1", label: "One", updatedAt: 0 },
      { id: "s2", label: "Two", updatedAt: 0 },
    ];

    // #then
    expect(
      resolveSelectedSourceId({
        sources,
        defaultSourceId: "s1",
        storedSourceId: "s2",
      })
    ).toBe("s2");

    expect(
      resolveSelectedSourceId({
        sources,
        defaultSourceId: "s1",
        storedSourceId: "does-not-exist",
      })
    ).toBe("s1");
  });
});
