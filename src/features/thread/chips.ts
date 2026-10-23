import { isObject, text } from "./json";
import type { AskLevel, Participant, RecordLine } from "./types";

// 입력창 칩과 「/」 메뉴의 원천(v1 티켓 05 · 구현 스펙 §14 「입력창 아래 줄」 · 스토리 33) — 기록 줄에서 그 참여자 Session의 모델 목록 ·
// 명령을, 참여자 줄(`thread.json`)에서 고른 모델 · 생각 깊이를 읽는 **순수 함수**다. three-axes 칩(`chat/chips.ts`)을 옮겨 왔고, Thread
// 에서 달라진 것은 둘이다.
// - **목록은 그 참여자의 줄에서만 읽는다**(`who`) — Thread에는 여러 참여자의 Session이 함께 적힌다(14).
// - **지금 값은 참여자 줄이 이긴다.** 모델 · 생각 깊이 바꾸기는 참여자 줄을 먼저 고치고(Session이 떠 있으면 다음 턴부터 든다), 떠
//   있지 않으면 다음에 띄울 때 그 값으로 연다. 그래서 고른 값이 있으면 그것이고, 없으면(정의 파일에도 없다) Session이 연 값이다.
// 모드 칩은 없다 — 물어보는 정도(v1 티켓 23)가 그 자리를 맡는다. 정도는 Session이 아니라 Thread(Work에 이었으면 Work)의 값이라 기록이
// 아니라 Thread의 지금(`ThreadView.askLevel`)에서 읽는다.

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
  /** 모델 목록 — 마지막 열림 줄의 configOptions `model`. Session을 연 적 없으면 null이다. */
  models: ChoiceOption[] | null;
  /** Session이 알린 지금 모델 — 열림 줄의 currentValue와 그 뒤의 바꿈(`config` · `config_option_update`). */
  model: string | null;
  commands: CommandOption[];
}

/** 생각 깊이 — claude `--effort`가 받는 값과 그 말(낮은 것부터). 엔진의 `EFFORTS`와 같은 차례다. */
export const EFFORTS: readonly { value: string; label: string }[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "중간" },
  { value: "high", label: "높음" },
  { value: "xhigh", label: "아주 높음" },
  { value: "max", label: "최대" },
];

/**
 * 화면이 하는 명령 — Runtime 명령 앞에 보드의 차례로 선다(캔버스 Composer 보드 「/ · 명령」). `/work`는 Work 칩 메뉴를 연다(v1 티켓
 * 31 — 고를 수 있는 첫 말 전에만 선다). `/agent`는 Agent 부르기 메뉴를 연다(v1 티켓 14). `/plan`은 물어보는 정도를 「계획만」으로
 * 바꾸고, `/policy`는 물어보는 정도 메뉴를 연다(v1 티켓 23). `/model`은 그 장이 더한다.
 */
export const THREAD_COMMANDS: readonly CommandOption[] = [
  { name: "new", description: "새 Thread", aliases: [], thread: true },
  { name: "work", description: "Work 만들기 · 붙이기", aliases: [], thread: true },
  { name: "agent", description: "Agent 부르기", aliases: [], thread: true },
  { name: "plan", description: "계획만 세우고 멈추기", aliases: [], thread: true },
  { name: "policy", description: "언제 물어볼지", aliases: [], thread: true },
];

/**
 * 「/」 메뉴의 명령 — 화면 명령 뒤에 Runtime 명령이다. 화면 명령과 이름이 같은 Runtime 명령은 가린다 — 같은 글이 다른 일을 하지 않게.
 * `/work`는 Work 칩을 고를 수 있을 때(`work` — 첫 말 전)만 선다. 첫 말 뒤의 칩은 이은 Work를 보이기만 한다.
 */
export function slashCommands(runtime: readonly CommandOption[], { work = false }: { work?: boolean } = {}): CommandOption[] {
  const taken = new Set(THREAD_COMMANDS.map((command) => command.name));
  const shown = THREAD_COMMANDS.filter((command) => work || command.name !== "work");
  return [...shown, ...runtime.filter((command) => !taken.has(command.name))];
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
 * Policy 이름 · 자동 허용 까닭과 같은 글이다(`atelier_acp::AskLevel::name`).
 */
export const ASK_LEVELS: readonly { value: AskLevel; name: string; description: string }[] = [
  { value: "always", name: "매번 묻기", description: "고치거나 실행하기 전에 묻습니다" },
  { value: "edits", name: "편집은 허용", description: "파일은 알아서, 명령은 묻습니다" },
  { value: "plan", name: "계획만", description: "읽기만 하고 계획을 세웁니다" },
  { value: "auto", name: "알아서", description: "Policy에 적힌 것만 묻습니다" },
];

/** 저장 글자 → 물어보는 정도. 모르는 글자면 `null`이다. */
export const askLevelOf = (value: unknown): (typeof ASK_LEVELS)[number] | null =>
  ASK_LEVELS.find((level) => level.value === value) ?? null;

export function chipLists(lines: readonly RecordLine[], who: string): ChipLists {
  const lists: ChipLists = { models: null, model: null, commands: [] };
  for (const line of lines) {
    if (line.who !== who) continue;
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "session": {
        if (payload.state !== "opened") break;
        lists.models = null;
        lists.model = null;
        applyConfigOptions(lists, payload.configOptions);
        break;
      }
      case "config": {
        const model = text(payload.model);
        if (model !== null) lists.model = model;
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

/** 칩이 보일 모델 값 — 고른 값(참여자 줄)이 이기고, 없으면 Session이 연 값이다. */
export const currentModel = (lists: ChipLists, participant: Participant | null): string | null =>
  participant?.model ?? lists.model;

/**
 * 칩 글자(캔버스 Composer 보드 「Opus · 높음」) — 모델은 목록의 이름에서 괄호 설명을 뗀 것(「Default (recommended)」 → 「Default」),
 * 목록에 없으면 값 그대로다 — 다만 소문자 한 낱말인 별칭(`opus` · `sonnet`, 목록이 서기 전 Host 정의의 값)은 이름처럼 머리를 대문자로 쓴다.
 * 생각 깊이를 고르지 않았으면 모델만이다. 둘 다 모르면 「기본 모델」이다.
 */
export function chipLabel(models: readonly ChoiceOption[] | null, model: string | null, effort: string | null): string {
  const named = model === null ? null : (models?.find((option) => option.value === model)?.name ?? alias(model));
  const short = named?.replace(/\s*\(.*\)\s*$/, "").trim() || null;
  const depth = effort === null ? null : (EFFORTS.find((one) => one.value === effort)?.label ?? effort);
  return [short ?? "기본 모델", depth].filter(Boolean).join(" · ");
}

const alias = (model: string): string => (/^[a-z]+$/.test(model) ? model[0].toUpperCase() + model.slice(1) : model);

function applyConfigOptions(lists: ChipLists, value: unknown): void {
  if (!Array.isArray(value)) return;
  const options = value.filter(isObject);
  const model = options.find((option) => option.id === "model") ?? options.find((option) => option.category === "model");
  if (!model) return;
  lists.models = selectOptions(model.options);
  const current = text(model.currentValue);
  if (current !== null) lists.model = current;
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
