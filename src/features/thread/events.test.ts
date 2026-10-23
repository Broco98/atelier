import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { THREAD_ENGINE_EVENT, THREAD_LIST_EVENT, THREAD_QUEUE_EVENT, THREAD_RECORD_EVENT } from "./events";

// Thread 엔진의 이벤트 이름도 **두 언어가 문자열로만** 잇는다(v1 티켓 04 · 구현 스펙 §18). 어긋나면 Host가 답해도 화면은
// 아무 말이 없다. 상수를 못 찾으면 던진다(fail-closed).
describe("Thread 엔진 이벤트", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/thread.rs", import.meta.url)), "utf8");
  const declared = (name: string): string => {
    const found = new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(source);
    if (!found) throw new Error(`thread.rs에서 ${name} 선언을 못 찾았다`);
    return found[1];
  };

  it("Rust가 쏘는 이름과 프런트가 듣는 이름이 같다 — 기록 줄 · 대기 줄 바뀜 · 목록 요약 · 엔진 상태", () => {
    expect(declared("RECORD_EVENT")).toBe(THREAD_RECORD_EVENT);
    expect(declared("QUEUE_EVENT")).toBe(THREAD_QUEUE_EVENT);
    expect(declared("LIST_EVENT")).toBe(THREAD_LIST_EVENT);
    expect(declared("ENGINE_EVENT")).toBe(THREAD_ENGINE_EVENT);
  });
});
