import { spoken, type ToolEntry } from "./fold";
import { folderName } from "@/features/projects/project-add";
import { isObject, nonEmpty, type Json } from "./json";
import { toolFields } from "./tool-fields";

// 도구 줄의 화면 값(v1 티켓 05 · restart 02b-4 · Tools 보드 「도구 줄 — 종류 × 상태」) — 접은 도구 호출(`ToolEntry`)을 문구 · 안의 것(명령 출력 ·
// diff · MCP 보낸 값과 받은 값)으로 옮기는 **순수 함수**다. 그리는 것은 `WorkLog.tsx`다.
//
// three-axes 도구 줄(`chat/tool-view.ts`)을 옮겨 왔다 — ACP 모양으로 가르는 규칙(MCP를 kind보다 먼저 · 서브에이전트 · 스킬 · 제목이 빈
// 줄)은 그대로다. 말은 Tools 보드의 칸 글이다:
// - **도는 줄은 「대상 동사」 한 글이다** — 「watcher.rs 읽는 중」 · 「pnpm test 실행 중」 · 「웹 검색 중」이 통째로 반짝인다. MCP는 서버와 도구 이름을
//   문장으로 쓴다(「Atelier list projects」).
// - **선 줄은 「동사 대상」이다** — 동사(「읽음」 · 「편집함」 · 「실행 완료」 · 「사용함」)가 앞에 서고 대상(파일 이름 · 무늬 · 명령 · 도구 이름)이 고정폭으로
//   뒤에 선다(`target`). 한때 「watcher.rs 읽음」처럼 대상이 앞이었다.
// - **줄 앞에 종류 글리프가 선다**(02 구현 스펙 §8 · 스토리 50 — Codex 결). 갈래는 아홉이다(`ToolGlyph`): 읽기 · 편집 · 명령 · 검색 · 웹 · MCP ·
//   스킬 · 서브에이전트 · 그 밖. 사람이 본 일로 가른다 — Atelier의 Thread 도구는 사람의 말로 서니(「작업공간 읽음」 · 「api-server 고치기 시작함」) MCP
//   글리프가 아니라 그 말의 갈래다. 그 밖의 MCP 도구만 MCP다. 그림은 `WorkLog.tsx`가 고른다.
// - **실패 · 멈춤 · 거부는 색이 아니라 문장이다** — 실패는 「읽지 못함 watcher.rs」 · 「코드 종료 1 pnpm test」(동사만 진하게), 멈추거나 끊긴 줄은
//   종류를 가리지 않고 ■ 「중지됨 watcher.rs」, 거부한 줄은 ■ 「편집하지 않음 watcher.rs」다(`stopped`). 한때 「실행하지 못함 · 코드 종료 1」 ·
//   「중단함 · 12초」 · 「실행하지 않음 · 내가 거절함」이었다.
// - **승인을 기다리는 줄은 「승인을 기다립니다 watcher.rs」다**(Thread 보드 「승인 대기」) — 반짝이지 않고 글리프가 옅지 않다.
// - **파일 변경**(Tools 보드 「파일 변경」) — 고친 파일 「편집함」, 옛 글 없이 쓴 파일 「생성됨」과 새 파일 점, 지운 파일 「삭제됨」과 지운 파일 점(`dot`).
// - **spec 문서 줄**(Thread 보드 · States 08 · restart 02b-6) — 이은 작업공간의 spec 폴더(`specRoot`)에 옛 글 없이 쓴 문서는 문서 글리프 · 「생성됨
//   재시도-규칙.md」 · 새 파일 점이고, 쓰는 동안은 「재시도-규칙.md 쓰는 중」이다(`doc`). 셈과 펼침이 없다 — 그 문서는 답 아래 문서 카드가 연다.
// - **명령 출력의 끝 줄은 「성공」 · 「코드 종료 N」 · 「중지됨」이다**(Tools 보드 「명령 출력」). Claude Code는 종료 코드를 주지 않아 실패는 「실패」다.
//   한때 「코드 종료 0 · 4.2초」였다 — 걸린 시간은 줄에 마우스를 올리면 선다.
// - **Work와 이어지는 Thread 도구 셋도 사람의 말이다**(v1 티켓 30) — 「Project 3개 목록 확인함」 · 「작업공간 읽음」 · 「작업공간 만들기를 묻는 중」.
//   「Project 고치기 시작」(v1 티켓 32)은 「api-server 고치기 시작함」이다 — Work 밖 Project 카드가 서면 그동안 「web-app 고치기 시작하는
//   중」이고, 사람이 고르면 결정 줄이 이 줄의 자리를 대신한다. 사람의 말은 대상이 따로 서지 않고 한 문장이다(`human`).
// - **Service를 붙이는 Thread 도구 둘**(03 티켓 08) — 「Service 목록 확인함」 · 「Service 고름」(질문 카드가 선 동안은 「Service 고르는 중」).
// - **대화로 하는 설정 넷**(03 티켓 12) — 「landing-page 추가함」 · 「web-app 고침」 · 「정산 Service 만듦」 · 「결제-서비스 Service 고침」. 해낸 것은 그 턴 안
//   이 줄 뒤의 결과 카드가 말하고, 이 줄은 작업 로그에 남는다. Project 추가 카드가 서면 그동안 「notes 추가하는 중」이고, 고르면 접힌 줄이 이 줄의 자리를
//   대신한다.

/** 도구 줄 앞의 종류 글리프 — 읽기 · 편집(쓰기 · 지우기 · 옮기기) · spec 문서 · 명령 · 검색 · 웹(검색 · 가져오기) · MCP · 스킬 · 서브에이전트 · 그 밖. */
export type ToolGlyph = "read" | "edit" | "doc" | "execute" | "search" | "web" | "mcp" | "skill" | "agent" | "other";

/** 도구 줄의 때 — 도는 중 · 끝남 · 실패 · 끊김(끝을 받기 전에 그 Session이 사라졌다). */
export type ToolState = "running" | "done" | "failed" | "cut";

/**
 * 도구 줄의 문구. 도는 줄은 「watcher.rs 읽는 중」 한 글(`verb`)이 통째로 반짝이고 `target`이 없다. 선 줄은 동사(`verb` — 「읽음」 · 「중지됨」)와 그 뒤의
 * 대상(`target` — 고정폭)이다. 사람의 말로 서는 줄(Thread 도구 · 서브에이전트)은 늘 한 문장이다(「Project 3개 목록 확인함」).
 */
export interface ToolPhrase {
  /** 무엇을 다루나 — 파일 이름 · 무늬 · 명령 · MCP 도구, 또는 사람의 말(Thread 도구의 대상 · Agent 이름). 없으면 null. 승인 카드 · 사이드바가 쓴다. */
  subject: string | null;
  /** `subject`가 고정폭(파일 · 무늬 · 명령 · 도구 이름)인가 — 사람의 말이면 false다. */
  mono: boolean;
  /** 줄의 첫 글 — 도는 줄은 문장 전체, 선 줄은 동사, 사람의 말은 문장 전체다. */
  verb: string;
  /** 동사 뒤에 고정폭으로 서는 대상 — 도는 줄 · 사람의 말 · 대상이 없는 줄은 null이다. */
  target: string | null;
  /** 실패한 줄 — 색은 다른 줄과 같고 동사(「읽지 못함」 · 「코드 종료 1」)가 말한다(Tools 보드 「실패는 색으로 알리지 않고 문구로 알린다」). */
  failed: boolean;
}

/** diff 한 줄 — 더함 · 지움 · 둘레(바뀌지 않은 줄), 그리고 둘레를 줄여 건너뛴 자리. */
export type DiffLine = { type: "add" | "del" | "ctx"; text: string } | { type: "gap"; count: number };

/** 편집 도구의 diff 내용 하나(ACP `{type: "diff", path, oldText, newText}`) — 줄 단위로 견준 값. */
export interface DiffPiece {
  path: string;
  /** 옛 글을 모른다 — 새로 쓴 파일이거나 옛 글을 싣지 않은 편집이다(Claude Write). */
  written: boolean;
  lines: DiffLine[];
  added: number;
  deleted: number;
}

export interface ToolView {
  state: ToolState;
  /** 물은 권한이 답을 기다리나 — 문구가 「승인을 기다립니다」이고 반짝이지 않는다(v1 티켓 24 · Thread 보드 「승인 대기」). */
  waiting: boolean;
  /**
   * 줄 앞이 글리프 대신 ■인가(Tools 보드 「멈춤」) — 우리가 멈춘 턴에서 끝을 받지 못했거나 멈춤과 함께 닫힌 줄, 끊긴 줄, 사람이 거부한 줄이다. 반짝이지
   * 않는다.
   */
  stopped: boolean;
  /** 묶음 줄에 드는 갈래 — 읽기 · 찾기만 이어지면 묶인다(`log.ts`). */
  group: "read" | "search" | null;
  /** 줄 앞의 종류 글리프(머리말). */
  glyph: ToolGlyph;
  phrase: ToolPhrase;
  /** 파일 변경 줄 끝의 점 — 새 파일 · 지운 파일. 아니면 null(Tools 보드 「파일 변경」). */
  dot: "created" | "deleted" | null;
  /**
   * spec 문서 줄인가(Thread 보드 「생성됨 재시도-규칙.md」) — 이은 작업공간의 spec 폴더에 새로 쓴 문서다. 줄에 `+N −N`이 서지 않고 펼칠 것이 없다(`diffs`는
   * 그대로 — 바뀐 파일 셈 · 문서 카드가 쓴다).
   */
  doc: boolean;
  /** 명령 출력 상자 — 명령이 아니면 null. `status`는 끝 줄(「성공」 · 「코드 종료 101」 · 「중지됨」)이고 도는 동안은 null이다. */
  shell: { command: string | null; output: string; status: string | null; bad: boolean } | null;
  /** 편집 도구의 diff들. */
  diffs: DiffPiece[];
  /**
   * MCP 호출 — 이름(`서버.도구`) · 보낸 값 · 받은 값. 받은 값이 JSON이면 고정폭으로 선다(`receivedCode`) — 글이면 본문 글꼴이다(보드
   * 「MCP 호출」). MCP가 아니면 null.
   */
  mcp: { name: string; sent: string; received: string; receivedCode: boolean } | null;
  /** 그 밖의 글 출력 — 실패한 도구의 오류 글 · 서브에이전트가 돌려준 글. 펼쳐야 보인다. */
  text: string | null;
}

/**
 * 동사 넷 — 하는 중 · 끝남 · 실패 · 거부. 하는 중은 대상 뒤에 붙는 말이다(「읽는 중」 → 「watcher.rs 읽는 중」). 비었으면 대상만으로 문장이다(MCP — 「Atelier list
 * projects」).
 */
interface Verbs {
  running: string;
  done: string;
  failed: string;
  refused: string;
}
const EXECUTE: Verbs = { running: "실행 중", done: "실행 완료", failed: "실패함", refused: "실행하지 않음" };
const READ: Verbs = { running: "읽는 중", done: "읽음", failed: "읽지 못함", refused: "읽지 않음" };
const EDIT: Verbs = { running: "편집 중", done: "편집함", failed: "편집하지 못함", refused: "편집하지 않음" };
const CREATE: Verbs = { running: "만드는 중", done: "생성됨", failed: "만들지 못함", refused: "만들지 않음" };
const WRITE_DOC: Verbs = { running: "쓰는 중", done: "생성됨", failed: "쓰지 못함", refused: "쓰지 않음" };
const DELETE: Verbs = { running: "지우는 중", done: "삭제됨", failed: "지우지 못함", refused: "지우지 않음" };
const MOVE: Verbs = { running: "옮기는 중", done: "옮김", failed: "옮기지 못함", refused: "옮기지 않음" };
const SEARCH: Verbs = { running: "검색 중", done: "검색함", failed: "검색하지 못함", refused: "검색하지 않음" };
const WEB: Verbs = { running: "웹 검색 중", done: "웹 검색함", failed: "웹 검색하지 못함", refused: "웹 검색하지 않음" };
const FETCH: Verbs = { running: "가져오는 중", done: "가져옴", failed: "가져오지 못함", refused: "가져오지 않음" };
const MCP: Verbs = { running: "", done: "사용함", failed: "실패함", refused: "사용하지 않음" };
const SKILL: Verbs = { running: "읽는 중", done: "스킬 읽음", failed: "읽지 못함", refused: "읽지 않음" };
const SUBAGENT: Verbs = { running: "에게 맡기는 중", done: "에게 맡김", failed: "에게 맡기지 못함", refused: "에게 맡기지 않음" };
const THINK: Verbs = { running: "생각하는 중", done: "생각함", failed: "생각하지 못함", refused: "생각하지 않음" };
const MODE: Verbs = { running: "모드 바꾸는 중", done: "모드 바꿈", failed: "모드 바꾸지 못함", refused: "모드 바꾸지 않음" };
const OTHER: Verbs = { running: "실행 중", done: "실행 완료", failed: "실패함", refused: "실행하지 않음" };

/** 멈추거나 끊긴 줄의 동사 — 종류를 가리지 않는다(Tools 보드 「멈춤」 칸). */
const STOPPED = "중지됨";
/** 승인을 기다리는 줄의 동사(Thread 보드 「승인 대기」 · 머리줄과 같은 말). */
const WAITING = "승인을 기다립니다";

/** Work와 이어지는 Thread 도구 셋(v1 티켓 30)의 `서버.도구` 이름 — 사람의 말로 선다(캔버스 화면 2 「Project 3개 목록 확인함」). */
const LIST_PROJECTS = "atelier-thread.list_projects";
const GET_WORK = "atelier-thread.get_work";
const PROPOSE_WORK = "atelier-thread.propose_work";
/** 「Project 고치기 시작」 Thread 도구(v1 티켓 32)의 `서버.도구` 이름. */
const START_EDITING = "atelier-thread.start_editing";
/** Service를 붙이는 Thread 도구 둘(03 티켓 08)의 `서버.도구` 이름 — 「Service 목록 확인함」 · 「Service 고름」. */
const LIST_SERVICES = "atelier-thread.list_services";
const SET_SERVICE = "atelier-thread.set_service";
const PICK: Verbs = { running: "고르는 중", done: "고름", failed: "고르지 못함", refused: "고르지 않음" };
/** 대화로 하는 설정 넷(03 티켓 12)의 `서버.도구` 이름 — 「landing-page 추가함」 · 「web-app 고침」 · 「정산 Service 만듦」. */
const ADD_PROJECT = "atelier-thread.add_project";
const EDIT_PROJECT = "atelier-thread.edit_project";
const CREATE_SERVICE = "atelier-thread.create_service";
const EDIT_SERVICE = "atelier-thread.edit_service";
const ADD: Verbs = { running: "추가하는 중", done: "추가함", failed: "추가하지 못함", refused: "추가하지 않음" };
const FIX: Verbs = { running: "고치는 중", done: "고침", failed: "고치지 못함", refused: "고치지 않음" };
const MAKE: Verbs = { running: "만드는 중", done: "만듦", failed: "만들지 못함", refused: "만들지 않음" };
const START: Verbs = {
  running: "고치기 시작하는 중",
  done: "고치기 시작함",
  failed: "고치기 시작하지 못함",
  refused: "고치기 시작하지 않음",
};
const CHECK: Verbs = { running: "확인하는 중", done: "확인함", failed: "확인하지 못함", refused: "확인하지 않음" };
const ASK: Verbs = { running: "묻는 중", done: "물음", failed: "묻지 못함", refused: "묻지 않음" };

/** 사람의 말 한 문장 — 대상과 동사를 띄어 잇는다. `에게`로 시작하는 동사는 대상에 붙는다(「리뷰어에게 맡김」). 대상이 없으면 동사만이다. */
const sentence = (subject: string | null, verb: string): string =>
  subject === null ? verb : verb === "" ? subject : `${subject}${verb.startsWith("에게") ? "" : " "}${verb}`;

/**
 * 도구 줄의 화면 값. `specRoot`는 이은 작업공간의 spec 폴더(절대 경로)다 — 알면 그 안에 새로 쓴 문서가 문서 줄이다(`doc`). 작업 로그만 건네고, 바뀐 파일 셈 ·
 * 문서 카드 · 상태 줄처럼 diff · 문구만 보는 쪽은 건네지 않는다.
 */
export function describeTool(tool: ToolEntry, specRoot: string | null = null): ToolView {
  const call = tool.call;
  const state: ToolState =
    call.status === "completed" ? "done" : call.status === "failed" ? "failed" : tool.cut ? "cut" : "running";
  const { meta, toolName, mcp, subagent, rawInput, title, kind } = toolFields(call);
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  const contentText = content
    .map((item) => (item.type === "content" && isObject(item.content) && item.content.type === "text" ? item.content.text : null))
    .filter((one): one is string => typeof one === "string")
    .join("\n");
  const exitCode = exitOf(call, meta);
  // 멈춘 턴에서 끝을 받지 못했거나 멈춤과 함께 닫힌 줄, 끊긴 줄 — 종류를 가리지 않고 ■ 「중지됨」이다. 멈춘 뒤에 끝난 줄(`ran-on` · 끝)은 끝난 줄이다.
  const halted = tool.stop === "stopped" || state === "cut" || (tool.stop === "ran-on" && state === "running");
  const stopped = tool.denied || halted;
  // 줄의 문구 — 거부 · 기다림 · 멈춤 · 도는 중 · 끝 · 실패를 여기서 가른다(머리말). `human`이면 대상을 따로 세우지 않고 한 문장이다.
  // `runningSubject`는 도는 줄의 대상이다 — 웹 검색은 검색어가 오기 전이라 없다(「웹 검색 중」), MCP는 서버와 도구의 문장이다.
  const say = (
    verbs: Verbs,
    subject: string | null,
    { mono, human = false, runningSubject = subject, failedVerb = verbs.failed }: {
      mono: boolean;
      human?: boolean;
      runningSubject?: string | null;
      failedVerb?: string;
    },
  ): ToolPhrase => {
    const settled = (verb: string, failed = false): ToolPhrase =>
      human ? { subject, mono, verb: sentence(subject, verb), target: null, failed } : { subject, mono, verb, target: subject, failed };
    if (tool.denied) return settled(verbs.refused);
    if (tool.asking) return settled(WAITING);
    if (halted) return settled(STOPPED);
    if (state === "running") return { subject, mono, verb: sentence(human ? subject : runningSubject, verbs.running), target: null, failed: false };
    if (state === "done") return settled(verbs.done);
    return settled(failedVerb, true);
  };
  const base = {
    state,
    waiting: tool.asking && !stopped,
    stopped,
    group: null,
    dot: null,
    doc: false,
    diffs: [] as DiffPiece[],
    shell: null,
    mcp: null,
    text: null,
  };

  if (mcp) {
    const { input } = mcp;
    const name = `${mcp.server}.${mcp.tool}`;
    const sent = Object.keys(input).length > 0 ? pretty(input) : "";
    const received = mcpOutput(call, contentText);
    const box = { name, sent, received, receivedCode: /^[[{]/.test(received.trim()) };
    const human = { mono: false, human: true };
    if (name === LIST_PROJECTS) {
      const count = state === "done" ? listedCount(received) : null;
      return { ...base, glyph: "read", phrase: say(CHECK, count === null ? "Project 목록" : `Project ${count}개 목록`, human), mcp: box };
    }
    if (name === GET_WORK) return { ...base, glyph: "read", phrase: say(READ, "작업공간", human), mcp: box };
    // 카드가 선 동안 서는 줄이다 — 사람이 고르면 결정 줄이 이 줄의 자리를 대신한다(`fold.ts`). 거절된 제안만 이 줄로 남는다.
    if (name === PROPOSE_WORK) return { ...base, glyph: "other", phrase: say(ASK, "작업공간 만들기를", human), mcp: box };
    if (name === START_EDITING) {
      return { ...base, glyph: "edit", phrase: say(START, nonEmpty(input.project) ?? "Project", human), mcp: box };
    }
    if (name === LIST_SERVICES) return { ...base, glyph: "read", phrase: say(CHECK, "Service 목록", human), mcp: box };
    // 묻지 않고 붙이면 곧 「Service 고름」이고, 질문 카드가 서면 그동안 「Service 고르는 중」이다 — 사람이 고르면 접힌 줄이 이 줄의 자리를 대신한다.
    if (name === SET_SERVICE) return { ...base, glyph: "other", phrase: say(PICK, "Service", human), mcp: box };
    if (name === ADD_PROJECT) {
      const path = nonEmpty(input.path);
      const folder = path === null ? null : nonEmpty(folderName(path));
      return { ...base, glyph: "other", phrase: say(ADD, nonEmpty(input.name) ?? folder ?? "Project", human), mcp: box };
    }
    if (name === EDIT_PROJECT) return { ...base, glyph: "other", phrase: say(FIX, nonEmpty(input.project) ?? "Project", human), mcp: box };
    if (name === CREATE_SERVICE) return { ...base, glyph: "other", phrase: say(MAKE, serviceSubject(input.name), human), mcp: box };
    if (name === EDIT_SERVICE) return { ...base, glyph: "other", phrase: say(FIX, serviceSubject(input.service), human), mcp: box };
    // 그 밖의 MCP 도구 — 도는 동안은 서버와 도구 이름의 문장(Tools 보드 「MCP 호출 — 서버 · 도구 이름을 문장으로」), 선 줄은 「사용함 list_projects」다.
    return { ...base, glyph: "mcp", phrase: say(MCP, mcp.tool, { mono: true, runningSubject: mcpSentence(mcp.server, mcp.tool) }), mcp: box };
  }

  const fallbackText = state === "failed" && contentText !== "" ? contentText : null;
  if (subagent) {
    return {
      ...base,
      glyph: "agent",
      phrase: say(SUBAGENT, subagent.type ?? "서브에이전트", { mono: false, human: true }),
      text: contentText || null,
    };
  }
  if (toolName === "Skill" && nonEmpty(rawInput.skill)) {
    return { ...base, glyph: "skill", phrase: say(SKILL, nonEmpty(rawInput.skill), { mono: true }), text: fallbackText };
  }
  if (toolName === "WebSearch") {
    const query = nonEmpty(rawInput.query) ?? title;
    return { ...base, glyph: "web", phrase: say(WEB, query, { mono: true, runningSubject: null }), text: fallbackText };
  }

  const diffs = diffsOf(call);
  const output = tool.output !== "" ? tool.output : contentText;
  const terminal = content.some((item) => item.type === "terminal");
  if (kind === "execute" || terminal || tool.output !== "") {
    const command = title ?? commandOf(rawInput.command);
    const failedVerb = exitCode !== null && exitCode !== 0 ? `코드 종료 ${exitCode}` : EXECUTE.failed;
    return {
      ...base,
      glyph: "execute",
      phrase: say(EXECUTE, command ?? "명령", { mono: true, failedVerb }),
      shell: shellOf(state, halted, command, output, exitCode),
    };
  }

  const files = [...new Set([...locationsOf(call), ...diffs.map((piece) => piece.path)])];
  const onlyFile = files.length === 1 ? files[0] : null;
  const fileSubject = onlyFile ? baseName(onlyFile) : files.length > 1 ? `파일 ${files.length}개` : null;
  const fileSay = (verbs: Verbs) => say(verbs, fileSubject ?? title ?? "파일", { mono: fileSubject !== null });
  switch (kind) {
    case "read":
      return { ...base, group: "read", glyph: "read", phrase: fileSay(READ), text: fallbackText };
    case "edit":
    case "delete": {
      // 지운 파일 · 옛 글 없이 쓴 파일(Claude Write · Codex add)은 점을 단다(Tools 보드 「파일 변경」). Codex는 지우기도 diff의 `_meta.kind`로 알린다.
      const removed = kind === "delete" || (diffs.length > 0 && content.every((item) => item.type !== "diff" || diffKind(item) === "delete"));
      const written = !removed && diffs.length > 0 && diffs.every((piece) => piece.written);
      const doc = written && specRoot !== null && diffs.every((piece) => inside(piece.path, specRoot));
      const verbs = removed ? DELETE : doc ? WRITE_DOC : written ? CREATE : EDIT;
      return {
        ...base,
        glyph: doc ? "doc" : "edit",
        doc,
        phrase: fileSay(verbs),
        dot: removed ? "deleted" : written ? "created" : null,
        diffs,
        text: diffs.length > 0 ? null : fallbackText,
      };
    }
    case "move":
      return { ...base, glyph: "edit", phrase: fileSay(MOVE), text: fallbackText };
    case "search":
      // 변환기의 제목은 「Search <무늬>」 · 「Find <무늬>」다(`translator/stream.rs`) — 보드는 무늬만 든다(「검색함 watcher」).
      return {
        ...base,
        group: "search",
        glyph: "search",
        phrase: say(SEARCH, nonEmpty(rawInput.pattern) ?? title, { mono: true }),
        text: fallbackText,
      };
    case "fetch":
      return { ...base, glyph: "web", phrase: say(FETCH, nonEmpty(rawInput.url) ?? title, { mono: true }), text: fallbackText };
    case "think":
      return { ...base, glyph: "other", phrase: say(THINK, title, { mono: false, human: true }), text: fallbackText };
    case "switch_mode":
      return { ...base, glyph: "other", phrase: say(MODE, null, { mono: false, human: true }), text: fallbackText };
    default:
      return { ...base, glyph: "other", phrase: say(OTHER, title ?? toolName ?? "도구", { mono: true }), text: fallbackText };
  }
}

/** 그 경로가 폴더 안의 파일인가 — 폴더 자리 그 자체는 아니다. */
export function inside(path: string, folder: string): boolean {
  const root = `${folder.replace(/\/+$/, "")}/`;
  return path.startsWith(root) && path.length > root.length;
}

/**
 * 도구 줄이 걸린 시간 — 시작한 줄과 끝난 줄의 시각 사이다(마우스를 올린 줄의 오른쪽). 10초 아래는 소수 한 자리(「4.2초」), 그 위는 말로(「1분 12초」)다.
 * 끝나지 않았으면 null이다.
 */
export function elapsed(tool: ToolEntry): string | null {
  if (tool.endedAt === null) return null;
  const ms = Math.max(0, Date.parse(tool.endedAt) - Date.parse(tool.startedAt));
  if (Number.isNaN(ms)) return null;
  return ms < 10_000 ? `${(Math.round(ms / 100) / 10).toFixed(1)}초` : spoken(ms);
}

/** 문구 한 줄 — 도구 줄의 이름이고 보조 기술이 읽는 글이다. 도는 줄은 그 문장, 선 줄은 「동사 대상」이다. */
export function phraseText(phrase: ToolPhrase): string {
  return phrase.target === null ? phrase.verb : `${phrase.verb} ${phrase.target}`;
}

/** MCP 도구를 부르는 문장 — 서버 이름의 첫 글자를 크게, 이름 속 `_` · `-`를 띄어 쓴다(Tools 보드 「Atelier list projects」). */
function mcpSentence(server: string, toolName: string): string {
  const words = (name: string) => name.replace(/[_-]+/g, " ").trim();
  const head = words(server);
  return `${head.charAt(0).toUpperCase()}${head.slice(1)} ${words(toolName)}`;
}

/** diff 내용의 갈래 — codex-acp가 `_meta.kind`(`add` · `delete` · `update`)로 싣는다. Claude는 싣지 않는다. */
function diffKind(item: Json): string | null {
  return isObject(item._meta) && typeof item._meta.kind === "string" ? item._meta.kind : null;
}

/** 설정 도구가 다루는 Service — 「정산 Service」. 이름 · slug가 없으면 「Service」다. */
function serviceSubject(value: unknown): string {
  const name = nonEmpty(value);
  return name ? `${name} Service` : "Service";
}

/** 받은 값이 JSON 목록이면 그 수 — 「Project 3개 목록 확인함」. 목록이 아니면(등록된 Project가 없다는 글) null이다. */
function listedCount(received: string): number | null {
  try {
    const parsed: unknown = JSON.parse(received);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** MCP 호출의 받은 값 — 글 내용, 또는 `rawOutput`(MCP `CallToolResult`). JSON이면 들여 써서 보인다. */
function mcpOutput(call: Json, contentText: string): string {
  if (contentText !== "") return pretty(contentText);
  const raw = call.rawOutput;
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return pretty(raw);
  if (isObject(raw)) {
    const error = raw.error;
    if (error !== undefined && error !== null) return isObject(error) && typeof error.message === "string" ? error.message : pretty(error);
    const result = isObject(raw.result) ? raw.result : null;
    const blocks = result && Array.isArray(result.content) ? result.content.filter(isObject) : [];
    const texts = blocks.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : null));
    if (texts.length > 0 && texts.every((one) => one !== null)) return pretty(texts.join("\n"));
    if (result && result.structuredContent !== undefined) return pretty(result.structuredContent);
    if (result) return pretty(result);
  }
  return pretty(raw);
}

function pretty(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
}

/** 명령 글 — codex는 배열(`["/bin/zsh", "-lc", "echo atelier"]`)로도 준다. 비었으면 null. 승인 카드도 쓴다. */
export function commandOf(command: unknown): string | null {
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    const shell = command.length === 3 && /^-l?c$/.test(command[1]) ? command[2] : command.join(" ");
    return nonEmpty(shell);
  }
  return nonEmpty(command);
}

/** 종료 코드 — codex의 `_meta.terminal_exit` · `rawOutput.exit_code`. 모르면 null(Claude Code는 싣지 않는다). */
function exitOf(call: Json, meta: Json): number | null {
  const exit = isObject(meta.terminal_exit) ? meta.terminal_exit.exit_code : isObject(call.rawOutput) ? call.rawOutput.exit_code : null;
  return typeof exit === "number" ? exit : null;
}

/**
 * 명령 출력 상자의 값 — 끝 줄은 끝난 뒤에만 선다(Tools 보드 「명령 출력」): 「성공」 · 0이 아닌 종료 코드면 「코드 종료 N」 · 코드를 모르는 실패면 「실패」 ·
 * 멈추거나 끊겼으면 「중지됨」이다. 실패와 0이 아닌 종료 코드는 진하다(`bad`).
 */
function shellOf(
  state: ToolState,
  halted: boolean,
  command: string | null,
  output: string,
  code: number | null,
): NonNullable<ToolView["shell"]> {
  let status: string | null = null;
  if (halted) status = STOPPED;
  else if (code !== null && code !== 0 && state !== "running") status = `코드 종료 ${code}`;
  else if (state === "done") status = "성공";
  else if (state === "failed") status = "실패";
  const bad = !halted && (state === "failed" || (code !== null && code !== 0));
  return { command, output: output.replace(/\n+$/, ""), status, bad };
}

/** 도구가 다루는 파일들 — ACP `locations[].path`. 승인 카드도 쓴다. */
export function locationsOf(call: Json): string[] {
  const locations = Array.isArray(call.locations) ? call.locations.filter(isObject) : [];
  return locations.map((location) => location.path).filter((path): path is string => typeof path === "string" && path !== "");
}

/** 편집 도구의 diff 내용이 가리키는 파일들 — 내용 차례대로. 승인 카드가 쓴다. */
export function diffPathsOf(call: Json): string[] {
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  return content
    .filter((item) => item.type === "diff")
    .map((item) => nonEmpty(item.path))
    .filter((path): path is string => path !== null);
}

/** 편집 도구의 diff 내용들(ACP `{type: "diff", path, oldText, newText}`)을 줄 단위로 견준 값 — 변경 상자와 승인 카드의 파일 카드가 쓴다. */
export function diffsOf(call: Json): DiffPiece[] {
  const content = Array.isArray(call.content) ? call.content.filter(isObject) : [];
  return content.filter((item) => item.type === "diff" && typeof item.path === "string").map(diffPiece);
}

/** 경로의 마지막 이름 — 도구 줄에는 이름만, 전체 경로는 diff 머리에 선다. */
export const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * 변경 상자 머리의 경로(WorkLog 보드 「src/refunds/refund.service.ts」) — 그 Session의 작업 폴더 안이면 그 폴더에서 본 자리, 밖이면
 * 받은 그대로다. Work의 Thread에서는 worktree가 작업 폴더라 저장소에서 본 자리가 된다.
 */
export function shownPath(path: string, cwd: string | null): string {
  if (!cwd) return path;
  const root = `${cwd.replace(/\/+$/, "")}/`;
  return path.startsWith(root) && path.length > root.length ? path.slice(root.length) : path;
}

/** diff 둘레 — 바뀐 줄 앞뒤로 남기는 바뀌지 않은 줄 수. 그보다 먼 줄은 건너뛴 자리 하나로 접는다. */
const CONTEXT = 3;
/** 줄 단위로 견주는 가운데 토막의 한도(옛 줄 수 × 새 줄 수) — 넘으면 통째로 지우고 더한 것으로 보인다. */
const LCS_LIMIT = 250_000;

function diffPiece(item: Json): DiffPiece {
  const path = item.path as string;
  const written = typeof item.oldText !== "string";
  const before = splitLines(typeof item.oldText === "string" ? item.oldText : "");
  const after = splitLines(typeof item.newText === "string" ? item.newText : "");
  const full = lineDiff(before, after);
  return {
    path,
    written,
    lines: folded(full),
    added: full.filter((line) => line.type === "add").length,
    deleted: full.filter((line) => line.type === "del").length,
  };
}

export function splitLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export type Change = { type: "add" | "del" | "ctx"; text: string };

/** 줄 단위 diff — 같은 머리 · 꼬리를 떼고, 가운데를 가장 긴 공통 줄(LCS)로 견준다. 넓힌 카드의 문서가 다시 읽은 글에서 칠할 줄도
 * 이것으로 고른다(v1 티켓 35 · `expanded.ts`의 `freshLines`). */
export function lineDiff(before: readonly string[], after: readonly string[]): Change[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);
  const ctx = (line: string): Change => ({ type: "ctx", text: line });
  return [...before.slice(0, head).map(ctx), ...middle(oldMid, newMid), ...before.slice(before.length - tail).map(ctx)];
}

function middle(oldMid: readonly string[], newMid: readonly string[]): Change[] {
  const n = oldMid.length;
  const m = newMid.length;
  const del = (line: string): Change => ({ type: "del", text: line });
  const add = (line: string): Change => ({ type: "add", text: line });
  if (n === 0 || m === 0 || n * m > LCS_LIMIT) return [...oldMid.map(del), ...newMid.map(add)];
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        oldMid[i] === newMid[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldMid[i] === newMid[j]) {
      out.push({ type: "ctx", text: oldMid[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push(del(oldMid[i]));
      i += 1;
    } else {
      out.push(add(newMid[j]));
      j += 1;
    }
  }
  while (i < n) out.push(del(oldMid[i++]));
  while (j < m) out.push(add(newMid[j++]));
  return out;
}

function folded(changes: readonly Change[]): DiffLine[] {
  const near = changes.map(() => false);
  changes.forEach((change, at) => {
    if (change.type === "ctx") return;
    for (let k = Math.max(0, at - CONTEXT); k <= Math.min(changes.length - 1, at + CONTEXT); k += 1) near[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  changes.forEach((change, at) => {
    if (change.type === "ctx" && !near[at]) {
      skipped += 1;
      return;
    }
    if (skipped > 0) out.push({ type: "gap", count: skipped });
    skipped = 0;
    out.push(change);
  });
  if (skipped > 0) out.push({ type: "gap", count: skipped });
  return out;
}
