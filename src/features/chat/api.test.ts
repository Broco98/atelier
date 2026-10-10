import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { CHAT_ENGINE_EVENT, CHAT_QUEUE_EVENT, CHAT_RECORD_EVENT } from "./api";

// 대화 호스트의 이벤트 이름은 **두 언어가 문자열로만** 잇는다(three-axes 티켓 05). 어긋나면 답이 흘러도 화면은 아무
// 말이 없다. 선례는 셸 스스로 끝남(`processes-ended.test.ts`)과 종료 요청(`quit-request.test.ts`)이다. 상수를 못 찾으면
// 던진다(fail-closed).
describe("대화 호스트 이벤트", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/chat.rs", import.meta.url)), "utf8");
  const declared = (name: string): string => {
    const found = new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(source);
    if (!found) throw new Error(`chat.rs에서 ${name} 선언을 못 찾았다`);
    return found[1];
  };

  it("Rust가 쏘는 이름과 프런트가 듣는 이름이 같다 — 기록 줄 · 대기 줄 바뀜 · 엔진 상태", () => {
    expect(declared("RECORD_EVENT")).toBe(CHAT_RECORD_EVENT);
    expect(declared("QUEUE_EVENT")).toBe(CHAT_QUEUE_EVENT);
    expect(declared("ENGINE_EVENT")).toBe(CHAT_ENGINE_EVENT);
  });
});
