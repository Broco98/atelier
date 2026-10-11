import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CHAT_ENGINE_EVENT, CHAT_QUEUE_EVENT, CHAT_RECORD_EVENT } from "./events";
import type {
  Agent,
  ChatEngineEvent,
  ChatQueueEvent,
  ChatRecordEvent,
  Conversation,
  EngineCheck,
  RecordLine,
} from "./types";

// 대화 호스트를 부르는 명령(three-axes 티켓 05 · 07). 호스트는 앱 프로세스에 하나 살고, 다른 work로 가거나 화면을 새로고침해도
// 에이전트가 계속 돈다 — 그래서 대화는 기록에서 다시 그린다: 먼저 기록 줄 이벤트를 구독하고(`onChatRecord`), 그다음
// 「이 seq 다음부터」 읽는다(`readRecord`). 뒤의 호스트 장(07~)이 제 명령을 이 꼴로 더한다.
//
// **인자 객체가 평평해야 한다.** `tauri-commands.test.ts`의 인자 대조가 중첩 `{}`를 만나면 그 호출을 통째로 못 본다
// (`features/works/api.ts`가 같은 이유를 적어 뒀다). 인용처럼 객체를 싣는 날에는 객체를 먼저 짓고 이름으로 넘긴다.
//
// 이 명령들은 L4 다리로 탈 수 없다(호스트가 앱 프로세스의 상태다) — 다리는 거절하고, 부르는 화면은 그 거절에 무너지지
// 않아야 한다.
export const chatApi = {
  /**
   * 그 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾고, 찾았으면 로그인돼 있는지 엔진에게 묻는다. `reread`는
   * 안내 카드의 「다시 확인」이다 — 설치한 뒤 앱을 다시 켜지 않고 이어 가도록 로그인 환경을 새로 읽는다. 처음 한 번은
   * 로그인 셸을 기다린다(최대 10초). 답은 엔진 상태 이벤트로도 오고, 로그인돼 있으면 로그인을 기다리던 대화가 다시 뜬다.
   */
  checkEngine: (agent: Agent, reread: boolean) =>
    invoke<EngineCheck>("chat_check_engine", { agent, reread }),
  /** 그 work의 열린 대화들 — 만든 순서다. 읽기만 한다(에이전트를 띄우지 않는다). */
  list: (work: string) => invoke<Conversation[]>("chat_list", { work }),
  /** 그 대화의 기록에서 `after` 다음 seq의 줄들. 처음 그릴 때는 `0`이다. */
  readRecord: (work: string, conversation: string, after: number) =>
    invoke<RecordLine[]>("chat_read_record", { work, conversation, after }),
  /** 새 대화 — 만들고 곧바로 띄워 세션을 연다. 세션이 열릴 때까지 기다린다. */
  create: (work: string, agent: Agent) => invoke<Conversation>("chat_new", { work, agent }),
  /**
   * 에이전트 바꾸기 — 첫 말 전에만 된다. 지금 에이전트를 끄고 같은 대화를 새 엔진으로 띄워 세션이 열릴 때까지 기다린다.
   * 첫 말 뒤에는 거절되고, 그 글이 잠긴 에이전트 칩의 까닭이다(「첫 말 뒤에는 에이전트를 바꿀 수 없어요…」).
   */
  switchAgent: (work: string, conversation: string, agent: Agent) =>
    invoke<Conversation>("chat_switch_agent", { work, conversation, agent }),
  /**
   * 말을 보낸다. 턴을 기다리지 않는다 — 답은 기록 줄 이벤트로 흐르고, 턴 끝도 `turn-end` 줄로 온다. 턴이 도는 동안의 말은
   * 대기 줄 끝에 들고(대기 줄 바뀜 이벤트), 턴이 끝나면 맨 앞부터 차례로 간다.
   */
  send: (work: string, conversation: string, text: string) =>
    invoke<void>("chat_send", { work, conversation, text }),
  /**
   * 도는 턴을 멈춘다. 기다리지 않는다 — 멈춘 턴의 끝은 `turn-end` 줄(`cancelledByUs: true`)로 온다. 도는 턴이 없으면 아무
   * 일도 하지 않는다.
   */
  stop: (work: string, conversation: string) => invoke<void>("chat_stop", { work, conversation }),
  /** 대기 줄의 그 말(`queued` — 대기 id)의 글을 고친다. 차례는 그대로다. */
  editQueued: (work: string, conversation: string, queued: string, text: string) =>
    invoke<void>("chat_edit_queued", { work, conversation, queued, text }),
  /** 대기 줄에서 그 말(`queued` — 대기 id)을 지운다. */
  deleteQueued: (work: string, conversation: string, queued: string) =>
    invoke<void>("chat_delete_queued", { work, conversation, queued }),
  /**
   * 지금 보내기 — 그 말을 대기 줄 맨 앞에 「지금 보내기」로 세우고 도는 턴을 멈춘다. 턴이 `cancelled`로 끝나면 그 말이 먼저
   * 가고(`sent`의 `sendNow`가 true), 나머지 대기 줄은 그 뒤 차례로 간다. 기다리지 않는다.
   */
  sendNow: (work: string, conversation: string, queued: string) =>
    invoke<void>("chat_send_now", { work, conversation, queued }),
  /** 대화 닫기 — 에이전트를 끈다. 기록은 남는다. */
  close: (work: string, conversation: string) =>
    invoke<void>("chat_close", { work, conversation }),
  /**
   * 로그인 시작(three-axes 티켓 12) — 그 엔진의 로그인 명령을 띄운다. 명령이 브라우저를 연다. 진행(링크 · 끝남)은 엔진 상태
   * 이벤트로 오고(`onChatEngine`), 끝나면 호스트가 확인을 저절로 다시 돌아 「됨」이면 그 엔진의 로그인 필요 대화를 다시
   * 띄운다. 이미 돌면 새로 띄우지 않는다.
   */
  startLogin: (agent: Agent) => invoke<void>("chat_start_login", { agent }),
  /** 로그인 취소 — 도는 로그인 명령을 거둔다. 「끝남(취소)」은 엔진 상태 이벤트로 온다. */
  cancelLogin: (agent: Agent) => invoke<void>("chat_cancel_login", { agent }),
};

// 이벤트 이름 셋은 `events.ts`에 산다 — tauri를 부르지 않는 모듈이라 e2e(Node)도 같은 상수를 읽는다(three-axes 티켓 17).
export { CHAT_ENGINE_EVENT, CHAT_QUEUE_EVENT, CHAT_RECORD_EVENT } from "./events";

/**
 * 기록 줄이 적힐 때마다 온다 — 어느 work의 어느 대화든. 다른 work에 가 있어도 쌓이도록 화면 하나가 아니라 앱 층이
 * 듣는다(17).
 */
export function onChatRecord(listener: (event: ChatRecordEvent) => void): Promise<UnlistenFn> {
  return listen<ChatRecordEvent>(CHAT_RECORD_EVENT, (event) => listener(event.payload));
}

/**
 * 대기 줄이 바뀔 때마다 온다 — 어느 work의 어느 대화든. 대기 줄 전체가 오므로 받은 것으로 갈아 끼운다. 대기 줄은 기록에
 * 없어서(호스트 메모리에만 있다) 처음 그릴 때는 대화 목록의 `queue`로 그린다.
 */
export function onChatQueue(listener: (event: ChatQueueEvent) => void): Promise<UnlistenFn> {
  return listen<ChatQueueEvent>(CHAT_QUEUE_EVENT, (event) => listener(event.payload));
}

/**
 * 엔진 상태가 바뀔 때마다 온다 — 엔진을 확인할 때, 에이전트가 로그인을 요구할 때, 로그인 명령이 돌고(링크) 끝날 때.
 * 어느 대화 · 어느 work의 것이 아니라 엔진의 것이라, 같은 엔진의 카드가 다 따라 바뀐다.
 */
export function onChatEngine(listener: (event: ChatEngineEvent) => void): Promise<UnlistenFn> {
  return listen<ChatEngineEvent>(CHAT_ENGINE_EVENT, (event) => listener(event.payload));
}
