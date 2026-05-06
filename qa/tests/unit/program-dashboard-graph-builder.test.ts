import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/config/page-registry";

describe("program dashboard graph builder", () => {
  it("registers the execution board page with the correct permission entity", () => {
    const executionBoard = PAGE_REGISTRY.find((page) => page.id === "executionBoard");

    expect(executionBoard).toBeDefined();
    expect(executionBoard!.permissionEntity).toBe("execution_board");
    expect(executionBoard!.routeComponentKey).toBe("ExecutionBoardPage");
  });

  it("registers the execution board program sub-route", () => {
    const programView = PAGE_REGISTRY.find((page) => page.id === "executionBoardProgram");

    expect(programView).toBeDefined();
    expect(programView!.path).toBe("/execution-board/program");
    expect(programView!.permissionEntity).toBe("execution_board");
  });
});
