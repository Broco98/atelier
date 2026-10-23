/**
 * Thread 엔진이 내보내는 이벤트 이름 넷(v1 티켓 04 · 구현 스펙 §18) — Rust의 `thread.rs`의 상수와 **문자열로만** 이어진다.
 * 어긋나면 컴파일도 타입 검사도 통과하고 화면만 조용하다. 그래서 `events.test.ts`가 그 선언을 읽어 견준다.
 *
 * tauri를 부르지 않는 작은 모듈에 둔다 — 대화의 `chat/events.ts`와 같은 까닭이다. 듣는 쪽(api)은 Thread 화면(05)이 둔다.
 *
 * - 기록 줄: `events.jsonl`에 적은 것과 같은 줄 + Thread id · seq. 화면은 Thread를 이것 하나로 그린다.
 * - 대기 줄 바뀜: 참여자 하나의 Session의 대기 줄 전체(Thread id · 참여자 handle과 함께).
 * - 목록 요약: Thread 하나의 요약이 바뀜(새 Thread · 참여자가 늘었다). Thread 폴더는 감시하지 않는다(S7).
 * - 엔진 상태: 찾음 여부 · 로그인 여부 · 로그인 진행. work 대화의 `chat:engine`과 같은 것이다.
 */
export const THREAD_RECORD_EVENT = "thread:record";
export const THREAD_QUEUE_EVENT = "thread:queue";
export const THREAD_LIST_EVENT = "thread:list";
export const THREAD_ENGINE_EVENT = "thread:engine";
