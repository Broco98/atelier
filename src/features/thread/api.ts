import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatEngineEvent } from "@/features/chat/types";
import { THREAD_ENGINE_EVENT, THREAD_LIST_EVENT, THREAD_QUEUE_EVENT, THREAD_RECORD_EVENT } from "./events";
import type {
  AgentRoster,
  Attachment,
  EngineCheck,
  Participant,
  RecordLine,
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
// **인자 객체가 평평해야 한다**(`chat/api.ts`가 같은 이유를 적어 뒀다) — 이어 갈 곳(`link`)처럼 객체를 싣는 날에는 먼저 짓고 이름으로
// 넘긴다. 이 명령들은 L4 다리로 탈 수 없다(엔진이 앱 프로세스의 상태다) — 다리는 거절한다.
export const threadApi = {
  /** Claude Code를 찾고 로그인돼 있는지 묻는다. `reread`는 안내 카드의 「다시 확인」이다(로그인 환경을 새로 읽는다). */
  checkEngine: (reread: boolean) => invoke<EngineCheck>("thread_check_engine", { reread }),
  startLogin: () => invoke<void>("thread_start_login"),
  cancelLogin: () => invoke<void>("thread_cancel_login"),
  /** 모든 Thread의 요약 — 새것이 먼저다. 깨진 Thread도 줄이 선다. */
  list: () => invoke<ThreadSummary[]>("thread_list"),
  /** Thread 하나의 지금 — `thread.json`과 기록의 끝 · 살아 있음 · 대기 줄. 없는 Thread는 읽히는 오류다. */
  get: (thread: string) => invoke<ThreadView>("thread_get", { thread }),
  /** 기록에서 `after` 다음 seq의 줄들. 처음 그릴 때는 `0`이다. */
  readRecord: (thread: string, after: number) => invoke<RecordLine[]>("thread_read_record", { thread, after }),
  /**
   * 새 Thread — 첫 말과 함께 세운다. Host의 Session이 열릴 때까지 기다리고 새 id를 돌려준다. 첫 말의 답은 기록 줄 이벤트로 흐른다.
   * 이어 갈 곳은 Work 칩(31)이 고르기 전까지 늘 「Work 없음」이다. 첨부는 경로만 간다(v1 티켓 06 · S30).
   */
  start: (text: string, attached: readonly Attachment[]) => {
    const link: ThreadLink = { kind: "no-work" };
    const attachments = pathsOf(attached);
    return invoke<string>("thread_start", { text, attachments, link });
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
  /** 권한 답 — 그 참여자(`who`)가 물은 요청에 고른 선택지로 답한다. */
  answerPermission: (thread: string, who: string, request: string, option: string) =>
    invoke<void>("thread_answer_permission", { thread, who, request, option }),
  /** 모델 바꾸기 — 그 참여자 Session의 값이다. 떠 있으면 다음 턴부터 든다. 답은 바뀐 참여자 줄이다. */
  setModel: (thread: string, who: string, model: string) =>
    invoke<Participant>("thread_set_model", { thread, who, model }),
  /** 생각 깊이 바꾸기(스토리 33) — 쉬는 Session은 같은 Session으로 다시 띄워 다음 턴부터 든다. 턴이 도는 동안은 거절된다. */
  setEffort: (thread: string, who: string, effort: string) =>
    invoke<Participant>("thread_set_effort", { thread, who, effort }),
  /**
   * 다시 맡기기(v1 티켓 17) — 호출 줄에서 `from`의 부르기를 같은 글로 `to`에게 다시 한다. 기다리지 않는다: 부르기와 그 결과(부른
   * Agent의 다음 말)는 기록 줄 이벤트로 온다. 부를 수 없으면 그 까닭으로 거절된다.
   */
  callAgain: (thread: string, from: string, to: string, text: string) =>
    invoke<void>("thread_call_again", { thread, from, to, text }),
  /** 이름 바꾸기 — 위 막대에서 고친 이름. 같거나 빈 이름이면 아무것도 적지 않는다. 답은 바뀐 목록 요약이다. */
  rename: (thread: string, title: string) => invoke<ThreadSummary>("thread_rename", { thread, title }),
  /**
   * 부를 수 있는 Agent와 깨진 파일 — `work`가 없으면 Library만, 있으면 그 Work의 Project 안까지다(v1 티켓 11). @ 메뉴 · 받는 이 칩 ·
   * 얼굴이 읽고(14), 빈 Thread의 칩이 Host 정의 파일의 모델 · 생각 깊이를 읽는다(스토리 33).
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

/** 엔진 상태가 바뀔 때마다 온다 — work 대화의 `chat:engine`과 같은 꼴이다. */
export function onThreadEngine(listener: (event: ChatEngineEvent) => void): Promise<UnlistenFn> {
  return listen<ChatEngineEvent>(THREAD_ENGINE_EVENT, (event) => listener(event.payload));
}
