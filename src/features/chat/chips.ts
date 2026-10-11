import { isObject, text } from "./json";
import type { RecordLine } from "./types";

// 칩과 「/」 메뉴의 원천(three-axes 티켓 19 · S15) — 기록 줄을 받아 그 대화의 목록(모드 · 모델 · 계획 · 명령)과 지금 값으로 접는
// **순수 함수**다. 살아 있는 세션의 목록도 기록에 그대로 적히므로(열림 줄 · `session/update` 원문) 화면은 늘 기록에서 그린다 —
// 그래서 앱을 다시 켠 뒤 아직 띄우지 않은 대화도 지난 목록으로 칩과 메뉴가 선다(스토리 36).
//
// - **목록**은 마지막 `session` 열림 줄의 것이다 — 모드는 `modes.availableModes`, 모델은 configOptions `model`의 선택지, 「계획」은
//   configOptions `collaboration_mode`가 있을 때만 선다(Codex). 엔진이 낸 이름 그대로다(three-axes 결정 16). Claude의
//   `bypassPermissions`는 변환기가 내지 않으므로 목록에 없다.
// - **명령**은 마지막 `available_commands_update`다. 엔진이 열 때와 턴마다 다시 보내므로 마지막 것이 지금 목록이다.
// - **에이전트를 바꾸면**(`config`의 `{agent}` 줄, 첫 말 전에만 선다) 앞 엔진의 목록과 명령을 거둔다 — 새 엔진의 열림 줄이 오기
//   전까지는 고를 것이 없다.
//
// **지금 값**은 사람이 고른 값과 엔진이 알린 값 가운데 늦은 것이다.
// - 엔진이 알린 값: 열림 줄의 지금 값, 그 뒤 엔진이 스스로 바꾼 것(`current_mode_update` — Claude가 계획 승인 뒤 모드를 바꾼다 —
//   · `config_option_update`), 사람이 떠 있는 엔진에 넣은 바꾸기(`config` 줄).
// - 사람이 고른 값: 대화 목록(`agents.json`)의 값이다. 띄우지 않은 대화에서 바꾸면 기록에 줄이 서지 않고 목록에만 남으므로(티켓 09)
//   이것이 그 대화의 값이다. 그 값은 언제 골랐는지 적혀 있지 않아서, 마지막 열림 줄과 그 칸의 마지막 `config` 줄보다는 늦고
//   그 뒤 엔진이 스스로 바꾼 것보다는 이르다고 본다. 이 앱이 도는 동안 사람이 칩으로 바꾼 것은 그 답의 마지막 seq 뒤다
//   (`chosenAfter`).

/** 칩 목록의 한 줄 — 모드 · 모델의 선택지. 값 · 이름 · 설명은 엔진이 준 글자 그대로다. */
export interface ChoiceOption {
  value: string;
  name: string;
  description: string | null;
}

/** 「/」 메뉴의 한 줄 — `available_commands_update`의 명령. 별칭은 변환기가 `_meta.aliases`에 싣는다(실측 함정 36). */
export interface CommandOption {
  name: string;
  description: string;
  /** 인자 힌트(`input.hint`). 없으면 null이다. */
  hint: string | null;
  aliases: string[];
}

/** 사람이 고르는 칸 셋 — 대화 목록과 `config` 줄의 칸 이름이다. */
export type ChoiceField = "model" | "mode" | "plan";

export interface Stamped<T> {
  value: T;
  seq: number;
}

export interface ChipLists {
  /** 첫 말을 보냈나 — `sent` 줄이 하나라도 있다. 그 뒤로는 에이전트 칩이 잠긴다(호스트의 거절과 같은 규칙). */
  sent: boolean;
  /** 모드 목록. 열린 세션이 없으면(열림 줄이 없다 · 에이전트를 바꾸고 아직 안 열렸다) null이다. */
  modes: ChoiceOption[] | null;
  /** 모델 목록 — configOptions `model`. 엔진이 내지 않았으면 null이다. */
  models: ChoiceOption[] | null;
  /** 「계획」 토글이 서나 — configOptions에 `collaboration_mode`가 있다(Codex). */
  plannable: boolean;
  commands: CommandOption[];
  /** 엔진이 알린 값 — 칸마다 마지막으로 알린 값과 그 줄의 seq. */
  engine: { model: Stamped<string> | null; mode: Stamped<string> | null; plan: Stamped<boolean> | null };
  /** 사람이 고른 값(대화 목록)이 적어도 이보다는 늦다 — 마지막 열림 줄과 그 칸의 마지막 `config` 줄의 seq. */
  floor: Record<ChoiceField, number>;
}


const EMPTY_FLOOR: Record<ChoiceField, number> = { model: 0, mode: 0, plan: 0 };

export function chipLists(lines: readonly RecordLine[]): ChipLists {
  const lists: ChipLists = {
    sent: false,
    modes: null,
    models: null,
    plannable: false,
    commands: [],
    engine: { model: null, mode: null, plan: null },
    floor: { ...EMPTY_FLOOR },
  };
  for (const line of lines) {
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "sent":
        lists.sent = true;
        break;
      case "session": {
        if (payload.state !== "opened") break;
        const modes = isObject(payload.modes) ? payload.modes : {};
        lists.modes = modeOptions(modes.availableModes);
        const current = text(modes.currentModeId);
        lists.engine.mode = current === null ? null : { value: current, seq: line.seq };
        lists.models = null;
        lists.plannable = false;
        lists.engine.model = null;
        lists.engine.plan = null;
        applyConfigOptions(lists, payload.configOptions, line.seq);
        lists.floor = { model: line.seq, mode: line.seq, plan: line.seq };
        break;
      }
      case "config": {
        // 에이전트를 바꿨다 — 앞 엔진의 목록은 새 엔진의 것이 아니다(머리말).
        if (text(payload.agent) !== null) {
          lists.modes = null;
          lists.models = null;
          lists.plannable = false;
          lists.commands = [];
          lists.engine = { model: null, mode: null, plan: null };
          break;
        }
        const model = text(payload.model);
        if (model !== null) {
          lists.engine.model = { value: model, seq: line.seq };
          lists.floor.model = line.seq;
        }
        const mode = text(payload.mode);
        if (mode !== null) {
          lists.engine.mode = { value: mode, seq: line.seq };
          lists.floor.mode = line.seq;
        }
        if (typeof payload.plan === "boolean") {
          lists.engine.plan = { value: payload.plan, seq: line.seq };
          lists.floor.plan = line.seq;
        }
        break;
      }
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        if (!update) break;
        switch (update.sessionUpdate) {
          case "current_mode_update": {
            const mode = text(update.currentModeId);
            if (mode !== null) lists.engine.mode = { value: mode, seq: line.seq };
            break;
          }
          case "config_option_update":
            applyConfigOptions(lists, update.configOptions, line.seq);
            break;
          case "available_commands_update":
            lists.commands = commandOptions(update.availableCommands);
            break;
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }
  return lists;
}

/**
 * 칩에 보일 지금 값(머리말 「지금 값」) — 사람이 고른 값(`person`, 대화 목록)이 엔진이 알린 마지막 값(`engine`)보다 늦으면 그것, 아니면
 * 엔진의 값이다. `floor`는 그 칸의 바닥(`ChipLists.floor`), `chosenAfter`는 이 앱이 도는 동안 사람이 칩으로 바꾼 답의 마지막 seq다.
 */
export function currentChoice<T extends string | boolean>(
  engine: Stamped<T> | null,
  floor: number,
  person: T | null,
  chosenAfter: number | undefined,
): T | null {
  const personAt = Math.max(floor, chosenAfter ?? 0) + 0.5;
  if (person !== null && (engine === null || personAt > engine.seq)) return person;
  return engine?.value ?? person;
}

/** configOptions에서 모델 목록과 계획을 읽는다 — 열림 줄과 `config_option_update`가 같은 꼴이다. */
function applyConfigOptions(lists: ChipLists, value: unknown, seq: number): void {
  if (!Array.isArray(value)) return;
  const options = value.filter(isObject);
  const model = options.find((option) => option.id === "model") ?? options.find((option) => option.category === "model");
  if (model) {
    lists.models = selectOptions(model.options);
    const current = text(model.currentValue);
    if (current !== null) lists.engine.model = { value: current, seq };
  }
  const collaboration = options.find((option) => option.id === "collaboration_mode");
  if (collaboration) {
    lists.plannable = true;
    const current = text(collaboration.currentValue);
    if (current !== null) lists.engine.plan = { value: current === "plan", seq };
  }
}

/** ACP 모드 목록(`{id, name, description?}`). */
function modeOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((mode) => {
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
    const input = isObject(command.input) ? command.input : null;
    const meta = isObject(command._meta) ? command._meta : null;
    const aliases = meta && Array.isArray(meta.aliases) ? meta.aliases.filter((alias) => typeof alias === "string") : [];
    return [{ name, description: text(command.description) ?? "", hint: input ? text(input.hint) : null, aliases }];
  });
}
