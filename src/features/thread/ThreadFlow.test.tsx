/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread, type QuestionEntry } from "./fold";
import ThreadFlow, { AnsweredRow } from "./ThreadFlow";
import type { RecordLine } from "./types";

// 답한 카드(02 구현 스펙 §10 · 캔버스 v35 Components 「답한 카드」 · 02 코드 리뷰 S3) — 흐름에 물음마다 한 줄 카드로 남는다: **초록 ✓ 13** · 물은
// 제목 · 오른쪽 끝 고른 답. 무엇이 서는지(물음마다의 줄 · 나중에)는 `question.test.ts`의 `answeredCards`가 재고, 여기서는 그 줄의 표지를 잰다 —
// 한때 ✓가 12로 서서 시안 · 스펙의 13보다 작았다. 나중에로 닫은 질문의 시계도 같은 표지 자리라 같은 13이다(글자가 같은 세로줄에 선다).
describe("답한 카드의 표지", () => {
  const entry = (extra: Partial<QuestionEntry>): QuestionEntry => ({ kind: "question", key: "q1", choice: "answer", answers: [], ...extra });
  const marks = (markup: string) => markup.match(/<svg[^>]*>/g) ?? [];

  it("답한 물음마다 초록 ✓ 13이 줄 앞에 선다", () => {
    const markup = renderToStaticMarkup(
      <AnsweredRow
        entry={entry({
          answers: [
            { question: "부분 환불 수수료는 어떻게 할까요?", answer: "비율대로 돌려준다" },
            { question: "어느 화면에 보일까요?", answer: "주문 상세" },
          ],
        })}
      />,
    );
    const checks = marks(markup);
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      expect(check).toMatch(/class="[^"]*\blucide-check\b/);
      expect(check).toMatch(/class="[^"]*\bsize-3\.25\b/);
      expect(check).toMatch(/class="[^"]*\btext-diff-added\b/);
    }
  });

  it("나중에로 닫은 질문의 시계도 같은 13이다", () => {
    const [clock] = marks(renderToStaticMarkup(<AnsweredRow entry={entry({ choice: "later" })} />));
    expect(clock).toMatch(/class="[^"]*\blucide-clock\b/);
    expect(clock).toMatch(/class="[^"]*\bsize-3\.25\b/);
  });
});

// 물음 차례의 카드(승인 · 질문 · Thread 도구 카드 넷)가 흐름에 남기는 두 자리 — 도는 턴 머리줄 끝의 기다림 글과, 답한 뒤 그 도구 줄 자리의
// 결정 줄이다. 바탕은 엔진이 축복한 기록이다(`fold.test.ts` 머리말) — 카드가 선 데까지 자르면 기다리는 흐름, 통째면 답한 흐름이다.
describe("흐름의 물음 자리", () => {
  const record = (name: string): RecordLine[] =>
    readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RecordLine);
  const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
  const flow = (lines: readonly RecordLine[]) =>
    renderToStaticMarkup(
      <ThreadFlow thread="t" model={foldThread(lines)} onRetry={() => {}} onOpenSession={() => {}} onCallAgain={async () => {}} />,
    );
  /** 그 속성이 선 줄의 글 — 태그를 걷고 이어 읽는다. */
  const rowText = (markup: string, attribute: string) => {
    const at = markup.indexOf(attribute);
    if (at < 0) return null;
    const start = markup.lastIndexOf("<", at);
    const tag = /^<(\w+)/.exec(markup.slice(start))?.[1] ?? "";
    const end = markup.indexOf(`</${tag}>`, at);
    return markup.slice(start, end).replace(/<[^>]*>/g, "");
  };

  it("도는 턴의 머리줄 끝은 그 참여자가 기다리는 물음을 말한다 — 승인은 시안 문장, 나머지는 무엇의 답인지다", () => {
    const waiting = (lines: readonly RecordLine[]) => /<span class="text-link">([^<]*)<\/span>/.exec(flow(lines))?.[1] ?? null;
    expect(waiting(through(record("thread-permission"), 9))).toBe("승인을 기다립니다");
    expect(waiting(through(record("thread-question"), 8))).toBe("질문의 답을 기다려요");
    expect(waiting(through(record("thread-work"), 56))).toBe("Work 만들기 답을 기다려요");
    expect(waiting(through(record("thread-project"), 8))).toBe("Work 밖 Project 답을 기다려요");
    expect(waiting(through(record("thread-space-ask"), 8))).toBe("Space 답을 기다려요");
    expect(waiting(through(record("thread-project-add"), 8))).toBe("Project 추가 답을 기다려요");
  });

  // 답한 카드의 상자는 무슨 카드였나(`data-answered`)와 고른 갈래(`data-choice`)를 따로 든다(03 코드 리뷰 — 한때 질문만 답 갈래를 `data-answered`에 실었다).
  it("답한 카드는 그 도구 줄 자리에 결정 줄 한 줄로 선다 — 갈래는 속성에, 글은 고른 것이다", () => {
    expect(rowText(flow(record("thread-work")), 'data-decision="work-created"')).toBe(
      "Work 만들기 · api-server · fix/refund-partial-amount",
    );
    expect(rowText(flow(record("thread-project")), 'data-decision="project-attach"')).toBe("web-app을 이 Work에 붙임");
    expect(rowText(flow(record("thread-question")), 'data-answered="question" data-choice="answer"')).toBe(
      "부분 환불 수수료는 어떻게 할까요?비율대로 돌려준다어느 화면에 보일까요?주문 상세, 환불 내역",
    );
    expect(rowText(flow(record("thread-space-ask")), 'data-answered="space" data-choice="space"')).toBe(
      "어느 Space에서 할까요?결제 서비스",
    );
    expect(rowText(flow(record("thread-project-add")), 'data-answered="project-add" data-choice="init"')).toBe(
      "notes는 git 저장소가 아니에요. 어떻게 할까요?git init 하고 추가",
    );
  });
});
