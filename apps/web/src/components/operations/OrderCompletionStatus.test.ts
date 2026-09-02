import { describe, expect, it } from "vitest";
import { orderCompletionLabel } from "./OrderCompletionStatus";
import { productionStageLabel } from "./PatternTaskStatusBadges";

describe("order business stage labels", () => {
  it("shows pending pattern making before a physical route", () => {
    expect(productionStageLabel({
      sampleRequestItems: ["pattern_making", "cutting"],
      stage: "pattern_waiting",
      patternTask: {
        status: "pending",
        requirements: ["pattern_making"],
        completedRequirements: []
      }
    })).toBe("待制版");
  });

  it("does not label a pattern-only pending order as no sampling demand", () => {
    expect(orderCompletionLabel({
      sampleRequestItems: ["pattern_making"],
      stage: "done",
      completionStatus: "pattern_only_pending",
      patternTask: {
        status: "pending",
        requirements: ["pattern_making"],
        completedRequirements: []
      }
    })).toBe("未完成 · 制版");
  });

  it("lists every unfinished task for a pattern-only order", () => {
    expect(orderCompletionLabel({
      sampleRequestItems: ["pattern_making", "pattern_full_size"],
      stage: "done",
      completionStatus: "pattern_only_pending",
      patternTask: {
        status: "active",
        requirements: ["pattern_making", "pattern_full_size"],
        completedRequirements: ["pattern_making"]
      }
    })).toBe("未完成 · 推全码版");
  });
});
