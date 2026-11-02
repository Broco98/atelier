import { particle } from "@/lib/particle";
import { type DecisionEntry, type PendingPermission, type PermissionOption } from "./fold";
import { nonEmpty, type Json } from "./json";
import { toolFields } from "./tool-fields";
import { commandOf, diffPathsOf, diffsOf, locationsOf, shownPath, type DiffPiece, type ToolGlyph } from "./tool-view";
import type { Runtime } from "./types";

// 승인 카드의 화면 값(v1 티켓 24 · restart 02b-5 · 시안 Cards 보드 「승인 카드 — 입력창 자리에 선다」) — 답하지 않은 권한 요청(`PendingPermission`)을
// 카드의 값(갈래 · 물음 · 명령이나 줄어든 diff · 아래 한 줄), 선택지, 키 하나의 고르기로 옮기고, 사람이 고른 것(`DecisionEntry`)을 결정 줄의 글로 옮기는
// **순수 함수**다. 그리는 것은 `ApprovalCard` · `ThreadFlow`다.
//
// - **물음 한 문장이 누가 · 무엇을 하려는지다** — 「Claude Code가 이 명령을 실행하도록 허용할까요?」 · 「github에 delete_file 도구 실행을 허용할까요?」.
//   카드의 이름도 그 문장이다. 위에 갈래(「터미널」 · 「파일 편집」 · 「인터넷 액세스」 · 「MCP」 · 「계획」), 아래에 사유나 대상 한 줄이 선다. 판정의
//   까닭(`policy`)과 Runtime이 준 까닭(Claude `decision_reason`)은 싣지 않는다 — 보드에 자리가 없고, Atelier가 하나뿐인 판정자다(S17).
// - **엔진 이름이 아니라 ACP 모양으로 가른다**(three-axes 결정 16) — 갈래는 요청 `toolCall`의 kind다. 명령 · 경로는 흐름의 그 도구
//   줄(물음보다 먼저 온 `tool_call`)의 원문이 이긴다. 도구 줄이 없으면 요청의 것을 쓴다.
// - **승인 카드는 단추 줄이다**(Cards 보드 `.acts`) — 왼쪽 허락 문구(「비슷한 명령 허용」 · 「이 작업공간의 모든 편집 허용」), 오른쪽 「거부」(esc) ·
//   「한 번만 허용」(↵). Runtime의 선택지 이름이 아니라 `kind`로 고른다: 허용 둘은 이번만 허락(`allow_once`), 「거부」는 이번만 거부(`reject_once`)다 —
//   「이 대화에서 허락」(Claude `allow_always`)은 Runtime이 기억해 판정에 오지 않게 하므로 고르지 않는다(v1 티켓 22와 같은 까닭). 기억은 Atelier가 한다:
//   허락 문구는 판정이 물음과 함께 낸 허락(`grant`)을 점 파일에 적는다 — 그 허락이 없는 물음(앱 경계가 물었다 · 그 밖의 도구)에는 그 단추가 서지
//   않는다(허락은 앱 경계를 넘기지 못한다). Claude의 「거부」는 카드 안에 입력칸을 열고, 보내면 거부와 그 말이 Runtime에게 간다. **숫자 키는 없다**
//   (S25 — 단추 줄의 눈 차례와 숫자 차례가 엇갈린다).
// - **Codex는 보낸 선택지를 그대로 그린다**(01c-7 · 스펙 「01c — Codex」 권한 판정 · Cards 보드 「네트워크 · 샌드박스 밖」) — `allow_always`는 Codex가 보낸
//   이름 그대로 왼쪽 단추이고 긴 이름은 단추 안에서 접힌다(`codexChoices`). 기억은 Codex가 하고, 거부에 남긴 말은 Codex에 닿지 않는다.
// - **계획 넘어가기**(kind `switch_mode`, 스토리 65 · Cards 보드 「계획 승인」)는 「다시 짜기」 · 「구현」(↵) 단추다 — 다시 짜기(esc — 글쇠는 그리지 않는다)가
//   고칠 점 입력칸을 연다(보내면 그 말이 고정 문구와 함께 Runtime에게 간다 — Claude 변환기). 허락 · 거부 갈래를 고를 수 없는 요청이면 엔진의 선택지를 그대로 번호 줄로 보인다.

/** 카드의 갈래 — 명령 카드 · 파일 카드 · 계획 · 그 밖의 도구(웹 · MCP · 읽기 …). 카드 안 입력칸의 말이 갈래로 갈린다. */
export type CardKind = "command" | "edit" | "plan" | "other";

/** 카드 머리의 갈래(보드 `.kind`) — 글리프는 작업 로그의 종류 글리프와 같고(`ToolGlyph`), 계획은 지도다. */
export interface CardBadge {
  glyph: ToolGlyph | "plan";
  label: string;
}

export interface ApprovalView {
  kind: CardKind;
  /** 머리의 갈래 — 「터미널」 · 「파일 편집」 · 「인터넷 액세스」 · 「MCP」 · 「계획」 …. */
  badge: CardBadge;
  /** 물음(14 / 20 · 500) — 누가 묻는지까지 든 한 문장(「Claude Code가 이 명령을 실행하도록 허용할까요?」)이고 카드의 이름이다. */
  title: string;
  /** 명령 카드의 명령 — 고정폭 상자(`.cmd`)에 선다. */
  command: string | null;
  /** 파일 카드의 바뀐 내용 — 첫 파일 하나(줄어든 diff `.ra-mdiff`). 편집 내용을 싣지 않은 요청이면 null이다. */
  diff: DiffPiece | null;
  /** 아래 한 줄(`.why` 12 / 18 `fg-tool`) — 명령의 사유(「사유 · …」), 파일 · 주소 · 검색어 같은 대상. 없으면 서지 않는다. */
  why: string | null;
  /** MCP 도구에 보낸 값 — 「세부 정보 보기」가 카드 안에서 펼친다(스펙 「02b — 대화창」). MCP가 아니면 null이다. */
  details: Json | null;
  /**
   * 무엇을 기다리나 한 마디 — 사이드바 · 상태 줄의 미리보기(「승인 · pnpm test」)가 읽는다(`status.ts`). 명령 · 파일 · 주소 · 검색어 · 「서버 · 도구」 ·
   * 도구 이름이고, 계획은 null이다. 카드에는 서지 않는다.
   */
  subject: string | null;
}

/** 파일 카드의 갈래 이름과 물음의 동사 — 도구 kind로 고른다. */
const FILE_ACTS: Readonly<Record<string, { label: string; verb: string }>> = {
  edit: { label: "파일 편집", verb: "편집하도록" },
  delete: { label: "파일 삭제", verb: "지우도록" },
  move: { label: "파일 이동", verb: "옮기도록" },
};

/**
 * 카드의 값(Cards 보드 「승인 카드」 여섯 칸). `name`은 그 채팅의 Runtime 이름, `cwd`는 물은 Session의 작업 폴더다 — 파일 자리를 그 폴더에서 본
 * 자리로 줄인다. 명령의 사유는 Runtime이 명령에 단 설명(Claude Bash의 `description`)이다. 판정의 까닭(`policy`)과 실행할 자리는 보드에 자리가 없어
 * 싣지 않는다 — 카드가 선 것이 곧 판정이 물은 것이고, 자리는 탭 줄 · 창 머리가 말한다.
 */
export function describeApproval(request: PendingPermission, name: string, cwd: string | null): ApprovalView {
  // 흐름의 도구 줄이 이긴다(머리말) — 호스트가 채운 요지는 빈 칸만 채운 것이라, 겹치는 칸은 도구 줄의 원문이 더 정확하다.
  const call: Json = { ...request.toolCall, ...(request.tool?.call ?? {}) };
  const { rawInput, title, kind, toolName, mcp } = toolFields(call);
  const who = `${name}${particle(name, "이", "가")}`;
  const base = { command: null, diff: null, why: null, details: null, subject: null };
  const card = (cardKind: CardKind, glyph: CardBadge["glyph"], label: string, question: string) => ({
    ...base,
    kind: cardKind,
    badge: { glyph, label },
    title: question,
  });
  const place = (path: string | null) => (path === null ? null : shownPath(path, cwd));

  if (request.planReview) return card("plan", "plan", "계획", "이 계획대로 진행할까요?");
  if (mcp) {
    return { ...card("other", "mcp", "MCP", `${mcp.server}에 ${mcp.tool} 도구 실행을 허용할까요?`), details: mcp.input, subject: `${mcp.server} · ${mcp.tool}` };
  }
  const path = pathOf(call, rawInput);
  switch (kind) {
    case "execute": {
      const effect = nonEmpty(rawInput.description);
      const command = commandOf(rawInput.command) ?? title;
      return {
        ...card("command", "execute", "터미널", `${who} 이 명령을 실행하도록 허용할까요?`),
        command,
        why: effect === null ? null : `사유 · ${effect}`,
        subject: command,
      };
    }
    case "edit":
    case "delete":
    case "move": {
      const act = FILE_ACTS[kind];
      const diff = diffsOf(call)[0] ?? null;
      const file = diff?.path ?? path;
      return { ...card("edit", "edit", act.label, `${who} 이 파일을 ${act.verb} 허용할까요?`), diff, why: place(file) ?? title, subject: file ?? title };
    }
    case "read":
      return { ...card("other", "read", "파일 읽기", `${who} 이 파일을 읽도록 허용할까요?`), why: place(path) ?? title, subject: path ?? title };
    case "fetch": {
      const url = nonEmpty(rawInput.url);
      const host = url === null ? null : hostOf(url);
      const question = host === null ? `${who} 이 주소에 연결하도록 허용할까요?` : `${who} ${host}에 연결하도록 허용할까요?`;
      return { ...card("other", "web", "인터넷 액세스", question), why: url ?? title, subject: url ?? title };
    }
    case "search":
      return { ...card("other", "search", "검색", `${who} 이렇게 찾아보도록 허용할까요?`), why: title, subject: title };
    default:
      return { ...card("other", "other", "도구", `${who} 이 도구를 쓰도록 허용할까요?`), why: title ?? toolName, subject: title ?? toolName };
  }
}

/** 주소의 호스트 — 읽을 수 없는 주소면 null이다. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** 도구가 다루는 파일 — ACP `locations[].path`, 없으면 입력의 경로 칸(Claude `file_path`) · diff 내용의 경로. */
function pathOf(call: Json, rawInput: Json): string | null {
  const paths = [...locationsOf(call), nonEmpty(rawInput.file_path), nonEmpty(rawInput.path), ...diffPathsOf(call)];
  return paths.find((one) => one !== null) ?? null;
}

/** 선택지 하나 — 승인 카드의 단추 하나, 또는 엔진의 선택지 그대로인 번호 줄 하나. */
export interface CardChoice {
  /** 고를 선택지(`optionId`). */
  option: string;
  label: string;
  /** 허락 문구 — 판정이 낸 허락을 점 파일에 적고 답한다. */
  remember: boolean;
  /** 고르면 카드 안에 입력칸이 열린다(Claude의 「거부」 · 「다시 짜기」) — 보내야 답이 간다. */
  opensField: boolean;
  /** 그 단추를 누르는 글쇠 — 「한 번만 허용」 · 「구현」은 ↵, 「거부」 · 「다시 짜기」는 esc다. 그 밖과 번호 줄은 null이다. */
  key: "enter" | "escape" | null;
  /** 글쇠를 단추 끝에 옅게 적나 — 「다시 짜기」만 적지 않는다(보드 「계획 승인」에 없다). 글쇠가 없으면 뜻이 없다. */
  keycap: boolean;
  /**
   * 단추 모양(Cards 보드) — `opt`는 왼쪽의 옅은 테두리 알약(`.ra-opt` 28), `no`는 오른쪽의 테두리 알약(`.ra-no` 32), `yes`는 맨 오른쪽의 검은
   * 알약(`.ra-yes` 32)이다.
   */
  tone: "opt" | "no" | "yes";
  /** 긴 글이 단추 안에서 접힌다(`.ra-opt.long`) — Codex가 보낸 이름이다. 그 줄은 접히지 않고 거부 · 허용이 오른쪽 한 줄에 남는다. */
  long: boolean;
}

/**
 * 카드의 선택지들과 그 모양 — **단추 줄**(승인 · 계획, Cards 보드 `.acts`)은 배열 차례가 곧 왼쪽에서 오른쪽이고 ↵ · esc만 받는다(S25 — 단추 줄이
 * 오른쪽으로 무거워 숫자 차례와 눈 차례가 엇갈린다). **번호 줄**(허락 · 거부 갈래를 고를 수 없는 요청 — 엔진의 선택지 그대로)은 차례가 곧 번호이고
 * 숫자 · Enter · Esc · ↑↓로 고른다(`cardKey`).
 */
export interface CardChoices {
  layout: "buttons" | "rows";
  choices: CardChoice[];
}

/**
 * 선택지들. `scope`는 허락을 둘 자리(이은 Work, 없으면 이 Thread), `runtime`은 그 채팅의 Runtime 값(`ThreadView.runtime`)이다 — Codex는 보낸 선택지를
 * 그대로 그린다(`codexChoices`).
 * - **승인**(Cards 보드 「명령」 · 「파일 편집」) — 왼쪽 허락 문구(「비슷한 명령 허용」 · 「이 작업공간의 모든 편집 허용」), 오른쪽 「거부」(esc — 카드 안에
 *   다르게 할 방법을 쓰는 칸을 연다) · 「한 번만 허용」(↵).
 * - **계획 넘어가기**(Cards 보드 「계획 승인」 · 스토리 65) — 「다시 짜기」(esc — 고칠 점 입력칸을 연다. 보드처럼 글쇠는 그리지 않는다) · 「구현」(↵).
 */
export function cardChoices(request: PendingPermission, scope: "work" | "thread", runtime: string): CardChoices {
  const pick = (option: PermissionOption, label: string, more: Partial<CardChoice> = {}): CardChoice => ({
    option: option.optionId,
    label,
    remember: false,
    opensField: false,
    key: null,
    keycap: true,
    tone: "opt",
    long: false,
    ...more,
  });
  const named = (options: readonly PermissionOption[]): CardChoices => ({
    layout: "rows",
    choices: options.map((option) => pick(option, option.name)),
  });
  const of = (...kinds: string[]) =>
    kinds.map((kind) => request.options.find((option) => option.kind === kind)).find((option) => option !== undefined);
  if (request.planReview) {
    const go = request.options.find((option) => option.kind.startsWith("allow"));
    const revise = request.options.find((option) => option.kind.startsWith("reject"));
    if (!go || !revise) return named(request.options);
    return {
      layout: "buttons",
      choices: [
        ...request.options.filter((option) => option !== go && option !== revise).map((option) => pick(option, option.name)),
        // 한때 번호 줄의 Esc(마지막 줄)가 고칠 점 칸을 열었다 — 그 키는 그대로이고 글쇠만 그리지 않는다.
        pick(revise, "다시 짜기", { opensField: true, key: "escape", keycap: false, tone: "no" }),
        pick(go, "구현", { key: "enter", tone: "yes" }),
      ],
    };
  }
  if (runtime === CODEX) return codexChoices(request.options, pick, named);
  const allow = of("allow_once", "allow_always");
  const reject = of("reject_once", "reject_always");
  if (!allow || !reject) return named(request.options);
  const always = grantLabel(scope === "work", request.grant.includes("edit"));
  return {
    layout: "buttons",
    choices: [
      ...(request.grant.length > 0 ? [pick(allow, always, { remember: true })] : []),
      pick(reject, "거부", { opensField: true, key: "escape", tone: "no" }),
      pick(allow, "한 번만 허용", { key: "enter", tone: "yes" }),
    ],
  };
}

/** Codex 채팅의 Runtime 값. */
const CODEX: Runtime = "codex";

/**
 * Codex의 선택지(스펙 「01c — Codex」 권한 판정 · Cards 보드 「네트워크 · 샌드박스 밖」) — Codex가 보낸 것을 그대로 그린다. `allow_once`는 맨 오른쪽
 * 「한 번만 허용」(↵), `reject_once`는 「거부」(esc), 그 밖(`allow_always` …)은 왼쪽 단추로 Codex가 보낸 `name` 그대로 보낸 차례다 — 긴 이름은 단추
 * 안에서 접힌다(`long`). Claude의 허락 문구는 없다 — Codex 채팅은 「다시 묻지 않기」를 읽지 않고, 다시 묻지 않게 하는 것은 Codex의 `allow_always`다.
 * 거부는 입력칸을 열지 않는다 — codex-acp가 답의 `_meta.atelier`를 읽지 않아 남긴 말이 Codex에 닿지 않는다. 한 번만 허용이나 거부가 없으면 번호 줄로
 * 이름 그대로다.
 */
function codexChoices(
  options: readonly PermissionOption[],
  pick: (option: PermissionOption, label: string, more?: Partial<CardChoice>) => CardChoice,
  named: (options: readonly PermissionOption[]) => CardChoices,
): CardChoices {
  const once = options.find((option) => option.kind === "allow_once");
  const reject = options.find((option) => option.kind === "reject_once");
  if (!once || !reject) return named(options);
  return {
    layout: "buttons",
    choices: [
      ...options.filter((option) => option !== once && option !== reject).map((option) => pick(option, option.name, { long: true })),
      pick(reject, "거부", { key: "escape", tone: "no" }),
      pick(once, "한 번만 허용", { key: "enter", tone: "yes" }),
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
 * 결정 줄의 글(Tools · Thread 보드 「승인 결정 줄」 · restart 02b-5) — 누른 단추의 글에 「함」을 붙인다: 「한 번만 허용함」 · 「비슷한 명령 허용함」 ·
 * 「이 작업공간의 모든 편집 허용함」 · 「거부함」. 무엇을 허용했는지는 바로 아래 도구 줄이 말한다(결정 줄은 그 도구 줄 위다 — `fold.ts`). Codex가 보낸
 * 왼쪽 단추(`allow_always`)는 카드에 선 이름 그대로다. 계획은 「계획대로 진행함」 · 「계획을 다시 짜기로 함」이다. 남긴 말은 그리는 쪽이 글 뒤에 따로 든다.
 */
export function decisionText(entry: DecisionEntry): string {
  if (entry.planReview) return entry.allowed ? "계획대로 진행함" : "계획을 다시 짜기로 함";
  if (!entry.allowed) return "거부함";
  if (entry.granted) return `${grantLabel(Boolean(entry.granted.work), entry.granted.rules.includes("edit"))}함`;
  if (entry.chosen?.kind === "allow_always") return entry.chosen.name;
  return "한 번만 허용함";
}

/**
 * **허락의 말은 여기 하나다** — 승인 카드의 단추(`cardChoices`), 결정 줄의 꼬리(`decisionText`), 방패 줄의 까닭(`autoAllowReason`)이 같은 허락을
 * 같은 말로 부른다(02 §10 · 02 코드 리뷰 A1 — 한때 둘이 따로 지었고, 방패 줄은 엔진의 이름 「다시 묻지 않기」였다). 명령은 「비슷한 명령 허용」이고,
 * 편집은 허락을 둔 자리(이은 Work, 없으면 그 Thread — S18)를 말한다: 「이 작업공간의 모든 편집 허용」 · 「이 채팅의 모든 편집 허용」.
 */
function grantLabel(inWork: boolean, edits: boolean): string {
  if (!edits) return "비슷한 명령 허용";
  return inWork ? "이 작업공간의 모든 편집 허용" : "이 채팅의 모든 편집 허용";
}

/**
 * 엔진이 허락으로 넘긴 요청에 적는 까닭(판정 줄의 `reason` — `crates/atelier-acp/src/policy.rs`)과 그 허락을 둔 자리가 이은 Work인가. 엔진의 까닭은
 * 허락이 편집인지 말하지 않아 넘어간 도구의 종류로 가른다.
 */
const ENGINE_GRANT_REASONS: Readonly<Record<string, { inWork: boolean }>> = {
  "이 Work에서는 다시 묻지 않기": { inWork: true },
  "이 Thread에서는 다시 묻지 않기": { inWork: false },
};

/** 편집 허락(`edit`)이 넘기는 도구의 종류 — 판정의 `Act::Edit`과 같다. */
const EDIT_KINDS: ReadonlySet<string> = new Set(["edit", "delete", "move"]);

/**
 * 방패 줄의 까닭(v1 티켓 23 · `WorkLog`의 `AutoLine`) — 판정이 묻지 않고 허용한 까닭을 화면의 말로. 허락으로 넘어갔으면 카드의 말이고
 * (`ENGINE_GRANT_REASONS`), 물어보는 정도(「편집 자동」) · 앱 기능 도구(「앱 기능 도구」)의 까닭은 엔진이 적은 그대로다. `call`은 넘어간 도구 줄이다.
 */
export function autoAllowReason(reason: string, call: Json): string {
  const grant = ENGINE_GRANT_REASONS[reason];
  return grant ? grantLabel(grant.inWork, EDIT_KINDS.has(toolFields(call).kind)) : reason;
}
