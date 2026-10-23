import { particle, type DecisionEntry, type PendingPermission, type PermissionOption } from "./fold";
import { nonEmpty, type Json } from "./json";
import { baseName, commandOf, diffPathsOf, diffsOf, locationsOf, mcpOf, toolFields, type DiffPiece } from "./tool-view";

// 승인 카드의 화면 값(v1 티켓 24 · 구현 스펙 §9 · 캔버스 Cards · Approval 보드 A안) — 답하지 않은 권한 요청(`PendingPermission`)을 카드의
// 값(얼굴 옆의 물음 · Policy 이름 · 명령이나 diff · 실행할 자리), 선택지 셋, 키 하나의 고르기로 옮기고, 사람이 고른 것(`DecisionEntry`)을
// 결정 줄의 글로 옮기는 **순수 함수**다. 그리는 것은 `ApprovalCard` · `ThreadFlow`다.
//
// - **왜 묻는지는 Policy 이름이다** — 판정이 물음 줄에 단 `policy`(「매번 묻기」 · 「「prisma migrate」 실행 전에 묻기」, v1 티켓 22).
//   Runtime이 준 까닭(Claude `decision_reason` — 「This command requires approval」)은 쓰지 않는다: Atelier가 하나뿐인 판정자다(S17).
// - **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16) — 갈래는 요청 `toolCall`의 kind다. 명령 · 경로는 흐름의 그 도구
//   줄(물음보다 먼저 온 `tool_call`)의 원문이 이긴다. 도구 줄이 없으면 요청의 것을 쓴다.
// - **선택지는 셋으로 고정이다**(보드) — 예 · 예, 이 Work에서는 다시 묻지 않기 · 아니요, 다르게 해 주세요. Runtime의 선택지 이름이 아니라
//   `kind`로 고른다: 「예」 둘은 이번만 허락(`allow_once`), 「아니요」는 이번만 거부(`reject_once`)다 — 「이 대화에서 허락」(Claude
//   `allow_always`)은 Runtime이 기억해 판정에 오지 않게 하므로 고르지 않는다(v1 티켓 22와 같은 까닭). 기억은 Atelier가 한다: 둘째는
//   판정이 물음과 함께 낸 허락(`grant`)을 점 파일에 적는다 — 그 허락이 없는 물음(`ask_before`가 물었다 · 계획 · 그 밖의 도구)에는 둘째가
//   서지 않는다(허락은 `ask_before`를 넘기지 못한다). 셋째는 카드 안에 입력칸을 열고, 보내면 거부와 그 말이 Agent에게 간다.
//   **계획 넘어가기**(kind `switch_mode`, v1 티켓 26 · 스토리 88)는 엔진의 두 선택지를 「계획대로 구현」 · 「계획 다시 쓰기」로 부르고,
//   다시 쓰기가 고칠 점 입력칸을 연다 — 보내면 그 말이 고정 문구와 함께 Agent에게 간다(Claude 변환기). 허락 · 거부 갈래를 고를 수 없는
//   요청이면 엔진의 선택지를 그대로 보인다.

/** 카드의 갈래 — 명령 카드 · 파일 카드 · 계획 · 그 밖의 도구(웹 · MCP · 읽기 …). */
export type CardKind = "command" | "edit" | "plan" | "other";

export interface ApprovalView {
  kind: CardKind;
  /** 얼굴 옆의 물음 — 카드의 이름이기도 하다(「Host가 이 명령을 실행해도 될까요?」). */
  title: string;
  /** 왜 묻는지 — Policy 이름. 판정 없이 물은 옛 기록이면 null이다. */
  policy: string | null;
  /** 명령 카드의 명령. */
  command: string | null;
  /** 파일 카드의 바뀐 내용 — 첫 파일 하나. 편집 내용을 싣지 않은 요청이면 null이다. */
  diff: DiffPiece | null;
  /** 그 밖의 대상 — 경로 · 주소 · MCP 도구. diff가 없는 파일 카드도 경로를 여기 든다. */
  subject: string | null;
  /** 명령 카드의 실행할 자리와 영향 한 줄(「api-server · fix/refund-api worktree에서 실행 · DB 스키마가 바뀝니다」). */
  where: string | null;
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
  const ask = (what: string) => `${name}${particle(name, "이", "가")} ${what}`;
  const base = { policy: request.policy, command: null, diff: null, subject: null, where: null };

  if (request.planReview) return { ...base, kind: "plan", title: ask("이 계획대로 구현해도 될까요?") };
  const mcp = mcpOf(fields);
  if (mcp) return { ...base, kind: "other", title: ask("이 MCP 도구를 써도 될까요?"), subject: `${mcp.server} · ${mcp.tool}` };
  const path = pathOf(call, rawInput);
  switch (kind) {
    case "execute": {
      const effect = nonEmpty(rawInput.description);
      const where = [place, effect].filter((one): one is string => one !== null).join(" · ") || null;
      return { ...base, kind: "command", title: ask("이 명령을 실행해도 될까요?"), command: commandOf(rawInput.command) ?? title, where };
    }
    case "edit":
    case "delete":
    case "move": {
      const verb = kind === "edit" ? "고쳐도" : kind === "delete" ? "지워도" : "옮겨도";
      const diff = diffsOf(call)[0] ?? null;
      return { ...base, kind: "edit", title: ask(`이 파일을 ${verb} 될까요?`), diff, subject: diff ? null : (path ?? title) };
    }
    case "read":
      return { ...base, kind: "other", title: ask("이 파일을 읽어도 될까요?"), subject: path ?? title };
    case "fetch":
      return { ...base, kind: "other", title: ask("이 주소를 가져와도 될까요?"), subject: nonEmpty(rawInput.url) ?? title };
    case "search":
      return { ...base, kind: "other", title: ask("이렇게 찾아봐도 될까요?"), subject: title };
    default:
      return { ...base, kind: "other", title: ask("이 도구를 써도 될까요?"), subject: title ?? toolName };
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

/** 선택지 하나 — 카드의 번호 줄. */
export interface CardChoice {
  /** 고를 선택지(`optionId`). */
  option: string;
  label: string;
  /** 「다시 묻지 않기」 — 판정이 낸 허락을 점 파일에 적고 답한다. */
  remember: boolean;
  /** 고르면 카드 안에 입력칸이 열린다(「아니요, 다르게 해 주세요」) — 보내야 답이 간다. */
  opensField: boolean;
}

/** 선택지들 — 차례가 곧 번호다. `scope`는 「다시 묻지 않기」를 둘 자리(이은 Work, 없으면 이 Thread)다. */
export function cardChoices(request: PendingPermission, scope: "work" | "thread"): CardChoice[] {
  const pick = (option: PermissionOption, label: string, more: Partial<CardChoice> = {}): CardChoice => ({
    option: option.optionId,
    label,
    remember: false,
    opensField: false,
    ...more,
  });
  const of = (...kinds: string[]) =>
    kinds.map((kind) => request.options.find((option) => option.kind === kind)).find((option) => option !== undefined);
  if (request.planReview) {
    return request.options.map((option) =>
      option.kind.startsWith("allow")
        ? pick(option, "계획대로 구현")
        : option.kind.startsWith("reject")
          ? pick(option, "계획 다시 쓰기", { opensField: true })
          : pick(option, option.name),
    );
  }
  const allow = of("allow_once", "allow_always");
  const reject = of("reject_once", "reject_always");
  if (!allow || !reject) return request.options.map((option) => pick(option, option.name));
  const where = scope === "work" ? "이 Work에서는" : "이 Thread에서는";
  const what = request.grant.includes("edit") ? "편집을 " : "";
  return [
    pick(allow, "예"),
    ...(request.grant.length > 0 ? [pick(allow, `예, ${where} ${what}다시 묻지 않기`, { remember: true })] : []),
    pick(reject, "아니요, 다르게 해 주세요", { opensField: true }),
  ];
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

/** 카드 안 입력칸의 이름 — 「아니요, 다르게 해 주세요」는 다르게 할 방법을, 「계획 다시 쓰기」는 고칠 점을 받는다(v1 티켓 26). */
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

/** 결정 줄의 무엇 — 도구 요지의 kind로 고른다(목적격 조사까지). */
const DECIDED: Readonly<Record<string, string>> = {
  execute: "명령 실행을",
  edit: "파일 고치기를",
  delete: "파일 지우기를",
  move: "파일 옮기기를",
  read: "파일 읽기를",
  fetch: "주소 가져오기를",
  search: "검색을",
};

/**
 * 결정 줄의 글(캔버스 Screen-Thread · Approval 보드 「결정한 뒤」) — 「명령 실행을 승인함」 · 「명령 실행을 승인함 · 이 Work에서는 다시 묻지
 * 않음」 · 「명령 실행을 거부함」. 남긴 말은 그리는 쪽이 글 뒤에 따로 든다.
 */
export function decisionText(entry: DecisionEntry): string {
  // 계획 넘어가기는 고른 것 그대로다(v1 티켓 26) — 「계획을 승인함」은 무엇이 이어지는지 말하지 않는다.
  if (entry.planReview) return entry.allowed ? "계획대로 구현하기로 함" : "계획을 다시 쓰기로 함";
  const fields = toolFields(entry.toolCall);
  const what = mcpOf(fields) ? "MCP 도구 쓰기를" : (DECIDED[fields.kind] ?? "도구 쓰기를");
  const decided = `${what} ${entry.allowed ? "승인함" : "거부함"}`;
  if (!entry.granted) return decided;
  const where = entry.granted.work ? "이 Work에서는" : "이 Thread에서는";
  const edits = entry.granted.rules.includes("edit") ? "편집을 " : "";
  return `${decided} · ${where} ${edits}다시 묻지 않음`;
}
