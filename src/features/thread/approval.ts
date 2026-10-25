import { particle, type DecisionEntry, type PendingPermission, type PermissionOption } from "./fold";
import { nonEmpty, type Json } from "./json";
import { baseName, commandOf, diffPathsOf, diffsOf, locationsOf, mcpOf, toolFields, type DiffPiece } from "./tool-view";

// 승인 카드의 화면 값(v1 티켓 24 · 02 구현 스펙 §10 · 캔버스 v35 Screen-Live 단계 4) — 답하지 않은 권한 요청(`PendingPermission`)을
// 카드의 값(머리 한 줄 · 물음 · 어디서 한 줄 · 명령이나 diff), 선택지, 키 하나의 고르기로 옮기고, 사람이 고른 것(`DecisionEntry`)을
// 결정 줄의 글로 옮기는 **순수 함수**다. 그리는 것은 `ApprovalCard` · `ThreadFlow`다.
//
// - **머리 한 줄이 누가 · 무슨 일 · 왜 묻는지다** — 「Host · 명령 실행 · 「스키마를 바꾸기 전에 묻기」」. 왜는 판정이 물음 줄에 단 Policy
//   규칙 이름(`policy`, v1 티켓 22)이고, 없으면 그 조각을 뺀다. Runtime이 준 까닭(Claude `decision_reason` — 「This command requires
//   approval」)은 쓰지 않는다: Atelier가 하나뿐인 판정자다(S17). 머리가 Agent를 말하니 보이는 물음은 이름 없이 선다(「이 명령을 실행해도
//   될까요?」) — 카드의 이름(`label`)은 누가 묻는지까지 든 물음이다.
// - **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16) — 갈래는 요청 `toolCall`의 kind다. 명령 · 경로는 흐름의 그 도구
//   줄(물음보다 먼저 온 `tool_call`)의 원문이 이긴다. 도구 줄이 없으면 요청의 것을 쓴다.
// - **승인 카드는 단추 줄이다**(02 §10) — 왼쪽에서 「아니요, 다르게」(esc) · 「이 Work에서 늘 허용」 · 맨 오른쪽 「이번만 허용」(↵).
//   Runtime의 선택지 이름이 아니라 `kind`로 고른다: 허용 둘은 이번만 허락(`allow_once`), 「아니요」는 이번만 거부(`reject_once`)다 — 「이
//   대화에서 허락」(Claude `allow_always`)은 Runtime이 기억해 판정에 오지 않게 하므로 고르지 않는다(v1 티켓 22와 같은 까닭). 기억은
//   Atelier가 한다: 「늘 허용」은 판정이 물음과 함께 낸 허락(`grant`)을 점 파일에 적는다 — 그 허락이 없는 물음(`ask_before`가 물었다 ·
//   그 밖의 도구)에는 그 단추가 서지 않는다(허락은 `ask_before`를 넘기지 못한다). 「아니요, 다르게」는 카드 안에 입력칸을 열고, 보내면
//   거부와 그 말이 Agent에게 간다. **숫자 키는 없다**(S25 — 단추 줄의 눈 차례와 숫자 차례가 엇갈린다).
// - **계획 넘어가기**(kind `switch_mode`, v1 티켓 26 · 스토리 88)는 번호 줄 그대로다 — 엔진의 두 선택지를 「계획대로 구현」 · 「계획 다시
//   쓰기」로 부르고, 다시 쓰기가 고칠 점 입력칸을 연다 — 보내면 그 말이 고정 문구와 함께 Agent에게 간다(Claude 변환기). 허락 · 거부
//   갈래를 고를 수 없는 요청이면 엔진의 선택지를 그대로 번호 줄로 보인다.

/** 카드의 갈래 — 명령 카드 · 파일 카드 · 계획 · 그 밖의 도구(웹 · MCP · 읽기 …). */
export type CardKind = "command" | "edit" | "plan" | "other";

export interface ApprovalView {
  kind: CardKind;
  /** 머리 한 줄 — 「Host · 명령 실행 · 「스키마를 바꾸기 전에 묻기」」. 규칙 이름이 없으면 「Host · 명령 실행」이다. */
  head: string;
  /** 보이는 물음(14/500) — 「이 명령을 실행해도 될까요?」. */
  title: string;
  /** 카드의 이름 — 누가 묻는지까지 든 물음(「Host가 이 명령을 실행해도 될까요?」). */
  label: string;
  /** 명령 카드의 명령. */
  command: string | null;
  /** 파일 카드의 바뀐 내용 — 첫 파일 하나. 편집 내용을 싣지 않은 요청이면 null이다. */
  diff: DiffPiece | null;
  /** 그 밖의 대상 — 경로 · 주소 · MCP 도구. diff가 없는 파일 카드도 경로를 여기 든다. */
  subject: string | null;
  /** 어디서 한 줄 — 명령 카드의 실행할 자리와 영향(「api-server · fix/refund-api worktree에서 실행 · DB 스키마가 바뀝니다」). */
  where: string | null;
}

/** 무슨 일 — 도구 요지의 kind로 고른다. 머리 한 줄과 결정 줄이 같이 읽는다. */
const ACTS: Readonly<Record<string, string>> = {
  execute: "명령 실행",
  edit: "파일 고치기",
  delete: "파일 지우기",
  move: "파일 옮기기",
  read: "파일 읽기",
  fetch: "주소 가져오기",
  search: "검색",
};
const MCP_ACT = "MCP 도구 쓰기";
const OTHER_ACT = "도구 쓰기";

/** 요청이 하려는 일 — MCP 도구면 「MCP 도구 쓰기」, 모르는 kind면 「도구 쓰기」다. */
function actOf(toolCall: Json): string {
  const fields = toolFields(toolCall);
  return mcpOf(fields) ? MCP_ACT : (ACTS[fields.kind] ?? OTHER_ACT);
}

/**
 * 카드의 값. `name`은 물은 참여자의 화면 이름, `place`는 그 Session이 일하는 자리(`placeOf`)다. 영향은 Runtime이 명령에 단 설명
 * (Claude Bash의 `description`)이다.
 */
export function describeApproval(request: PendingPermission, name: string, place: string | null): ApprovalView {
  // 흐름의 도구 줄이 이긴다(머리말) — 호스트가 채운 요지는 빈 칸만 채운 것이라, 겹치는 칸은 도구 줄의 원문이 더 정확하다.
  const call: Json = { ...request.toolCall, ...(request.tool?.call ?? {}) };
  const fields = toolFields(call);
  const { rawInput, title, kind, toolName } = fields;
  const rule = request.policy === null ? [] : [`「${request.policy}」`];
  const asked = (act: string, question: string) => ({
    head: [name, act, ...rule].join(" · "),
    title: question,
    label: `${name}${particle(name, "이", "가")} ${question}`,
  });
  const base = { command: null, diff: null, subject: null, where: null };

  if (request.planReview) return { ...base, kind: "plan", ...asked("계획 구현", "이 계획대로 구현해도 될까요?") };
  const act = actOf(call);
  const mcp = mcpOf(fields);
  if (mcp) return { ...base, kind: "other", ...asked(act, "이 MCP 도구를 써도 될까요?"), subject: `${mcp.server} · ${mcp.tool}` };
  const path = pathOf(call, rawInput);
  switch (kind) {
    case "execute": {
      const effect = nonEmpty(rawInput.description);
      const where = [place, effect].filter((one): one is string => one !== null).join(" · ") || null;
      return {
        ...base,
        kind: "command",
        ...asked(act, "이 명령을 실행해도 될까요?"),
        command: commandOf(rawInput.command) ?? title,
        where,
      };
    }
    case "edit":
    case "delete":
    case "move": {
      const verb = kind === "edit" ? "고쳐도" : kind === "delete" ? "지워도" : "옮겨도";
      const diff = diffsOf(call)[0] ?? null;
      return { ...base, kind: "edit", ...asked(act, `이 파일을 ${verb} 될까요?`), diff, subject: diff ? null : (path ?? title) };
    }
    case "read":
      return { ...base, kind: "other", ...asked(act, "이 파일을 읽어도 될까요?"), subject: path ?? title };
    case "fetch":
      return { ...base, kind: "other", ...asked(act, "이 주소를 가져와도 될까요?"), subject: nonEmpty(rawInput.url) ?? title };
    case "search":
      return { ...base, kind: "other", ...asked(act, "이렇게 찾아봐도 될까요?"), subject: title };
    default:
      return { ...base, kind: "other", ...asked(act, "이 도구를 써도 될까요?"), subject: title ?? toolName };
  }
}

/** 도구가 다루는 파일 — ACP `locations[].path`, 없으면 입력의 경로 칸(Claude `file_path`) · diff 내용의 경로. */
function pathOf(call: Json, rawInput: Json): string | null {
  const paths = [...locationsOf(call), nonEmpty(rawInput.file_path), nonEmpty(rawInput.path), ...diffPathsOf(call)];
  return paths.find((one) => one !== null) ?? null;
}

/** 실행할 자리를 읽는 데 드는 Work의 자리들 — `WorkView`의 칸 그대로다. */
export interface WorkPlaces {
  branch: string | null;
  specDir: string;
  worktrees: readonly { project: string; path: string }[];
}

/**
 * 명령을 실행할 자리 — 물은 참여자의 Session 작업 폴더(`cwd`)를 이은 Work의 자리들과 견준다(v1 구현 스펙 §11 · three-axes 결정 17).
 * worktree면 「Project · 브랜치 worktree」, worktree들을 품은 폴더(Project 여럿)면 「Work의 worktree 폴더」, spec 폴더면 그 이름, 그 밖은
 * 폴더 이름이다. Work 없는 Thread의 Session은 Thread 폴더에서 일한다(S11). **폴더 이름으로 가르지 않는다** — 프런트는 Work 폴더의
 * 짜임을 모른다(`shell-registry.test.ts`의 경로 조각 지킴). 모르면 null이다.
 */
export function placeOf(cwd: string | null, work: WorkPlaces | null): string | null {
  if (!cwd) return null;
  if (!work) return "Thread 폴더에서 실행";
  const bare = (path: string) => path.replace(/\/+$/, "");
  const here = bare(cwd);
  const tree = work.worktrees.find((one) => bare(one.path) === here);
  if (tree) return `${[tree.project, work.branch].filter(Boolean).join(" · ")} worktree에서 실행`;
  if (here === bare(work.specDir)) return "spec 폴더에서 실행";
  if (work.worktrees.length > 0 && work.worktrees.every((one) => bare(one.path).startsWith(`${here}/`))) {
    return "Work의 worktree 폴더에서 실행";
  }
  return `${baseName(here)} 폴더에서 실행`;
}

/** 선택지 하나 — 승인 카드의 단추 하나, 또는 계획 카드의 번호 줄 하나. */
export interface CardChoice {
  /** 고를 선택지(`optionId`). */
  option: string;
  label: string;
  /** 「늘 허용」 — 판정이 낸 허락을 점 파일에 적고 답한다. */
  remember: boolean;
  /** 고르면 카드 안에 입력칸이 열린다(「아니요, 다르게」 · 「계획 다시 쓰기」) — 보내야 답이 간다. */
  opensField: boolean;
  /** 단추 끝에 옅게 적히는 글쇠 — 「이번만 허용」은 ↵, 「아니요, 다르게」는 esc다. 번호 줄은 null이다. */
  key: "enter" | "escape" | null;
}

/**
 * 카드의 선택지들과 그 모양 — **단추 줄**(승인, 02 §10 · Screen-Live 단계 4)은 배열 차례가 곧 왼쪽에서 오른쪽이고 ↵ · esc만 받는다(S25 —
 * 숫자 키를 걷었다: 단추 줄이 오른쪽으로 무거워져 숫자 차례와 눈 차례가 엇갈린다). **번호 줄**(계획 넘어가기 · 엔진의 선택지 그대로)은
 * 차례가 곧 번호이고 숫자 · Enter · Esc · ↑↓로 고른다(`cardKey`).
 */
export interface CardChoices {
  layout: "buttons" | "rows";
  choices: CardChoice[];
}

/** 선택지들. `scope`는 「늘 허용」을 둘 자리(이은 Work, 없으면 이 Thread)다. */
export function cardChoices(request: PendingPermission, scope: "work" | "thread"): CardChoices {
  const pick = (option: PermissionOption, label: string, more: Partial<CardChoice> = {}): CardChoice => ({
    option: option.optionId,
    label,
    remember: false,
    opensField: false,
    key: null,
    ...more,
  });
  const of = (...kinds: string[]) =>
    kinds.map((kind) => request.options.find((option) => option.kind === kind)).find((option) => option !== undefined);
  if (request.planReview) {
    return {
      layout: "rows",
      choices: request.options.map((option) =>
        option.kind.startsWith("allow")
          ? pick(option, "계획대로 구현")
          : option.kind.startsWith("reject")
            ? pick(option, "계획 다시 쓰기", { opensField: true })
            : pick(option, option.name),
      ),
    };
  }
  const allow = of("allow_once", "allow_always");
  const reject = of("reject_once", "reject_always");
  if (!allow || !reject) return { layout: "rows", choices: request.options.map((option) => pick(option, option.name)) };
  const always = alwaysAllow(scope === "work", request.grant.includes("edit"));
  return {
    layout: "buttons",
    choices: [
      pick(reject, "아니요, 다르게", { opensField: true, key: "escape" }),
      ...(request.grant.length > 0 ? [pick(allow, always, { remember: true })] : []),
      pick(allow, "이번만 허용", { key: "enter" }),
    ],
  };
}

/** 건너뛰는 것 — 카드의 갈래로 고른다. */
const SKIPPED: Readonly<Record<CardKind, string>> = { command: "이 명령은", edit: "이 편집은", plan: "이 계획은", other: "이 요청은" };

/**
 * 고르기 전에 할 말(v1 티켓 25 · 스토리 83 · 캔버스 Approval 보드 「고르기 전에 할 말이 있을 때」) — 카드 안 입력칸에 말을 쓰는 동안 그
 * 아래에 서는 한 줄이다. 승인을 기다리는 Agent는 그사이 다른 말에 답하지 못해서, 보내면 그 요청을 거부하고 말이 거부의 글로 간다.
 */
export function skipHint(kind: CardKind, name: string): string {
  // 계획 다시 쓰기의 말은 건너뛰기가 아니라 고칠 점이다(v1 티켓 26).
  if (kind === "plan") return `보내면 ${name}${particle(name, "이", "가")} 이 말대로 계획을 다시 써요`;
  return `보내면 ${SKIPPED[kind]} 건너뛰고 ${name}에게 말을 전해요`;
}

/** 카드 안 입력칸의 이름 — 「아니요, 다르게」는 다르게 할 방법을, 「계획 다시 쓰기」는 고칠 점을 받는다(v1 티켓 26). */
export function fieldLabel(kind: CardKind, name: string): string {
  return kind === "plan" ? `${name}에게 고칠 점 알려 주기` : `${name}에게 다르게 할 방법 알려 주기`;
}

/** 카드가 받은 키 — 물리 키(`code`)와 수식키 넷(`hotkeys.ts`의 `KeyChord`와 같은 까닭으로 `KeyboardEvent`를 이름으로 받지 않는다). */
export interface CardPress {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 키 하나의 고르기(스토리 76) — 숫자는 그 번호의 선택지, Enter는 켜진 줄(처음엔 첫째), Esc는 마지막, ↑↓는 켜진 줄 옮기기(끝에서 돈다)다.
 * 카드 안 키라 단축키 표 밖이다(`hotkeys.ts` 머리말 「목록 안 움직임」) — 그래서 `key`가 아니라 `code`로 본다(한글 입력기). 수식키가 붙으면
 * 고르지 않는다 — ⌘1 · ⌘Enter는 앱의 단축키다.
 */
export function cardKey(press: CardPress, count: number, active: number): { pick: number } | { point: number } | null {
  if (press.metaKey || press.ctrlKey || press.altKey || press.shiftKey || count === 0) return null;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(press.code);
  if (digit) {
    const at = Number(digit[1]) - 1;
    return at < count ? { pick: at } : null;
  }
  switch (press.code) {
    case "Enter":
    case "NumpadEnter":
      return { pick: Math.min(active, count - 1) };
    case "Escape":
      return { pick: count - 1 };
    case "ArrowDown":
      return { point: (active + 1) % count };
    case "ArrowUp":
      return { point: (active - 1 + count) % count };
    default:
      return null;
  }
}

/**
 * 승인 카드 단추 줄의 키(02 §10 · S25) — ↵는 「이번만 허용」, esc는 「아니요, 다르게」뿐이다. 숫자 · ↑↓는 없다. 단추에 포커스가 있으면
 * (`focused` — Tab으로 옮겨 간 손) ↵는 그 단추다. 고를 선택지의 자리를 낸다. 수식키가 붙으면 고르지 않는다(`cardKey`와 같은 까닭).
 */
export function buttonKey(press: CardPress, choices: readonly CardChoice[], focused: number | null): number | null {
  if (press.metaKey || press.ctrlKey || press.altKey || press.shiftKey) return null;
  const keyed = (key: CardChoice["key"]) => {
    const at = choices.findIndex((choice) => choice.key === key);
    return at < 0 ? null : at;
  };
  switch (press.code) {
    case "Enter":
    case "NumpadEnter":
      return focused !== null && focused < choices.length ? focused : keyed("enter");
    case "Escape":
      return keyed("escape");
    default:
      return null;
  }
}

/**
 * 결정 줄의 글(캔버스 Screen-Thread · Approval 보드 「결정한 뒤」) — 「명령 실행을 승인함」 · 「명령 실행을 승인함 · 이 Work에서 늘 허용」 ·
 * 「명령 실행을 거부함」. 늘 허용의 꼬리는 승인 카드의 단추 글(`cardChoices`)과 같은 말이다. 남긴 말은 그리는 쪽이 글 뒤에 따로 든다.
 */
export function decisionText(entry: DecisionEntry): string {
  // 계획 넘어가기는 고른 것 그대로다(v1 티켓 26) — 「계획을 승인함」은 무엇이 이어지는지 말하지 않는다.
  if (entry.planReview) return entry.allowed ? "계획대로 구현하기로 함" : "계획을 다시 쓰기로 함";
  const act = actOf(entry.toolCall);
  const decided = `${act}${particle(act, "을", "를")} ${entry.allowed ? "승인함" : "거부함"}`;
  if (!entry.granted) return decided;
  return `${decided} · ${alwaysAllow(Boolean(entry.granted.work), entry.granted.rules.includes("edit"))}`;
}

/**
 * **「늘 허용」의 말은 여기 하나다** — 승인 카드의 단추(`cardChoices`), 결정 줄의 꼬리(`decisionText`), 방패 줄의 까닭(`autoAllowReason`)이 같은
 * 허락을 같은 말로 부른다(02 §10 · 02 코드 리뷰 A1 — 한때 둘이 따로 지었고, 방패 줄은 엔진의 옛 이름 「다시 묻지 않기」였다). 허락을 둔 자리
 * (이은 Work, 없으면 그 Thread — S18)와 편집 허락인가로 네 갈래다: 「이 Work에서 늘 허용」 · 「이 Thread에서 편집은 늘 허용」 ….
 */
function alwaysAllow(inWork: boolean, edits: boolean): string {
  return `${inWork ? "이 Work에서" : "이 Thread에서"} ${edits ? "편집은 " : ""}늘 허용`;
}

/**
 * 엔진이 「늘 허용」 허락으로 넘긴 요청에 적는 까닭(판정 줄의 `reason` — `crates/atelier-acp/src/policy.rs`) → 화면의 말. 엔진 · 기록은 그 허락을
 * 옛 이름으로 적고 이 판은 엔진을 바꾸지 않는다(02 구현 스펙 §13) — 지난 기록도 같은 이름이다. 엔진의 까닭은 허락이 편집인지 말하지 않아
 * 「편집은」이 없다.
 */
const ENGINE_GRANT_REASONS: Readonly<Record<string, string>> = {
  "이 Work에서는 다시 묻지 않기": alwaysAllow(true, false),
  "이 Thread에서는 다시 묻지 않기": alwaysAllow(false, false),
};

/**
 * 방패 줄의 까닭(v1 티켓 23 · `WorkLog`의 `AutoLine`) — 판정이 묻지 않고 허용한 까닭을 화면의 말로. 「늘 허용」으로 준 허락이면 카드의 말이고
 * (`ENGINE_GRANT_REASONS`), 물어보는 정도(「편집은 허용」) · `tools.cli`(「「gh」 명령은 묻지 않기」)의 까닭은 엔진이 적은 그대로다.
 */
export function autoAllowReason(reason: string): string {
  return ENGINE_GRANT_REASONS[reason] ?? reason;
}
