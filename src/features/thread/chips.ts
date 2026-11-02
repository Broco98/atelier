import { isObject, text } from "./json";
import type { AskLevel, RecordLine, ThreadView } from "./types";
import { DEFAULT_RUNTIME, type Runtime } from "./runtime";

// 입력창 칩과 「/」 메뉴의 원천(v1 티켓 05 · 구현 스펙 §14 「입력창 아래 줄」 · 스토리 33) — 기록 줄에서 Session의 모델 목록 ·
// 명령을, 채팅의 값(`thread.json`)에서 고른 모델 · 생각 깊이를 읽는 **순수 함수**다. three-axes 칩(`chat/chips.ts`)을 옮겨 왔다.
// - **지금 값은 채팅의 값이 이긴다.** 모델 · 생각 깊이 바꾸기는 채팅의 값을 먼저 고치고(Session이 떠 있으면 다음 턴부터 든다), 떠
//   있지 않으면 다음에 띄울 때 그 값으로 연다. 그래서 고른 값이 있으면 그것이고, 없으면 Session이 연 값이다.
// - **Runtime마다 칩이 다르다**(restart 스펙 「01c — Codex」 칩 · 01c-5 — `threadChips` · `newThreadChips`). Claude Code는 앱의 네 정도(물어보는
//   정도, v1 티켓 23 — Thread · Work의 값이라 `ThreadView.askLevel`에서 읽는다)와 앱의 생각 깊이 목록을 그리고 모델은 `configOptions`에서 읽는다.
//   변환기가 내는 `modes`는 읽지 않는다. Codex는 `configOptions`의 `model` · `reasoning_effort`를 그리고, `modes`는 메뉴 목록으로만 쓴다 — 칩의 지금
//   값은 언제나 채팅 파일의 Codex 모드다(`currentModeId`는 새 세션에서도 재개에서도 `agent`이고 `session/set_mode`는 바뀐 모드를 알리지 않는다).
//   `collaboration_mode` · `fast-mode`는 그리지 않는다. Runtime이 선언하지 않은 칩은 서지 않는다.

/** 칩 목록의 한 줄 — 모델의 선택지. 값 · 이름 · 설명은 Runtime이 준 글자 그대로다. */
export interface ChoiceOption {
  value: string;
  name: string;
  description: string | null;
}

/** 「/」 메뉴의 한 줄. `thread`는 화면이 하는 명령(`/new`)이고, 그 밖은 Runtime이 보낸 명령이다. */
export interface CommandOption {
  name: string;
  description: string;
  aliases: string[];
  thread?: boolean;
}

export interface ChipLists {
  /** 모델 목록 — 마지막 열림 줄의 configOptions `model`. Session을 연 적 없거나 Runtime이 선언하지 않았으면 null이다. */
  models: ChoiceOption[] | null;
  /** Session이 알린 지금 모델 — 열림 줄의 currentValue와 그 뒤의 바꿈(`config` · `config_option_update`). */
  model: string | null;
  /** Runtime이 보낸 생각 깊이 목록 — 마지막 열림 줄의 configOptions `reasoning_effort`(Codex). 선언하지 않았으면 null이다. */
  efforts: ChoiceOption[] | null;
  /** Session이 알린 지금 생각 깊이 — `model`과 같은 길로 읽는다. */
  effort: string | null;
  /** Runtime이 보낸 모드 목록(`modes.availableModes`) — Session을 연 적 없으면 null, 열었는데 선언하지 않았으면 빈 목록이다. 지금 모드(`currentModeId`)는 읽지 않는다. */
  modes: ChoiceOption[] | null;
  commands: CommandOption[];
}

/** 생각 깊이 — claude `--effort`가 받는 값과 그 말(낮은 것부터). 엔진의 `EFFORTS`와 같은 차례다. Claude Code 채팅의 칩이 그린다. */
export const EFFORTS: readonly ChoiceOption[] = [
  { value: "low", name: "낮음", description: null },
  { value: "medium", name: "중간", description: null },
  { value: "high", name: "높음", description: null },
  { value: "xhigh", name: "아주 높음", description: null },
  { value: "max", name: "최대", description: null },
];

/**
 * 새 Codex 채팅의 모드(스펙 「01c — Codex」 모드) — 엔진이 채팅 파일에 적는 기본값과 같은 값이다(`host/thread.rs`의 `CODEX_DEFAULT_MODE`). 이름은
 * codex-acp 2.2.2가 보낸 글이다 — 첫 말 전에는 Codex의 목록이 없어 앱이 쥔다(Composer 「첫 말 전 Codex」).
 */
export const CODEX_DEFAULT_MODE: ChoiceOption = { value: "workspace-write", name: "Workspace access", description: null };

/** 모드 칩 — Claude Code는 물어보는 정도, Codex는 채팅의 Codex 모드와 메뉴 목록(Session이 열리기 전이면 `null` — 메뉴가 열리지 않는다). */
export type ModeChipValue =
  | { kind: "ask"; level: AskLevel }
  | { kind: "codex"; value: string; name: string; options: readonly ChoiceOption[] | null };

/** 모델 칩 — 모델 목록(없으면 보이기만 한다) · 지금 모델 · 생각 깊이 목록(없으면 그 칸이 없다) · 지금 생각 깊이. */
export interface ModelChipValue {
  models: readonly ChoiceOption[] | null;
  model: string | null;
  efforts: readonly ChoiceOption[] | null;
  effort: string | null;
}

/** 입력창의 두 칩 — 없으면(`null`) 그 칩이 서지 않는다(Runtime이 선언하지 않았다). */
export interface ComposerChipValues {
  mode: ModeChipValue | null;
  model: ModelChipValue | null;
}

/**
 * 화면이 하는 명령 — Runtime 명령 앞에 보드의 차례로 선다(캔버스 Composer 보드 「/ · 명령」). `/plan`은 물어보는 정도를 「계획」으로 바꾸고,
 * `/policy`는 물어보는 정도 메뉴를 연다(v1 티켓 23). `/model`은 모델 칩 메뉴(모델과 생각 깊이)를 연다(구현 스펙 §14, 코드 리뷰 1차 B8).
 */
export const THREAD_COMMANDS: readonly CommandOption[] = [
  { name: "new", description: "새 채팅", aliases: [], thread: true },
  { name: "plan", description: "계획만 세우고 멈추기", aliases: [], thread: true },
  { name: "model", description: "모델과 생각 깊이", aliases: [], thread: true },
  { name: "policy", description: "언제 물어볼지", aliases: [], thread: true },
];

/**
 * 그 모드 칩과 함께 서는 화면 명령 — `/plan` · `/policy`는 물어보는 정도의 명령이라 물어보는 정도 칩이 설 때(Claude Code)만 선다. Codex 채팅에서는
 * Codex의 `/plan`이 그 이름으로 선다.
 */
export function threadCommands(mode: Pick<ModeChipValue, "kind"> | null): readonly CommandOption[] {
  return mode?.kind === "ask" ? THREAD_COMMANDS : THREAD_COMMANDS.filter((command) => command.name === "new" || command.name === "model");
}

/** 「/」 메뉴의 명령 — 화면 명령 뒤에 Runtime 명령이다. 화면 명령과 이름이 같은 Runtime 명령은 가린다 — 같은 글이 다른 일을 하지 않게. */
export function slashCommands(runtime: readonly CommandOption[], own: readonly CommandOption[] = THREAD_COMMANDS): CommandOption[] {
  const taken = new Set(own.map((command) => command.name));
  return [...own, ...runtime.filter((command) => !taken.has(command.name))];
}

/**
 * Session이 열리기 전의 모델 목록(v1 티켓 31 · 스토리 33) — claude `--model`이 받는 별칭이다. 모델 목록은 Runtime이 Session을 열 때 알려
 * 주므로 새 Thread에는 아직 없다. 별칭은 판이 올라도 그 판의 모델로 풀리고, 2.1.309가 연 목록에도 같은 값으로 있어 첫 말 뒤의 목록에서도
 * 같은 줄이 체크된다. 이름에 판을 적지 않는다 — 무엇으로 풀릴지는 그 claude가 정한다.
 */
export const CLAUDE_MODELS: readonly ChoiceOption[] = [
  { value: "default", name: "Default", description: null },
  { value: "opus", name: "Opus", description: null },
  { value: "fable", name: "Fable", description: null },
  { value: "sonnet", name: "Sonnet", description: null },
  { value: "haiku", name: "Haiku", description: null },
];

/**
 * 물어보는 정도 넷(캔버스 Composer 보드 「아래 줄 메뉴 · 물어보는 정도」) — 보드의 차례 · 이름 · 설명 한 줄 그대로다. 이름은 엔진의
 * 물음 까닭 · 자동 허용 까닭과 같은 글이다(`atelier_acp::AskLevel::name`).
 */
export const ASK_LEVELS: readonly { value: AskLevel; name: string; description: string }[] = [
  { value: "always", name: "매번 묻기", description: "편집과 명령마다 묻는다" },
  { value: "edits", name: "편집 자동", description: "파일 편집은 묻지 않고, 명령은 묻는다" },
  { value: "plan", name: "계획", description: "고치지 않고 계획만 세운다" },
  { value: "auto", name: "묻지 않음", description: "모두 허용한다" },
];

/** 저장 글자 → 물어보는 정도. 모르는 글자면 `null`이다. */
export const askLevelOf = (value: unknown): (typeof ASK_LEVELS)[number] | null =>
  ASK_LEVELS.find((level) => level.value === value) ?? null;

/**
 * 새 채팅의 정도 — 칩이 보일 값(`shown`)과 첫 말과 함께 보낼 값(`sent`, 구현 스펙 「01a — 권한」). 작업공간 없는 새 채팅의 기본은 「편집 자동」이고
 * 보이는 값을 늘 보내 `thread.json`에 적는다 — 칩만 바꾸면 값이 없는 파일을 「매번 묻기」로 읽는 판정과 갈린다. 이은 작업공간의 값은 그 점 파일이
 * 쥐고 있어(값이 없으면 「매번 묻기」), 사람이 고르지 않았으면 보내지 않는다 — 읽는 동안의 칩 글자로 그 값을 덮지 않게. Codex 채팅은 이 값을 보내지
 * 않는다 — 보내면 작업공간이 함께 쓰는 값이 바뀐다(Codex의 모드 칩은 01c-5가 짓는다).
 */
export function newThreadLevel(
  picked: AskLevel | null,
  work: string | null,
  workLevel: AskLevel | null,
  runtime: Runtime = DEFAULT_RUNTIME,
): { shown: AskLevel; sent: AskLevel | null } {
  const shown = work === null ? (picked ?? "edits") : (picked ?? workLevel ?? "always");
  if (runtime !== "claude-code") return { shown, sent: null };
  return { shown, sent: work === null ? shown : picked };
}

/** 새 채팅의 칩에서 고른 것 — Runtime과, 첫 말과 함께 갈 정도 · 모델 · 생각 깊이. */
export interface NewThreadPicks {
  runtime: Runtime;
  mode: AskLevel | null;
  model: string | null;
  effort: string | null;
}

/**
 * Runtime 고르기(스펙 「01c — Codex」 Runtime 없음 · 로그인 필요) — 바꾸면 고른 모델과 생각 깊이를 비운다. Claude 값이 Codex로 가지 않게 하기 위해서다.
 * 같은 Runtime이면 그대로다.
 */
export function pickRuntime<P extends NewThreadPicks>(picks: P, runtime: Runtime): P {
  return runtime === picks.runtime ? picks : { ...picks, runtime, model: null, effort: null };
}

/** 새 채팅의 칩 — Claude Code는 물어보는 정도와 claude가 받는 별칭, 첫 말 전 Codex는 모델 칩 없이 기본 모드만 메뉴 없이 선다. */
export function newThreadChips(
  runtime: Runtime,
  picks: Pick<NewThreadPicks, "model" | "effort">,
  level: AskLevel,
): ComposerChipValues {
  if (runtime === "codex") return { mode: codexMode(undefined, null), model: null };
  return {
    mode: { kind: "ask", level },
    model: { models: CLAUDE_MODELS, model: picks.model ?? "default", efforts: EFFORTS, effort: picks.effort },
  };
}

/** 선 채팅의 칩 — 그 채팅의 Runtime대로 기록(`chipLists`)과 채팅의 값(`ThreadView`)에서 읽는다. 고른 값(채팅의 값)이 Session이 연 값을 이긴다. */
export function threadChips(
  view: Pick<ThreadView, "runtime" | "askLevel" | "model" | "effort" | "codexMode">,
  lists: ChipLists,
): ComposerChipValues {
  if (view.runtime !== "codex") {
    return {
      mode: { kind: "ask", level: view.askLevel },
      // Session을 연 적 없는 채팅(로그인을 기다린다)도 고른다 — 그때의 목록은 claude가 받는 별칭이다(v1 티켓 31).
      model: { models: lists.models ?? CLAUDE_MODELS, model: currentModel(lists, view), efforts: EFFORTS, effort: view.effort },
    };
  }
  const mode = lists.modes?.length === 0 ? null : codexMode(view.codexMode, lists.modes);
  const model =
    lists.models === null
      ? null
      : { models: lists.models, model: view.model ?? lists.model, efforts: lists.efforts, effort: view.effort ?? lists.effort };
  return { mode, model };
}

/** Codex 모드 칩 — 값은 채팅 파일의 것(없으면 기본값), 이름은 Codex가 보낸 목록에서(없으면 앱이 아는 기본값의 이름, 그 밖은 값 그대로). */
function codexMode(value: string | undefined, options: readonly ChoiceOption[] | null): ModeChipValue {
  const chosen = value ?? CODEX_DEFAULT_MODE.value;
  const known = [...(options ?? []), CODEX_DEFAULT_MODE].find((option) => option.value === chosen);
  return { kind: "codex", value: chosen, name: known?.name ?? chosen, options };
}

export function chipLists(lines: readonly RecordLine[]): ChipLists {
  const lists: ChipLists = { models: null, model: null, efforts: null, effort: null, modes: null, commands: [] };
  for (const line of lines) {
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "session": {
        if (payload.state !== "opened") break;
        lists.models = null;
        lists.model = null;
        lists.efforts = null;
        lists.effort = null;
        lists.modes = modeOptions(payload.modes);
        applyConfigOptions(lists, payload.configOptions);
        break;
      }
      case "config": {
        const model = text(payload.model);
        if (model !== null) lists.model = model;
        const effort = text(payload.effort);
        if (effort !== null) lists.effort = effort;
        break;
      }
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        if (!update) break;
        if (update.sessionUpdate === "config_option_update") applyConfigOptions(lists, update.configOptions);
        if (update.sessionUpdate === "available_commands_update") lists.commands = commandOptions(update.availableCommands);
        break;
      }
      default:
        break;
    }
  }
  return lists;
}

/** 칩이 보일 모델 값 — 고른 값(채팅의 값)이 이기고, 없으면 Session이 연 값이다. */
export const currentModel = (lists: ChipLists, view: Pick<ThreadView, "model">): string | null => view.model ?? lists.model;

/**
 * 칩 글자(캔버스 Composer 보드 「Opus · 높음」) — 모델은 목록의 이름에서 괄호 설명을 뗀 것(「Default (recommended)」 → 「Default」),
 * 목록에 없으면 값 그대로다 — 다만 소문자 한 낱말인 별칭(`opus` · `sonnet`, 목록이 서기 전 채팅의 값)은 이름처럼 머리를 대문자로 쓴다.
 * 생각 깊이를 고르지 않았으면 모델만이다. 둘 다 모르면 「기본 모델」이다.
 */
export function chipLabel(
  models: readonly ChoiceOption[] | null,
  model: string | null,
  effort: string | null,
  efforts: readonly ChoiceOption[] | null = EFFORTS,
): string {
  const parts = chipParts(models, model, effort, efforts);
  return [parts.model, parts.depth].filter(Boolean).join(" · ");
}

/**
 * 칩 글자의 두 조각(`chipLabel`과 같은 글) — 칩은 모델을 본문색, 생각 깊이를 옅은 글자로 가른다(02 티켓 10 · 캔버스 v35 Diff-Chat). 생각 깊이의 말은
 * 그 칩의 목록(Claude는 앱의 것, Codex는 Codex가 보낸 것)에서 읽고, 목록이 없으면(Runtime이 선언하지 않았다) 생각 깊이는 서지 않는다.
 */
export function chipParts(
  models: readonly ChoiceOption[] | null,
  model: string | null,
  effort: string | null,
  efforts: readonly ChoiceOption[] | null = EFFORTS,
): { model: string; depth: string | null } {
  const named = model === null ? null : (models?.find((option) => option.value === model)?.name ?? alias(model));
  const short = named?.replace(/\s*\(.*\)\s*$/, "").trim() || null;
  const depth = effort === null || efforts === null ? null : (efforts.find((one) => one.value === effort)?.name ?? effort);
  return { model: short ?? "기본 모델", depth: depth || null };
}

const alias = (model: string): string => (/^[a-z]+$/.test(model) ? model[0].toUpperCase() + model.slice(1) : model);

/**
 * `configOptions`에서 모델과 생각 깊이 — id(`model` · `reasoning_effort`)를 먼저, 없으면 ACP의 category(`model` · `thought_level`)를 읽는다. 그 밖의
 * 설정(Codex의 `mode` · `collaboration_mode` · `fast-mode`)은 읽지 않는다.
 */
function applyConfigOptions(lists: ChipLists, value: unknown): void {
  if (!Array.isArray(value)) return;
  const options = value.filter(isObject);
  const of = (id: string, category: string) => options.find((option) => option.id === id) ?? options.find((option) => option.category === category);
  const model = of("model", "model");
  if (model) {
    lists.models = selectOptions(model.options);
    lists.model = text(model.currentValue) ?? lists.model;
  }
  const effort = of("reasoning_effort", "thought_level");
  if (effort) {
    lists.efforts = selectOptions(effort.options);
    lists.effort = text(effort.currentValue) ?? lists.effort;
  }
}

/** ACP `modes`의 모드 목록 — 낱개 `{id, name, description?}`다. `modes`가 없으면 빈 목록이다(Runtime이 모드를 선언하지 않았다). */
function modeOptions(value: unknown): ChoiceOption[] {
  const modes = isObject(value) && Array.isArray(value.availableModes) ? value.availableModes : [];
  return modes.filter(isObject).flatMap((mode): ChoiceOption[] => {
    const id = text(mode.id);
    return id === null ? [] : [{ value: id, name: text(mode.name) ?? id, description: text(mode.description) }];
  });
}

/** ACP select 선택지 — 낱개(`{value, name, description?}`)와 묶음(`{group, name, options}`) 둘 다 온다. 묶음은 펼친다. */
function selectOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((option): ChoiceOption[] => {
    if (Array.isArray(option.options)) return selectOptions(option.options);
    const id = text(option.value);
    return id === null ? [] : [{ value: id, name: text(option.name) ?? id, description: text(option.description) }];
  });
}

function commandOptions(value: unknown): CommandOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((command) => {
    const name = text(command.name);
    if (name === null || name === "") return [];
    const meta = isObject(command._meta) ? command._meta : null;
    const aliases = meta && Array.isArray(meta.aliases) ? meta.aliases.filter((alias) => typeof alias === "string") : [];
    return [{ name, description: text(command.description) ?? "", aliases }];
  });
}
