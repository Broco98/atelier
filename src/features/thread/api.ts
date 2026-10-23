import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { THREAD_ENGINE_EVENT, THREAD_LIST_EVENT, THREAD_QUEUE_EVENT, THREAD_RECORD_EVENT } from "./events";
import type {
  AgentRoster,
  AskLevel,
  Attachment,
  EngineCheck,
  EngineState,
  Participant,
  QuestionAnswer,
  QuitCounts,
  RecordLine,
  StartPicks,
  ThreadLink,
  ThreadQueueEvent,
  ThreadRecordEvent,
  ThreadSummary,
  ThreadView,
} from "./types";

// Thread 엔진을 부르는 명령(v1 티켓 04 · 05 · 구현 스펙 §18). 엔진은 앱 프로세스에 하나 살고, 다른 화면으로 가거나 새로고침해도 Session이
// 계속 돈다 — 그래서 Thread는 기록에서 다시 그린다: 먼저 기록 줄 이벤트를 받는 자리가 앱 층에 있고(`useThreadFeeds`), Thread를 열 때
// `get` → `readRecord(0)` 순서로 읽어 같은 자리에 seq로 합친다(`thread-store.ts`).
//
// **인자 객체가 평평해야 한다** — 객체 인자는 IPC 검사가 칸을 못 잰다. 이어 갈 곳(`link`)처럼 객체를 싣는 날에는 먼저 짓고 이름으로
// 넘긴다. 이 명령들은 L4 다리로 탈 수 없다(엔진이 앱 프로세스의 상태다) — 다리는 거절한다.
export const threadApi = {
  /** Claude Code를 찾고 로그인돼 있는지 묻는다. `reread`는 안내 카드의 「다시 확인」이다(로그인 환경을 새로 읽는다). */
  checkEngine: (reread: boolean) => invoke<EngineCheck>("thread_check_engine", { reread }),
  startLogin: () => invoke<void>("thread_start_login"),
  cancelLogin: () => invoke<void>("thread_cancel_login"),
  /** 앱 종료 확인 창의 셈 — 앱 전체에서 턴이 도는 Session · 대기 중인 말 · 답하지 않은 승인. 메모리만 읽는다. */
  quitCounts: () => invoke<QuitCounts>("thread_quit_counts"),
  /** 모든 Thread의 요약 — 새것이 먼저다. 깨진 Thread도 줄이 선다. */
  list: () => invoke<ThreadSummary[]>("thread_list"),
  /** Thread 하나의 지금 — `thread.json`과 기록의 끝 · 살아 있음 · 대기 줄. 없는 Thread는 읽히는 오류다. */
  get: (thread: string) => invoke<ThreadView>("thread_get", { thread }),
  /** 기록에서 `after` 다음 seq의 줄들. 처음 그릴 때는 `0`이다. */
  readRecord: (thread: string, after: number) => invoke<RecordLine[]>("thread_read_record", { thread, after }),
  /**
   * 새 Thread — 첫 말과 함께 세운다. Host의 Session이 열릴 때까지 기다리고 새 id를 돌려준다. 첫 말의 답은 기록 줄 이벤트로 흐른다.
   * 이어 갈 곳(`link`)은 Work 칩에서 고른 것이다(v1 티켓 31 — Work 없이 · 새 Work로 시작 · 최근 Work). 첨부는 경로만 간다(v1 티켓
   * 06 · S30). 나머지는 입력창 칩에서 첫 말 전에 고른 것이고 고르지 않은 칸은 `null`이다 — 물어보는 정도(v1 티켓 23 — 이은 Work면
   * 그 Work의 정도가 된다), 첫 Session의 모델 · 생각 깊이(v1 티켓 31 · 스토리 33 — 고르지 않으면 받는 Agent 정의의 값).
   */
  start: (text: string, attached: readonly Attachment[], link: ThreadLink, picks: StartPicks) => {
    const attachments = pathsOf(attached);
    const { mode, model, effort } = picks;
    return invoke<string>("thread_start", { text, attachments, link, mode, model, effort });
  },
  /** 말을 보낸다 — 기다리지 않는다. 턴이 도는 동안의 말은 대기 줄 끝에 든다(대기 줄 바뀜 이벤트). 첨부는 경로만 간다. */
  send: (thread: string, text: string, attached: readonly Attachment[] = []) => {
    const attachments = pathsOf(attached);
    return invoke<void>("thread_send", { thread, text, attachments });
  },
  /** 고르거나 끌어다 놓은 경로를 첨부로 잰다(크기 · 폴더인가) — 입력창의 칩. 없는 경로가 있으면 그 까닭으로 거절된다. */
  describeAttachments: (paths: string[]) => invoke<Attachment[]>("describe_attachments", { paths }),
  /** 도는 턴을 멈춘다 — 멈춘 턴의 끝은 `turn-end` 줄(`cancelledByUs: true`)로 온다. */
  stop: (thread: string) => invoke<void>("thread_stop", { thread }),
  editQueued: (thread: string, queued: string, text: string) =>
    invoke<void>("thread_edit_queued", { thread, queued, text }),
  deleteQueued: (thread: string, queued: string) => invoke<void>("thread_delete_queued", { thread, queued }),
  /** 지금 전하기 — 그 말을 맨 앞에 세우고 도는 턴을 멈춘다. */
  sendNow: (thread: string, queued: string) => invoke<void>("thread_send_now", { thread, queued }),
  /**
   * 권한 답 — 그 참여자(`who`)가 물은 요청에 고른 선택지로 답한다. 승인 카드(v1 티켓 24)의 「다시 묻지 않기」면 `remember`, 「아니요,
   * 다르게 해 주세요」의 입력칸에 쓴 말이 있으면 `words`다.
   */
  answerPermission: (thread: string, who: string, request: string, option: string, remember = false, words: string | null = null) =>
    invoke<void>("thread_answer_permission", { thread, who, request, option, remember, words }),
  /**
   * Work 만들기 카드의 답(v1 티켓 30) — 「Work 만들기」면 `create`와 고른 Project · 고친 브랜치(Project가 없으면 null), 「Work 없이 계속」이면
   * `create: false`다. 만들지 못하면 실패로 오고 카드는 그대로 선다(다시 고를 수 있다). 고른 것은 기록의 답 줄로 온다.
   */
  answerWork: (thread: string, request: string, create: boolean, projects: string[] = [], branch: string | null = null) =>
    invoke<void>("thread_answer_work", { thread, request, create, projects, branch }),
  /**
   * 질문 답(v1 티켓 26) — 그 참여자(`who`)가 낸 질문(`question` 줄의 요청 id)에 물음마다의 답으로 답한다. 질문 카드의 「나중에」면
   * `answers`를 비우고 `later`다.
   */
  answerQuestion: (thread: string, who: string, request: string, answers: readonly QuestionAnswer[], later = false) =>
    invoke<void>("thread_answer_question", { thread, who, request, answers, later }),
  /** 모델 바꾸기 — 그 참여자 Session의 값이다. 떠 있으면 다음 턴부터 든다. 답은 바뀐 참여자 줄이다. */
  setModel: (thread: string, who: string, model: string) =>
    invoke<Participant>("thread_set_model", { thread, who, model }),
  /** 생각 깊이 바꾸기(스토리 33) — 쉬는 Session은 같은 Session으로 다시 띄워 다음 턴부터 든다. 턴이 도는 동안은 거절된다. */
  setEffort: (thread: string, who: string, effort: string) =>
    invoke<Participant>("thread_set_effort", { thread, who, effort }),
  /**
   * 물어보는 정도 바꾸기(v1 티켓 23 · S18) — Work에 이은 Thread면 그 Work의 정도다. 다음 권한 요청부터 들고, 「계획만」으로 들고 나면
   * 떠 있는 Session의 계획 모드도 바뀐다. 바꾼 것은 `mode` 줄(「Policy를 … 바꿈」)로 온다.
   */
  setMode: (thread: string, mode: AskLevel) => invoke<void>("thread_set_mode", { thread, mode }),
  /** 그 Work의 지금 물어보는 정도(v1 티켓 31 · S18) — 새 Thread의 Work 칩에서 최근 Work를 고르면 물어보는 정도 칩이 이것을 보인다. */
  workMode: (work: string) => invoke<AskLevel>("thread_work_mode", { work }),
  /**
   * 다시 맡기기(v1 티켓 17) — 호출 줄에서 `from`의 부르기를 같은 글로 `to`에게 다시 한다. 기다리지 않는다: 부르기와 그 결과(부른
   * Agent의 다음 말)는 기록 줄 이벤트로 온다. 부를 수 없으면 그 까닭으로 거절된다.
   */
  callAgain: (thread: string, from: string, to: string, text: string) =>
    invoke<void>("thread_call_again", { thread, from, to, text }),
  /** 이름 바꾸기 — 위 막대에서 고친 이름. 같거나 빈 이름이면 아무것도 적지 않는다. 답은 바뀐 목록 요약이다. */
  rename: (thread: string, title: string) => invoke<ThreadSummary>("thread_rename", { thread, title }),
  /**
   * 읽은 자리 적기(v1 티켓 41 · S38) — Thread를 열고 맨 아래가 보일 때 끝 줄의 seq를 적는다. 뒤로 가지 않는다. 답은 바뀐 목록 요약이고,
   * 바뀌었으면 요약 이벤트도 온다.
   */
  markRead: (thread: string, seq: number) => invoke<ThreadSummary>("thread_mark_read", { thread, seq }),
  /**
   * 부를 수 있는 Agent와 깨진 파일 — `work`가 없으면 Library만, 있으면 그 Work의 Project 안까지다(v1 티켓 11). @ 메뉴 · 얼굴이
   * 읽고(14), 빈 Thread의 칩이 받는 Agent 정의 파일의 모델 · 생각 깊이를 읽는다(스토리 33).
   */
  agents: (work: string | null) => invoke<AgentRoster>("list_agents", { work }),
};

/** 엔진에 가는 첨부 — 절대 경로만. 크기는 엔진이 보낼 때 다시 잰다. */
const pathsOf = (attached: readonly Attachment[]) => attached.map((one) => one.path);

/** 기록 줄이 적힐 때마다 온다 — 어느 Thread든. 앱 층(`useThreadFeeds`) 하나가 듣는다. */
export function onThreadRecord(listener: (event: ThreadRecordEvent) => void): Promise<UnlistenFn> {
  return listen<ThreadRecordEvent>(THREAD_RECORD_EVENT, (event) => listener(event.payload));
}

/** 대기 줄이 바뀔 때마다 온다 — 그 참여자 Session의 대기 줄 전체다. */
export function onThreadQueue(listener: (event: ThreadQueueEvent) => void): Promise<UnlistenFn> {
  return listen<ThreadQueueEvent>(THREAD_QUEUE_EVENT, (event) => listener(event.payload));
}

/** Thread 하나의 요약이 바뀔 때마다 온다(새 Thread · 이름 바꿈 · 참여자가 늘었다). */
export function onThreadList(listener: (summary: ThreadSummary) => void): Promise<UnlistenFn> {
  return listen<ThreadSummary>(THREAD_LIST_EVENT, (event) => listener(event.payload));
}

/** 엔진 상태가 바뀔 때마다 온다 — 로그인 진행 · 끝난 뒤 다시 돈 확인의 답. 앱 층(`useThreadFeeds`) 하나가 듣는다. */
export function onThreadEngine(listener: (event: EngineState) => void): Promise<UnlistenFn> {
  return listen<EngineState>(THREAD_ENGINE_EVENT, (event) => listener(event.payload));
}
