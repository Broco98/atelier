/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { chipLabel, chipLists, currentModel, slashCommands } from "./chips";
import type { Participant, RecordLine } from "./types";

// 입력창 칩(v1 티켓 05 · 스토리 33) — 기록에서 모델 목록과 Session이 연 값을, 참여자 줄에서 고른 값을 읽는다. 바탕은 축복한 기록이다.
const blessed: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const host = (model: string | null, effort: string | null): Participant => ({
  handle: "host",
  from: "library",
  joinedAt: "",
  runtime: "claude-code",
  sessionId: null,
  cwd: null,
  additionalDirectories: [],
  model,
  effort,
});

describe("입력창 칩", () => {
  it("모델 목록과 지금 값은 그 참여자의 열림 줄에서 오고, 「/」 명령은 Runtime이 보낸 마지막 목록이다", () => {
    const lists = chipLists(blessed, "host");
    expect(lists.models?.slice(0, 2).map((option) => option.value)).toEqual(["default", "opus"]);
    expect(lists.model).toBe("sonnet");
    expect(lists.commands.length).toBeGreaterThan(0);
    // 다른 참여자의 줄은 읽지 않는다.
    expect(chipLists(blessed, "reviewer")).toEqual({ models: null, model: null, commands: [] });
  });

  it("고른 모델(참여자 줄)이 Session이 연 값을 이긴다", () => {
    const lists = chipLists(blessed, "host");
    expect(currentModel(lists, host(null, null))).toBe("sonnet");
    expect(currentModel(lists, host("opus", "high"))).toBe("opus");
  });

  it("칩 글자는 「모델 · 생각 깊이」 — 모델 이름의 괄호 설명은 뗀다", () => {
    const { models } = chipLists(blessed, "host");
    expect(chipLabel(models, "opus", "high")).toBe("Opus 5.5 · 높음");
    expect(chipLabel(models, "default", null)).toBe("Default");
    expect(chipLabel(null, "claude-opus-9", "max")).toBe("claude-opus-9 · 최대");
    expect(chipLabel(null, null, null)).toBe("기본 모델");
  });

  it("목록이 서기 전의 별칭은 이름처럼 머리를 대문자로 쓴다(Screen-Home 보드 「Opus · 높음」)", () => {
    expect(chipLabel(null, "opus", "high")).toBe("Opus · 높음");
    expect(chipLabel(null, "sonnet", null)).toBe("Sonnet");
  });
});

describe("「/」 명령(v1 티켓 23)", () => {
  it("화면 명령이 보드의 차례로 Runtime 명령 앞에 서고, 같은 이름의 Runtime 명령은 가린다 — `/plan`은 늘 계획만이다", () => {
    const runtime = [
      { name: "plan", description: "Runtime의 plan", aliases: [] },
      { name: "compact", description: "맥락 줄이기", aliases: [] },
    ];
    expect(slashCommands(runtime).map((command) => [command.name, command.description])).toEqual([
      ["new", "새 Thread"],
      ["agent", "Agent 부르기"],
      ["plan", "계획만 세우고 멈추기"],
      ["policy", "언제 물어볼지"],
      ["compact", "맥락 줄이기"],
    ]);
  });
});
