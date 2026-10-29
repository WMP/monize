import { categoryLockScope } from "./category-lock-scope";

describe("categoryLockScope", () => {
  const graph = [
    { id: "root", parentId: null },
    { id: "left", parentId: "root" },
    { id: "leaf", parentId: "left" },
    { id: "right", parentId: "root" },
    { id: "other", parentId: null },
  ];
  it("coordinates a selected subtree with its ancestry without locking sibling branches", () => {
    expect(categoryLockScope(graph, ["left"])).toEqual([
      "leaf",
      "left",
      "root",
    ]);
  });
  it("locks both reparenting endpoints and their descendants in the same sorted order", () => {
    expect(categoryLockScope(graph, ["other", "left"])).toEqual([
      "leaf",
      "left",
      "other",
      "root",
    ]);
    expect(
      categoryLockScope([...graph].reverse(), ["left", "other", "left"]),
    ).toEqual(["leaf", "left", "other", "root"]);
  });
  it("keeps a missing restoration identity in the requested lock set", () => {
    expect(categoryLockScope(graph, ["restored"])).toEqual(["restored"]);
  });
});
