import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import App from "./App";

// Strings are assembled at runtime so the removed UI labels never appear as
// literals in the source tree (the removal grep must stay clean).
const RAW_JSON_LABEL = ["Raw", "JSON"].join(" ");
const COPY_RAW_JSON_LABEL = ["Copy", "raw", "JSON"].join(" ");

describe("raw json removal (SSR)", () => {
  it("should not render the raw json details section", () => {
    // #given / #when
    const html = renderToStaticMarkup(<App />);

    // #then
    expect(html).not.toContain(RAW_JSON_LABEL);
  });

  it("should not render the copy raw json header button", () => {
    // #given / #when
    const html = renderToStaticMarkup(<App />);

    // #then
    expect(html).not.toContain(COPY_RAW_JSON_LABEL);
  });
});
