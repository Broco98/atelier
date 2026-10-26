import type {
  Entry,
  PendingProject,
  PendingProjectAdd,
  PendingSpace,
  PendingWork,
  ProjectAddChoiceEntry,
  ProjectChoiceEntry,
  SpaceChoiceEntry,
  SpaceOption,
  WorkChoiceEntry,
  WorkProjectChoice,
} from "./fold";
import { isObject, nonEmpty, text, type Json } from "./json";
import type { ProjectAddAnswer } from "./types";

// Thread 도구 카드의 표(03 코드 리뷰 D2) — Thread 도구가 「카드를 세우고 기다리는 길」로 사람에게 묻는 카드(Work 만들기 · Work 밖 Project · Space 질문 ·
// Project 추가)는 갈래마다 **한 줄**이다: 카드를 세우는 도구 이름, 답한 뒤 그 도구 줄 자리에 서는 결정 줄의 갈래, 카드 줄 · 답 줄을 읽는 법, 흐름 ·
// 사이드바 · 다음 줄이 그 카드를 말하는 글. 접기(`fold.ts`) · 흐름(`ThreadFlow`) · 상태(`status.ts`) · 차례(`asks.ts`)는 갈래를 가르지 않고 이 표를
// 읽는다. 그리는 쪽의 한 줄(입력창 자리의 카드 · 흐름의 결정 줄)은 `ToolCards.tsx`의 표다.
//
// **카드 하나를 더하려면** — 아래 `ToolCardShapes`에 꼴 한 줄, `TOOL_CARDS`에 한 줄, `ToolCards.tsx`의 표에 한 줄이다. 카드 · 결정 줄의 꼴
// (`Pending…` · `…ChoiceEntry`)은 `fold.ts`에 둔다(물음 차례 · 흐름이 함께 읽는 화면 모델이다).

/** 갈래마다 카드(`question` `asked`로 선 물음)와 결정 줄(답한 뒤 그 도구 줄 자리)의 꼴. */
export interface ToolCardShapes {
  work: { ask: PendingWork; choice: WorkChoiceEntry };
  project: { ask: PendingProject; choice: ProjectChoiceEntry };
  space: { ask: PendingSpace; choice: SpaceChoiceEntry };
  "project-add": { ask: PendingProjectAdd; choice: ProjectAddChoiceEntry };
}

/** Thread 도구가 세우는 카드의 갈래(`question` 줄의 `card`). */
export type ToolCard = keyof ToolCardShapes;
/** 답하지 않은 Thread 도구 카드 하나. */
export type ToolCardAsk = ToolCardShapes[ToolCard]["ask"];
/** Thread 도구 카드에서 사람이 고른 것 — 그 카드를 낸 도구 줄 자리를 대신한다. */
export type ToolChoiceEntry = ToolCardShapes[ToolCard]["choice"];

/** 결정 줄이 접기에서 받는 자리 — 열쇠와, 그 카드를 낸 도구 줄 id(아직 짝을 찾지 못했으면 null). */
interface ChoiceAt {
  key: string;
  toolCallId: string | null;
}

/** 표의 한 줄. */
interface ToolCardRow<C extends ToolCard> {
  /** 카드를 세우는 Thread 도구 — Claude Code의 MCP 도구 이름이다. 답한 뒤 이 도구 줄은 결정 줄이 대신한다. */
  tool: string;
  /** 결정 줄의 `kind`. */
  choice: ToolCardShapes[C]["choice"]["kind"];
  /** 카드 줄(`question` `asked`) → 카드. 꼴이 틀린 칸은 버리거나 빈 값으로 둔다. */
  ask: (requestId: string, who: string, payload: Json) => ToolCardShapes[C]["ask"];
  /** 답 줄(`question` `answered`) → 결정 줄. 물은 카드(`asked`)의 칸을 다시 싣는 갈래도 있다(Project 추가 — 접힌 줄이 물음을 다시 짓는다). */
  answer: (asked: ToolCardShapes[C]["ask"], payload: Json, at: ChoiceAt) => ToolCardShapes[C]["choice"];
  /** 도는 턴 머리줄 끝의 기다림(`ThreadFlow`) — 「Space 답을 기다려요」. */
  waiting: string;
  /** 사이드바 「내 차례」 미리보기(`status.ts`) — 「질문 · 어느 Space에서 할까요?」. */
  status: (card: ToolCardShapes[C]["ask"]) => string;
  /** 카드 아래 「다음 · Host가 … 답을 기다려요」의 대상(`asks.ts`). */
  next: (card: ToolCardShapes[C]["ask"]) => string;
}

/** 답 줄이 실을 수 있는 Project 추가 카드의 답. */
const PROJECT_ADD_CHOICES: readonly ProjectAddAnswer[] = ["init", "root", "as-is", "decline"];

/** 카드 갈래마다 한 줄 — 차례는 카드가 더해진 차례다(v1 티켓 30 · 32 · 03 티켓 08 · 12). */
const TOOL_CARDS: { readonly [C in ToolCard]: ToolCardRow<C> } = {
  // Work 만들기 제안(v1 티켓 30) — 「✓ Work 만들기 · api-server · fix/refund-api」 · 「→ Work 없이 계속함」.
  work: {
    tool: "mcp__atelier-thread__propose_work",
    choice: "work-choice",
    ask: proposalOf,
    answer: (_asked, payload, at) => {
      const created = payload.choice === "create";
      return {
        kind: "work-choice",
        key: at.key,
        created,
        projects: created && Array.isArray(payload.projects) ? payload.projects.filter((one): one is string => typeof one === "string") : [],
        branch: created ? text(payload.branch) : null,
        toolCallId: at.toolCallId,
      };
    },
    waiting: "Work 만들기 답을 기다려요",
    status: (card) => `Work 만들기 · ${card.title}`,
    next: () => "Work 만들기",
  },
  // Project 고치기 시작(v1 티켓 32 — Work에 없는 Project면 묻는다) — 「web-app을 이 Work에 붙임」 · 「… 읽기만 하기로 함」 · 「… 고치지 않기로 함」.
  project: {
    tool: "mcp__atelier-thread__start_editing",
    choice: "project-choice",
    ask: outsideOf,
    answer: (_asked, payload, at) => ({
      kind: "project-choice",
      key: at.key,
      choice: payload.choice === "attach" || payload.choice === "read" ? payload.choice : "decline",
      project: text(payload.project) ?? "",
      toolCallId: at.toolCallId,
    }),
    waiting: "Work 밖 Project 답을 기다려요",
    status: (card) => `Work 밖 Project · ${card.name}`,
    next: (card) => `${card.name} 고치기`,
  },
  // Space 붙이기(03 티켓 08 — 「알아서」가 아니면 묻는다) — 「✓ 어느 Space에서 할까요? · 결제 서비스」.
  space: {
    tool: "mcp__atelier-thread__set_space",
    choice: "space-choice",
    ask: spaceAskOf,
    answer: (_asked, payload, at) => ({
      kind: "space-choice",
      key: at.key,
      choice: payload.choice === "space" || payload.choice === "none" ? payload.choice : "later",
      name: payload.choice === "space" ? (nonEmpty(payload.name) ?? nonEmpty(payload.space)) : null,
      toolCallId: at.toolCallId,
    }),
    waiting: "Space 답을 기다려요",
    status: () => "질문 · 어느 Space에서 할까요?",
    next: () => "Space",
  },
  // Project 추가(03 티켓 12 — git이 아닌 폴더 · 하위 폴더면 묻는다) — 「✓ notes는 git 저장소가 아니에요. 어떻게 할까요? · git init 하고 추가」.
  "project-add": {
    tool: "mcp__atelier-thread__add_project",
    choice: "project-add-choice",
    ask: projectAddOf,
    answer: (asked, payload, at) => ({
      kind: "project-add-choice",
      key: at.key,
      choice: PROJECT_ADD_CHOICES.find((one) => one === payload.choice) ?? "decline",
      look: asked.look,
      folder: asked.folder,
      root: asked.root,
      toolCallId: at.toolCallId,
    }),
    waiting: "Project 추가 답을 기다려요",
    status: (card) => `질문 · ${card.folder} 추가`,
    next: (card) => `${card.folder} 추가`,
  },
};

/** `question` 줄의 `card`가 Thread 도구 카드의 갈래인가. */
export function isToolCard(value: unknown): value is ToolCard {
  return typeof value === "string" && Object.keys(TOOL_CARDS).includes(value);
}

const KINDS: readonly ToolCard[] = Object.keys(TOOL_CARDS).filter(isToolCard);

/**
 * 그 갈래의 표 줄. 갈래(`card`)와 그 갈래의 카드 · 결정 줄을 함께 넘기는 자리에서 쓴다 — `toolCardRow(ask.card).status(ask)`.
 */
export function toolCardRow<C extends ToolCard>(card: C): ToolCardRow<C> {
  return TOOL_CARDS[card];
}

/** 물음 차례의 물음이 Thread 도구 카드인가 — 아니면 권한 요청이나 Agent의 질문이다. */
export function isToolCardAsk(ask: { card: unknown }): ask is ToolCardAsk {
  return isToolCard(ask.card);
}

/** 그 Thread 도구(Claude Code의 MCP 도구 이름)가 세우는 카드의 갈래 — 카드를 세우는 도구가 아니면 null이다. */
export function cardOfToolName(name: string | null): ToolCard | null {
  return KINDS.find((card) => TOOL_CARDS[card].tool === name) ?? null;
}

/** 카드의 결정 줄이면 그 카드의 갈래. */
export function cardOfChoice(entry: Pick<Entry, "kind">): ToolCard | null {
  return KINDS.find((card) => TOOL_CARDS[card].choice === entry.kind) ?? null;
}

/** Thread 도구 카드의 결정 줄인가 — 접힌 턴에도 남고, 턴 끝 답 사이에서는 그 자리에 함께 선다. */
export function isToolChoice(entry: Entry): entry is ToolChoiceEntry {
  return cardOfChoice(entry) !== null;
}

/** Project 추가 카드 줄(`question` `asked`, `card: project-add`) → 카드. 하위 폴더가 아니면 git이 아닌 폴더다. */
function projectAddOf(requestId: string, who: string, payload: Json): PendingProjectAdd {
  const path = text(payload.path) ?? "";
  return {
    card: "project-add",
    requestId,
    who,
    look: payload.look === "subfolder" ? "subfolder" : "notGit",
    path,
    folder: nonEmpty(payload.folder) ?? path,
    root: nonEmpty(payload.root),
  };
}

/**
 * Space 질문 카드 줄(`question` `asked`, `card: space`) → 카드. 꼴이 틀린 후보 줄은 버린다. 줄이 함께 싣는 지금 Space(`current`)와 Host가 든
 * 까닭(`reason`)은 카드가 그리지 않아(§11 — 물음 아래 줄은 정해진 글이다) 읽지 않는다.
 */
function spaceAskOf(requestId: string, who: string, payload: Json): PendingSpace {
  const spaces = (Array.isArray(payload.spaces) ? payload.spaces : []).filter(isObject).flatMap((row): SpaceOption[] => {
    const slug = text(row.slug);
    if (slug === null) return [];
    const projects = Array.isArray(row.projects) ? row.projects.filter((one): one is string => typeof one === "string") : [];
    return [{ slug, name: nonEmpty(row.name) ?? slug, projects }];
  });
  return {
    card: "space",
    requestId,
    who,
    recommended: nonEmpty(payload.recommended),
    spaces,
    registered: typeof payload.registered === "number" ? payload.registered : 0,
  };
}

/** Work 밖 Project 카드 줄(`question` `asked`, `card: project`) → 카드. */
function outsideOf(requestId: string, who: string, payload: Json): PendingProject {
  const project = text(payload.project) ?? "";
  return {
    card: "project",
    requestId,
    who,
    project,
    name: nonEmpty(payload.name) ?? project,
    reason: nonEmpty(payload.reason),
    work: text(payload.work) ?? "",
    workProjects: Array.isArray(payload.workProjects) ? payload.workProjects.filter((one): one is string => typeof one === "string") : [],
  };
}

/** 제안 줄(`question` `asked`, `card: work`) → 카드. 꼴이 틀린 Project 줄은 버린다. */
function proposalOf(requestId: string, who: string, payload: Json): PendingWork {
  const projects = (Array.isArray(payload.projects) ? payload.projects : []).filter(isObject).flatMap((row): WorkProjectChoice[] => {
    const slug = text(row.slug);
    if (slug === null) return [];
    const branches = Array.isArray(row.branches) ? row.branches.filter((one): one is string => typeof one === "string") : [];
    return [
      {
        slug,
        name: nonEmpty(row.name) ?? slug,
        description: nonEmpty(row.description),
        recommended: row.recommended === true,
        reason: nonEmpty(row.reason),
        branches,
      },
    ];
  });
  return {
    card: "work",
    requestId,
    who,
    title: text(payload.title) ?? "",
    slug: text(payload.slug) ?? "",
    reason: text(payload.reason) ?? "",
    branch: nonEmpty(payload.branch),
    projects,
    space: spaceOf(payload.space),
  };
}

/** 카드가 싣는 Space(`{slug, name}`) — 꼴이 틀리면 없는 것이다. */
function spaceOf(value: unknown): PendingWork["space"] {
  if (!isObject(value)) return null;
  const slug = nonEmpty(value.slug);
  return slug ? { slug, name: nonEmpty(value.name) ?? slug } : null;
}
