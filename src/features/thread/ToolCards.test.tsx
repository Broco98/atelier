/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread } from "./fold";
import { isToolCardAsk } from "./tool-cards";
import { ToolCardSlot } from "./ToolCards";
import type { RecordLine } from "./types";

// Thread 도구 카드의 그리는 쪽 표(03 코드 리뷰 D2) — seam은 입력창 자리의 `ToolCardSlot` 하나다: 접은 물음 차례의 카드를 넣고, 그 갈래의 카드가
// 서는지와 바닥 단추를 본다. 바탕은 엔진이 축복한 기록을 카드가 선 데까지 자른 것이다(`fold.test.ts` 머리말). 카드마다의 글 · 키는 그 갈래의
// 순수 함수 시험(`space-card` · `project-add-card` · `project-card` · `work-proposal`)이 잰다.
const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);

/** 그 기록을 seq까지 접었을 때 입력창 자리에 서는 Thread 도구 카드. */
const slot = (name: string, seq: number) => {
  const card = foldThread(record(name).filter((line) => line.seq <= seq)).asks.find(isToolCardAsk);
  if (!card) throw new Error(`${name}에 Thread 도구 카드가 없다`);
  return renderToStaticMarkup(<ToolCardSlot thread="t" name="Host" avatar={null} card={card} />);
};
/** 그 이름의 단추 여는 태그. */
const button = (markup: string, label: string) =>
  [...markup.matchAll(/<button[^>]*>/g)].find((one) => markup.slice(one.index + one[0].length).startsWith(label))?.[0] ?? null;

describe("입력창 자리의 Thread 도구 카드", () => {
  it("갈래마다 그 카드가 선다 — Work 만들기 · Work 밖 Project · Space 질문 · Project 추가", () => {
    expect(slot("thread-work", 56)).toContain("이 일을 Work로 묶을까요?");
    expect(slot("thread-project", 8)).toContain("Host가 이 Work에 없는 Project를 고치려고 해요");
    expect(slot("thread-space-ask", 8)).toContain("어느 Space에서 할까요?");
    expect(slot("thread-project-add", 8)).toContain("notes는 git 저장소가 아니에요. 어떻게 할까요?");
  });

  // 「나중에」는 esc가 고르는 단추다 — 승인 카드의 esc 단추처럼 단축키 표의 그 키를 `aria-keyshortcuts`로 말한다. 글쇠 그림은 시안대로 없다.
  it("Space 질문 카드의 「나중에」는 esc를 단축키로 말하고, 「나중에」가 없는 Project 추가 카드는 「고르기」만 선다", () => {
    const space = slot("thread-space-ask", 8);
    expect(button(space, "나중에")).toContain('aria-keyshortcuts="Escape"');
    expect(button(space, "고르기")).not.toContain("aria-keyshortcuts");
    const adding = slot("thread-project-add", 8);
    expect(button(adding, "나중에")).toBeNull();
    expect(button(adding, "고르기")).not.toBeNull();
  });
});
