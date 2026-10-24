import { describe, expect, it } from "vitest";
import { faceOf } from "./faces";

// Agent 얼굴(v1 티켓 14 · 구현 스펙 §6 S36) — frontmatter `avatar`의 모양 · 색이 있으면 따르고, 없으면 handle에서 정한다. Host는 늘
// 무채색 둥근 사각형이다. seam은 순수 함수 `faceOf` 하나다 — 그리는 부품(`AgentFace`)은 이 값을 모양 · 토큰 클래스로 옮기기만 한다.

describe("Agent 얼굴", () => {
  it("Host는 avatar를 적어도 무채색 둥근 사각형이다", () => {
    expect(faceOf("host", null)).toEqual({ shape: "square", color: null });
    expect(faceOf("host", { shape: "circle", color: "green" })).toEqual({ shape: "square", color: null });
  });

  it("avatar에 적은 모양 · 색(DS `chat-accent-*` 이름)을 따른다", () => {
    expect(faceOf("reviewer", { shape: "circle", color: "green" })).toEqual({ shape: "circle", color: "green" });
    expect(faceOf("tester", { shape: "pill", color: "orange" })).toEqual({ shape: "pill", color: "orange" });
    expect(faceOf("docs", { shape: "drop", color: "blue" })).toEqual({ shape: "drop", color: "blue" });
  });

  it("모르는 모양 · 색 이름은 없는 것과 같다 — 그 칸만 handle에서 정한다", () => {
    const derived = faceOf("security-reviewer", null);
    expect(faceOf("security-reviewer", { shape: "hexagon", color: "violet" })).toEqual(derived);
    expect(faceOf("security-reviewer", { shape: "triangle", color: null })).toEqual({ shape: "triangle", color: derived.color });
    expect(faceOf("security-reviewer", { shape: null, color: "cyan" })).toEqual({ shape: derived.shape, color: "cyan" });
  });

  it("handle에서 정한 얼굴은 늘 같고, Host의 둥근 사각형과 빨강으로 읽히는 `orange`를 쓰지 않는다", () => {
    const handles = Array.from({ length: 200 }, (_, at) => `agent-${at}`);
    const faces = handles.map((handle) => faceOf(handle, null));
    expect(handles.map((handle) => faceOf(handle, null))).toEqual(faces);
    expect(new Set(faces.map((face) => face.shape))).toEqual(new Set(["circle", "triangle", "pill", "drop"]));
    expect(new Set(faces.map((face) => face.color))).toEqual(
      new Set(["blue", "green", "yellow", "pink", "purple", "slate", "lime", "cyan", "magenta"]),
    );
  });
});
