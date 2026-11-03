/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  ASK_LEVELS,
  chipLabel,
  chipLists,
  chipParts,
  CLAUDE_MODELS,
  currentModel,
  EFFORTS,
  newThreadChips,
  newThreadLevel,
  pickRuntime,
  slashCommands,
  threadChips,
  threadCommands,
} from "./chips";
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
      ["always", "매번 묻기", "편집과 명령마다 묻는다"],
      ["edits", "편집 자동", "파일 편집은 묻지 않고, 명령은 묻는다"],
      ["plan", "계획", "고치지 않고 계획만 세운다"],
      ["auto", "묻지 않음", "모두 허용한다"],
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

  // 스펙 「01a — 권한」 — Codex 채팅은 이 값을 보내지 않는다. 보내면 작업공간이 함께 쓰는 값이 바뀐다(01a-10의 남긴 일).
  it("Codex를 고른 새 채팅은 고른 값이 있어도 아무것도 보내지 않는다", () => {
    expect(newThreadLevel(null, null, null, "codex").sent).toBeNull();
    expect(newThreadLevel("auto", null, null, "codex").sent).toBeNull();
    expect(newThreadLevel("plan", "cart", "auto", "codex").sent).toBeNull();
    expect(newThreadLevel(null, null, null, "claude-code")).toEqual({ shown: "edits", sent: "edits" });
  });
});

// restart 01c-5 · 스펙 「01c — Codex」 칩 — Claude는 앱의 네 정도와 앱의 생각 깊이를 그리고 모델은 `configOptions`에서 읽는다. Codex는 `configOptions`의
// `model` · `reasoning_effort`를 그리고, `modes`는 메뉴 목록으로만 쓴다 — 칩의 지금 값은 언제나 채팅 파일의 Codex 모드다. 바탕은 축복한 Codex 기록이다.
const codexRecord: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-codex.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

const codexChat = { runtime: "codex", askLevel: "auto", model: null, effort: null } as const;
const claudeChat = { runtime: "claude-code", askLevel: "edits", model: null, effort: null } as const;
const values = (options: readonly { value: string }[] | null | undefined) => options?.map((option) => option.value) ?? null;
const names = (options: readonly { name: string }[] | null | undefined) => options?.map((option) => option.name) ?? null;

describe("Codex 채팅의 칩", () => {
  it("모드 칩의 값은 채팅 파일의 Codex 모드다 — Codex가 알린 `currentModeId`(agent)를 믿지 않고, 메뉴는 Codex가 보낸 모드 넷이다", () => {
    const { mode } = threadChips({ ...codexChat, codexMode: "read-only" }, chipLists(codexRecord));
    expect(mode).toEqual({
      kind: "codex",
      value: "read-only",
      name: "Read-only",
      options: [
        { value: "read-only", name: "Read-only", description: "Requires approval to edit files and access the internet." },
        {
          value: "workspace-write",
          name: "Workspace access",
          description: "Edit workspace files; ask before writing outside the workspace or accessing the network.",
        },
        { value: "agent", name: "Auto review", description: "Only ask for actions detected as potentially unsafe" },
        { value: "agent-full-access", name: "Full access", description: "Unrestricted access to the internet and any file on your computer" },
      ],
    });
  });

  it("채팅 파일에 Codex 모드가 없으면 앱의 기본 Workspace access다", () => {
    expect(threadChips(codexChat, chipLists(codexRecord)).mode).toMatchObject({ value: "workspace-write", name: "Workspace access" });
  });

  it("모델 칩은 `configOptions`의 `model`과 `reasoning_effort`다 — `collaboration_mode` · `fast-mode`는 어디에도 서지 않는다", () => {
    const { model } = threadChips(codexChat, chipLists(codexRecord));
    expect(values(model?.models)).toEqual([
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6.1-terra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(names(model?.efforts)).toEqual(["Low", "Medium", "High", "Xhigh", "Max", "Ultra"]);
    expect([model?.model, model?.effort]).toEqual(["gpt-6.1-sol", "xhigh"]);
    expect(chipLabel(model?.models ?? null, model?.model ?? null, model?.effort ?? null, model?.efforts ?? null)).toBe("6.1 Sol · Xhigh");
  });

  it("고른 모델 · 생각 깊이(채팅의 값)가 Session이 연 값을 이긴다", () => {
    const { model } = threadChips({ ...codexChat, model: "gpt-6-astra", effort: "ultra" }, chipLists(codexRecord));
    expect([model?.model, model?.effort]).toEqual(["gpt-6-astra", "ultra"]);
  });

  it("Session이 열리기 전에는 모델 칩이 없고, 모드 칩은 기본값으로만 서고 메뉴가 없다", () => {
    const before = codexRecord.slice(0, 1);
    expect(threadChips(codexChat, chipLists(before))).toEqual({
      mode: { kind: "codex", value: "workspace-write", name: "Workspace access", options: null },
      model: null,
    });
  });

  // Composer 「능력이 적을 때」 — Runtime이 선언하지 않은 칩은 그리지 않는다.
  it("Runtime이 선언하지 않은 칩은 서지 않는다 — 모드가 없으면 모드 칩이, 생각 깊이가 없으면 그 칸이, 모델이 없으면 모델 칩이 없다", () => {
    const opened = (payload: Record<string, unknown>): RecordLine[] => [
      { seq: 1, at: "2026-10-10T10:00:00.000+09:00", kind: "session", payload: { state: "opened", how: "new", ...payload } },
    ];
    const model = { id: "model", type: "select", currentValue: "gpt-5.5", options: [{ value: "gpt-5.5", name: "GPT 5.5" }] };
    const fewer = threadChips(codexChat, chipLists(opened({ modes: null, configOptions: [model] })));
    expect(fewer.mode).toBeNull();
    expect(fewer.model).toMatchObject({ model: "gpt-5.5", efforts: null, effort: null });
    expect(chipLabel(fewer.model?.models ?? null, "gpt-5.5", null, null)).toBe("GPT 5.5");
    expect(threadChips(codexChat, chipLists(opened({ modes: { availableModes: [] }, configOptions: [] }))).model).toBeNull();
  });

  it("「/」 메뉴는 Codex가 보낸 명령을 그 글 그대로 보인다 — 앱의 `/plan` · `/policy`(물어보는 정도)는 서지 않는다", () => {
    const { mode } = threadChips(codexChat, chipLists(codexRecord));
    const menu = slashCommands(chipLists(codexRecord).commands, threadCommands(mode));
    expect(menu.map((command) => command.name).slice(0, 3)).toEqual(["new", "model", "plan"]);
    expect(menu.find((command) => command.name === "plan")?.description).toBe("Turn plan mode on.");
    expect(menu.map((command) => command.name)).not.toContain("policy");
    expect(menu.map((command) => command.name)).toContain("compact");
  });
});

describe("Claude Code 채팅의 칩", () => {
  it("모드 칩은 앱의 물어보는 정도다 — 변환기가 낸 `modes`를 읽지 않는다", () => {
    expect(threadChips(claudeChat, chipLists(blessed)).mode).toEqual({ kind: "ask", level: "edits" });
  });

  it("모델은 `configOptions`에서, 생각 깊이 목록은 앱의 것에서 온다", () => {
    const { model } = threadChips({ ...claudeChat, effort: "high" }, chipLists(blessed));
    expect(values(model?.models)?.slice(0, 2)).toEqual(["default", "opus"]);
    expect(names(model?.efforts)).toEqual(["낮음", "중간", "높음", "아주 높음", "최대"]);
    expect([model?.model, model?.effort]).toEqual(["sonnet", "high"]);
  });

  it("「/」 메뉴에 앱의 명령 넷이 그대로 선다", () => {
    const { mode } = threadChips(claudeChat, chipLists(blessed));
    expect(slashCommands([], threadCommands(mode)).map((command) => command.name)).toEqual(["new", "plan", "model", "policy"]);
  });
});

describe("새 채팅의 칩", () => {
  it("Claude Code는 물어보는 정도와 claude가 받는 별칭 목록이다", () => {
    expect(newThreadChips("claude-code", { model: "opus", effort: "high" }, "edits")).toEqual({
      mode: { kind: "ask", level: "edits" },
      model: { models: CLAUDE_MODELS, model: "opus", efforts: EFFORTS, effort: "high" },
    });
    expect(newThreadChips("claude-code", { model: null, effort: null }, "edits").model?.model).toBe("default");
  });

  // Composer 「첫 말 전 Codex」 — 목록이 아직 없어 모델 칩이 없다 · 모드 칩은 기본값으로만 서고 메뉴는 열리지 않는다.
  it("첫 말 전 Codex는 모델 칩이 없고, 모드 칩은 Workspace access로 메뉴 없이 선다", () => {
    expect(newThreadChips("codex", { model: null, effort: null }, "edits")).toEqual({
      mode: { kind: "codex", value: "workspace-write", name: "Workspace access", options: null },
      model: null,
    });
  });

  it("Runtime을 바꾸면 고른 모델과 생각 깊이가 비워진다 — Claude 값이 Codex로 가지 않는다", () => {
    const picked = { runtime: "claude-code", mode: "auto", model: "opus", effort: "max" } as const;
    expect(pickRuntime(picked, "codex")).toEqual({ runtime: "codex", mode: "auto", model: null, effort: null });
    expect(pickRuntime(pickRuntime(picked, "codex"), "claude-code")).toEqual({ runtime: "claude-code", mode: "auto", model: null, effort: null });
    expect(pickRuntime(picked, "claude-code")).toBe(picked);
  });
});
