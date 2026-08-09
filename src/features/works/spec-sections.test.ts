import { describe, expect, it } from "vitest";
import { splitSpecFiles } from "./spec-sections";

describe("splitSpecFiles", () => {
  it("판과 상시 문서를 가른다 — 판 안 경로는 판 폴더 기준으로 짧아진다", () => {
    const result = splitSpecFiles([
      "overview.md",
      "01-삭제-관통/spec.md",
      "01-삭제-관통/tickets/01.md",
      "research/prompt.md",
    ]);
    expect(result.iterations).toEqual([
      { dir: "01-삭제-관통", number: 1, files: ["spec.md", "tickets/01.md"] },
    ]);
    expect(result.standing).toEqual(["overview.md", "research/prompt.md"]);
  });

  it("최신 판이 위에 온다 — 번호 내림차순", () => {
    const result = splitSpecFiles(["01-처음/spec.md", "03-마지막/spec.md", "02-가운데/spec.md"]);
    expect(result.iterations.map((i) => i.number)).toEqual([3, 2, 1]);
  });

  it("판 번호가 두 자리를 넘어도 숫자로 센다 — 문자열 정렬이면 100이 02보다 앞선다", () => {
    const result = splitSpecFiles(["02-b/spec.md", "100-c/spec.md", "9-a/spec.md"]);
    expect(result.iterations.map((i) => i.number)).toEqual([100, 9, 2]);
  });

  it("판이 하나도 없으면 전부 상시다", () => {
    const result = splitSpecFiles(["overview.md", "research/prompt.md"]);
    expect(result.iterations).toEqual([]);
    expect(result.standing).toEqual(["overview.md", "research/prompt.md"]);
  });

  it("판만 있으면 상시가 빈다", () => {
    const result = splitSpecFiles(["01-a/spec.md"]);
    expect(result.iterations).toHaveLength(1);
    expect(result.standing).toEqual([]);
  });

  it("아무것도 없으면 둘 다 빈다", () => {
    expect(splitSpecFiles([])).toEqual({ iterations: [], standing: [] });
  });

  // 판은 **폴더**다. 규칙에 없는 이름이 트리에서 사라지면 안 되는 것과 같은 이유로,
  // 판처럼 생긴 파일을 판으로 세면 그 문서가 갈 곳을 잃는다.
  it("판 번호로 시작하는 파일은 판이 아니다", () => {
    const result = splitSpecFiles(["01-계획.md"]);
    expect(result.iterations).toEqual([]);
    expect(result.standing).toEqual(["01-계획.md"]);
  });

  it("판 폴더 바로 아래 파일이 없어도(더 깊은 곳에만 있어도) 판이다", () => {
    const result = splitSpecFiles(["02-b/tickets/01.md"]);
    expect(result.iterations).toEqual([
      { dir: "02-b", number: 2, files: ["tickets/01.md"] },
    ]);
  });

  it("판 안 파일 순서는 받은 그대로다 — 정렬은 커널이 이미 했다", () => {
    const result = splitSpecFiles(["01-a/z.md", "01-a/a.md"]);
    expect(result.iterations[0].files).toEqual(["z.md", "a.md"]);
  });
});
