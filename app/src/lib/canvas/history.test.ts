import { describe, expect, it } from "vitest";
import { createHistory } from "./history";
import type { SlideDocument } from "./types";

function doc(text: string): SlideDocument {
  return {
    version: 1,
    width: 1080,
    height: 1080,
    background: { type: "solid", color: "#ffffff" },
    elements: [
      {
        id: "t1",
        type: "text",
        text,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        fontSize: 24,
        fontFamily: "Inter",
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
        fill: "#111",
        align: "left",
        lineHeight: 1.2,
        letterSpacing: 0,
        width: 400,
        height: 40,
        padding: 0,
      },
    ],
  };
}

describe("SlideHistory", () => {
  it("undoes and redoes without mutating the stored snapshots", () => {
    const history = createHistory(doc("one"));
    history.push(doc("two"));
    history.push(doc("three"));

    expect(history.canUndo).toBe(true);
    expect(history.undo()?.elements[0]).toMatchObject({ type: "text", text: "two" });
    expect(history.undo()?.elements[0]).toMatchObject({ type: "text", text: "one" });
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.elements[0]).toMatchObject({ type: "text", text: "two" });
    expect(history.canRedo).toBe(true);
  });

  it("clears the future stack on a new push after undo", () => {
    const history = createHistory(doc("a"));
    history.push(doc("b"));
    history.undo();
    history.push(doc("c"));
    expect(history.canRedo).toBe(false);
    expect(history.current.elements[0]).toMatchObject({ type: "text", text: "c" });
  });
});
