/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { ASK_LEVELS, chipLabel, chipLists, chipParts, CLAUDE_MODELS, currentModel, newThreadLevel, slashCommands } from "./chips";
import type { RecordLine } from "./types";

// 입력창 칩(v1 티켓 05 · 스토리 33) — 기록에서 모델 목록과 Session이 연 값을, 채팅의 값에서 고른 값을 읽는다. 바탕은 축복한 기록이다.
const blessed: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

describe("입력창 칩", () => {
  it("모델 목록과 지금 값은 열림 줄에서 오고, 「/」 명령은 Runtime이 보낸 마지막 목록이다", () => {
    const lists = chipLists(blessed);
    expect(lists.models?.slice(0, 2).map((option) => option.value)).toEqual(["default", "opus"]);
    expect(lists.model).toBe("sonnet");
    expect(lists.commands.length).toBeGreaterThan(0);
  });

  it("고른 모델(채팅의 값)이 Session이 연 값을 이긴다", () => {
    const lists = chipLists(blessed);
    expect(currentModel(lists, { model: null })).toBe("sonnet");
    expect(currentModel(lists, { model: "opus" })).toBe("opus");
  });

  it("칩 글자는 「모델 · 생각 깊이」 — 모델 이름의 괄호 설명은 뗀다", () => {
    const { models } = chipLists(blessed);
    expect(chipLabel(models, "opus", "high")).toBe("Opus 5.5 · 높음");
    expect(chipLabel(models, "default", null)).toBe("Default");
    expect(chipLabel(null, "claude-opus-9", "max")).toBe("claude-opus-9 · 최대");
    expect(chipLabel(null, null, null)).toBe("기본 모델");
  });

  // 02 티켓 10 — 칩은 모델 이름을 본문색으로, 생각 깊이를 옅은 글자로 가른다(캔버스 v35 Diff-Chat 「GPT-6.1 Sol High」 · F1-Home 「Claude
  // Code Default」). 글자는 칩 글자 그대로다.
  it("칩 글자를 모델과 생각 깊이 두 조각으로 가른다 — 생각 깊이를 모르면 모델만이다", () => {
    const { models } = chipLists(blessed);
    expect(chipParts(models, "opus", "high")).toEqual({ model: "Opus 5.5", depth: "높음" });
    expect(chipParts(CLAUDE_MODELS, "default", null)).toEqual({ model: "Default", depth: null });
    expect(chipParts(null, null, null)).toEqual({ model: "기본 모델", depth: null });
  });

  it("목록이 서기 전의 별칭은 이름처럼 머리를 대문자로 쓴다(Screen-Home 보드 「Opus · 높음」)", () => {
    expect(chipLabel(null, "opus", "high")).toBe("Opus · 높음");
    expect(chipLabel(null, "sonnet", null)).toBe("Sonnet");
  });

  // v1 티켓 31 · 사용자 결정 — Session이 열리기 전(새 Thread)에도 모델을 고른다. 그때의 목록은 claude `--model`이 받는 별칭이고, 고른
  // 값은 Session이 연 목록에도 그대로 있어 첫 말 뒤에도 같은 줄에 체크가 선다.
  it("Session이 열리기 전의 모델 목록은 claude가 받는 별칭이고, 열린 뒤의 목록에도 같은 값으로 있다", () => {
    expect(CLAUDE_MODELS.map((option) => option.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku"]);
    const opened = new Set(chipLists(blessed).models?.map((option) => option.value));
    for (const option of CLAUDE_MODELS) expect(opened.has(option.value), option.value).toBe(true);
    expect(chipLabel(CLAUDE_MODELS, "default", null)).toBe("Default");
    expect(chipLabel(CLAUDE_MODELS, "sonnet", "low")).toBe("Sonnet · 낮음");
  });
});

describe("「/」 명령(v1 티켓 23)", () => {
  it("화면 명령이 보드의 차례로 Runtime 명령 앞에 서고, 같은 이름의 Runtime 명령은 가린다 — `/plan`은 늘 「계획」이다", () => {
    // `/model`은 모델 칩 메뉴를 연다(구현 스펙 §14, 코드 리뷰 1차 B8) — Runtime의 `/model`은 가린다.
    const runtime = [
      { name: "plan", description: "Runtime의 plan", aliases: [] },
      { name: "model", description: "Runtime의 model", aliases: [] },
      { name: "compact", description: "맥락 줄이기", aliases: [] },
    ];
    expect(slashCommands(runtime).map((command) => [command.name, command.description])).toEqual([
      ["new", "새 채팅"],
      ["plan", "계획만 세우고 멈추기"],
      ["model", "모델과 생각 깊이"],
      ["policy", "언제 물어볼지"],
      ["compact", "맥락 줄이기"],
    ]);
  });

  it("화면 명령에 `/work`가 없다 — Runtime이 그 이름의 명령을 보내면 여느 Runtime 명령처럼 선다", () => {
    expect(slashCommands([]).map((command) => command.name)).not.toContain("work");
    const runtime = [{ name: "work", description: "Runtime의 work", aliases: [] }];
    expect(slashCommands(runtime).map((command) => [command.name, command.description])).toContainEqual(["work", "Runtime의 work"]);
  });

  it("화면 명령에 `/agent`가 없다 — Runtime이 그 이름의 명령을 보내면 여느 Runtime 명령처럼 선다", () => {
    expect(slashCommands([]).map((command) => command.name)).not.toContain("agent");
    const runtime = [{ name: "agent", description: "Runtime의 agent", aliases: [] }];
    expect(slashCommands(runtime).map((command) => [command.name, command.description])).toContainEqual(["agent", "Runtime의 agent"]);
  });
});

// 물어보는 정도의 저장 글자 · 이름도 **두 언어가 문자열로만** 잇는다(코드 리뷰 1차 C) — 칩이 고른 글자를 엔진이 모르면 매번 묻기로
// 눕고, 이름이 다르면 칩과 물음 줄(Policy 이름) · 자동 허용 까닭이 다른 말을 한다. 표를 못 찾으면 던진다(fail-closed).
describe("물어보는 정도 — 칩과 판정", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/src/policy.rs", import.meta.url)), "utf8");
  const table = (fn: string): Record<string, string> => {
    const body = new RegExp(`fn ${fn}\\(self\\) -> &'static str \\{\\s*match self \\{([^}]*)\\}`).exec(source)?.[1];
    if (!body) throw new Error(`policy.rs에서 AskLevel::${fn}을 못 찾았다`);
    return Object.fromEntries([...body.matchAll(/AskLevel::(\w+) => "([^"]+)"/g)].map(([, variant, text]) => [variant, text]));
  };

  it("네 모드의 이름과 설명은 시안의 말이다", () => {
    expect(ASK_LEVELS.map((level) => [level.value, level.name, level.description])).toEqual([
      ["always", "매번 묻기", "편집과 명령마다 묻습니다"],
      ["edits", "편집 자동", "파일 편집은 묻지 않고, 명령은 묻습니다"],
      ["plan", "계획", "고치지 않고 계획만 세웁니다"],
      ["auto", "묻지 않음", "모두 허용합니다"],
    ]);
  });

  it("칩의 차례 · 저장 글자 · 이름이 엔진의 `AskLevel`과 같다", () => {
    const stored = table("as_str");
    const names = table("name");
    expect(Object.keys(stored)).toEqual(["Always", "Edits", "Plan", "Auto"]);
    expect(ASK_LEVELS.map((level) => level.value)).toEqual(Object.values(stored));
    expect(ASK_LEVELS.map((level) => level.name)).toEqual(Object.keys(stored).map((variant) => names[variant]));
  });
});

// 구현 스펙 「01a — 권한」 — 칩의 기본값만 바꾸면 값이 없는 파일을 「매번 묻기」로 읽는 판정과 갈린다. 그래서 보이는 값을 첫 말과 함께 보낸다.
describe("새 채팅의 정도", () => {
  it("작업공간이 없으면 「편집 자동」으로 보이고 그 값을 첫 말과 함께 보낸다", () => {
    expect(newThreadLevel(null, null, null)).toEqual({ shown: "edits", sent: "edits" });
  });

  it("작업공간이 없어도 고른 값이 이기고, 고른 값을 보낸다", () => {
    expect(newThreadLevel("plan", null, null)).toEqual({ shown: "plan", sent: "plan" });
    expect(newThreadLevel("always", null, null)).toEqual({ shown: "always", sent: "always" });
  });

  it("이은 작업공간은 그 값을 보이고, 고르지 않았으면 아무것도 보내지 않는다", () => {
    expect(newThreadLevel(null, "cart", "auto")).toEqual({ shown: "auto", sent: null });
    expect(newThreadLevel(null, "cart", "always")).toEqual({ shown: "always", sent: null });
  });

  it("작업공간의 값을 읽는 동안에는 「매번 묻기」로 보이고, 보내서 그 값을 덮지 않는다", () => {
    expect(newThreadLevel(null, "cart", null)).toEqual({ shown: "always", sent: null });
  });

  it("이은 작업공간에서 고른 값은 보낸다", () => {
    expect(newThreadLevel("plan", "cart", "auto")).toEqual({ shown: "plan", sent: "plan" });
  });
});
