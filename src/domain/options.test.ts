import { describe, expect, it } from "vitest";

import { normalizeOptionTuple } from "./options";

describe("normalizeOptionTuple", () => {
  it("normalizes Unicode, whitespace, key aliases, and value case", () => {
    expect(
      normalizeOptionTuple({
        " Colour ": "  Jet\u00a0Black ",
        SIZE: " Small ",
      }),
    ).toEqual({
      color: "jet black",
      size: "small",
    });
  });

  it("returns keys in deterministic order", () => {
    expect(
      Object.keys(
        normalizeOptionTuple({
          size: "small",
          color: "black",
        }),
      ),
    ).toEqual(["color", "size"]);
  });

  it("rejects conflicting keys after normalization", () => {
    expect(() =>
      normalizeOptionTuple({
        color: "black",
        Colour: "navy",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CONFLICTING_OPTION",
      }),
    );
  });

  it.each([
    [{}, "EMPTY_OPTIONS"],
    [{ size: "" }, "INVALID_OPTION_VALUE"],
    [{ "": "small" }, "INVALID_OPTION_KEY"],
  ] as const)("rejects invalid tuple %#", (input, code) => {
    expect(() => normalizeOptionTuple(input)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
