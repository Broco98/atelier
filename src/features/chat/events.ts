/**
 * 호스트가 내보내는 이벤트 이름 셋 — Rust의 `chat.rs`의 상수와 **문자열로만** 이어진다. 어긋나면 컴파일도 타입 검사도
 * 통과하고 화면만 조용하다. 그래서 `api.test.ts`가 그 선언을 읽어 견준다.
 *
 * tauri를 부르지 않는 작은 모듈에 둔다 — L3 검사(Node)가 기록 줄을 쏠 때 같은 이름을 읽는다(three-axes 티켓 17).
 *
 * - 기록 줄: 기록 파일에 적은 것과 같은 줄. 화면은 대화를 이것 하나로 그린다.
 * - 대기 줄 바뀜(07): 대기 줄이 바뀔 때마다 그 대화의 대기 줄 전체.
 * - 엔진 상태(12): 이름만 먼저 선다. 싣는 것과 듣는 함수는 그 장이 더한다.
 */
export const CHAT_RECORD_EVENT = "chat:record";
export const CHAT_QUEUE_EVENT = "chat:queue";
export const CHAT_ENGINE_EVENT = "chat:engine";
