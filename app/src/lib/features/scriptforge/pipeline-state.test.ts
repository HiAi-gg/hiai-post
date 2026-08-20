import { describe, expect, it } from "vitest";
import { createInitialState, handleSSEEvent } from "./pipeline-state";

describe("scriptforge pipeline-state", () => {
  it("includes an author-opinion stage only when requested", () => {
    expect(createInitialState(false).stages.some((stage) => stage.id === "opinion")).toBe(false);
    const withOpinion = createInitialState(true);
    expect(withOpinion.stages.find((stage) => stage.id === "opinion")?.label).toBe("Author Opinion");
    expect(withOpinion.stages.some((stage) => /Maxim/i.test(stage.label))).toBe(false);
  });

  it("applies SSE stage and result events", () => {
    let state = createInitialState(true);
    state = handleSSEEvent(state, {
      type: "stage_start",
      stage: "research",
      progress: 10,
      message: "Searching",
    });
    expect(state.currentStage).toBe("research");
    expect(state.stages[0]?.status).toBe("active");

    state = handleSSEEvent(state, {
      type: "result",
      message: "Topics generated",
      data: { topics: [{ id: "t1", title: "One" }], stage: "generate_topics" },
    });
    expect(state.results.topics?.[0]?.id).toBe("t1");

    state = handleSSEEvent(state, { type: "complete", message: "done" });
    expect(state.isRunning).toBe(false);
  });
});
