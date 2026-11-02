/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread, type QuestionEntry } from "./fold";
import ThreadFlow, { AnsweredRow, DocPlace } from "./ThreadFlow";
import { threadUiStore, turnKey } from "./thread-store";
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
      <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" onRetry={() => {}} />,
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

  it("도는 턴의 머리줄 끝은 기다리는 물음을 말한다 — 승인은 시안 문장, 나머지는 무엇의 답인지다", () => {
    const waiting = (lines: readonly RecordLine[]) => /<span class="text-link">([^<]*)<\/span>/.exec(flow(lines))?.[1] ?? null;
    expect(waiting(through(record("thread-permission"), 8))).toBe("승인을 기다립니다");
    expect(waiting(through(record("thread-question"), 7))).toBe("질문의 답을 기다려요");
    expect(waiting(through(record("thread-work"), 54))).toBe("작업공간 만들기 답을 기다려요");
    expect(waiting(through(record("thread-project"), 7))).toBe("작업공간 밖 Project 답을 기다려요");
    expect(waiting(through(record("thread-service-ask"), 7))).toBe("Service 답을 기다려요");
    expect(waiting(through(record("thread-project-add"), 7))).toBe("Project 추가 답을 기다려요");
  });

  // 답한 카드의 상자는 무슨 카드였나(`data-answered`)와 고른 갈래(`data-choice`)를 따로 든다(03 코드 리뷰 — 한때 질문만 답 갈래를 `data-answered`에 실었다).
  it("답한 카드는 그 도구 줄 자리에 결정 줄 한 줄로 선다 — 갈래는 속성에, 글은 고른 것이다", () => {
    expect(rowText(flow(record("thread-work")), 'data-decision="work-created"')).toBe(
      "작업공간 만들기 · api-server · fix/refund-partial-amount",
    );
    expect(rowText(flow(record("thread-project")), 'data-decision="project-attach"')).toBe("web-app을 이 작업공간에 붙임");
    expect(rowText(flow(record("thread-question")), 'data-answered="question" data-choice="answer"')).toBe(
      "부분 환불 수수료는 어떻게 할까요?비율대로 돌려준다어느 화면에 보일까요?주문 상세, 환불 내역",
    );
    expect(rowText(flow(record("thread-service-ask")), 'data-answered="service" data-choice="service"')).toBe(
      "어느 Service에서 할까요?결제 서비스",
    );
    expect(rowText(flow(record("thread-project-add")), 'data-answered="project-add" data-choice="init"')).toBe(
      "notes는 git 저장소가 아니에요. 어떻게 할까요?git init 하고 추가",
    );
  });
});

// 채팅은 Runtime 세션 하나라 말한 이를 가를 일이 없다(스토리 2 · 구현 지도 「얼굴」) — 얼굴도 이름 줄도 없고, 말은 Runtime 이름으로 선다.
describe("Runtime 이름으로 말하는 흐름", () => {
  const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
  const sent = (seq: number, text: string): RecordLine => ({ seq, at: at(seq), kind: "sent", payload: { text } });
  const said = (seq: number, text: string): RecordLine => ({
    seq,
    at: at(seq),
    kind: "update",
    payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: `m${seq}`, content: { type: "text", text } } },
  });
  const ended = (seq: number): RecordLine => ({
    seq,
    at: at(seq),
    kind: "turn-end",
    payload: { stopReason: "end_turn", durationMs: 1000, cancelledByUs: false, outOfTurn: false },
  });
  const flow = (lines: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" onRetry={() => {}} />);
  const answeringRow = (markup: string) => /<p data-answering.*?<\/p>/.exec(markup)?.[0] ?? "";
  const words = (markup: string) => markup.replace(/<[^>]*>/g, "");

  it("답을 기다리는 동안 얼굴 없이 Runtime 이름으로 「답하는 중」이 선다", () => {
    const row = answeringRow(flow([sent(1, "고쳐 줘")]));
    expect(words(row)).toBe("Claude Code가 답하는 중");
    expect(row).not.toContain("<svg");
  });

  it("답한 턴에 이름 줄이 없다", () => {
    const markup = flow([sent(1, "봐 줘"), said(2, "봤어요"), ended(3)]);
    expect(words(markup)).toContain("봤어요");
    expect(markup).not.toContain("data-who");
    expect(markup).not.toContain("data-system");
  });

  it("턴이 spec 폴더에 쓴 문서 카드는 Runtime 이름으로 말한다", () => {
    const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-work.jsonl", import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RecordLine);
    const markup = renderToStaticMarkup(
      <DocPlace.Provider value={{ specRoot: "~/.atelier/works/refund-partial-amount/spec", open: () => {} }}>
        <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" onRetry={() => {}} />
      </DocPlace.Provider>,
    );
    expect(markup).toContain("Claude Code가 만듦 · 27줄 · 같이 고칠 수 있어요");
    expect(markup).not.toContain("Host가 만듦");
  });
});

// 답 아래 사용량 줄(01b-7 · 스토리 66 · 캔버스 Cards 보드 「답 아래 줄」) — 마지막 답에만 복사 단추 옆에 선다. 바탕은 엔진이 쓴 두 턴 기록이다.
describe("답 아래 사용량", () => {
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const flow = (model: ReturnType<typeof foldThread>) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={model} runtime="Claude Code" onRetry={() => {}} />);
  const shown = (markup: string) => [...markup.matchAll(/<span data-usage[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);

  it("마지막 답 아래에만 그 턴의 토큰과 컨텍스트 사용량이 선다", () => {
    expect(shown(flow(foldThread(lines)))).toEqual(["토큰 38.5k · 컨텍스트 4%"]);
  });

  it("턴이 도는 동안에는 서지 않는다 — 사용량을 받은 뒤 턴 끝 줄을 기다리는 때도 그렇다", () => {
    expect(shown(flow(foldThread(lines.filter((line) => line.seq <= 18))))).toEqual([]);
  });

  it("사용량이 없는 턴은 복사 단추만 선다", () => {
    const markup = flow(foldThread(lines.filter((line) => line.seq !== 18)));
    expect(shown(markup)).toEqual([]);
    expect(markup).toContain('aria-label="답 복사"');
  });
});

// 체크리스트의 자리(01b-7) — 턴이 끝나 접혀도, 작업 구분선을 눌러 펼쳐도 서 있다. 도는 줄 뒤에 온 `plan`은 턴 끝 답과 같은 꼬리에 들어 펼친 로그
// 밖이다. 한때 펼치면 사라졌다.
describe("체크리스트의 자리", () => {
  const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
  const update = (seq: number, body: Record<string, unknown>): RecordLine => ({
    seq,
    at: at(seq),
    kind: "update",
    payload: { sessionId: "s", update: body },
  });
  const lines: RecordLine[] = [
    { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } },
    update(2, { sessionUpdate: "tool_call", toolCallId: "r", title: "Read a.rs", kind: "read", status: "completed", locations: [{ path: "/w/a.rs" }] }),
    update(3, { sessionUpdate: "plan", entries: [{ content: "시험 돌리기", status: "in_progress" }] }),
    update(4, { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: "끝났어요" } }),
    { seq: 5, at: at(5), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 4000 } },
  ];
  const flow = (rows: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" onRetry={() => {}} />);
  const LIST = 'aria-label="계획 체크리스트"';

  it("도는 턴에도, 접힌 턴에도 선다", () => {
    expect(flow(lines.slice(0, 3))).toContain(LIST);
    expect(flow(lines)).toContain(LIST);
  });

  it("펼친 턴에도 선다", () => {
    threadUiStore.setState((state) => ({ ...state, expanded: { [turnKey("t", "t1")]: true } }));
    try {
      expect(flow(lines)).toContain(LIST);
    } finally {
      threadUiStore.setState((state) => ({ ...state, expanded: {} }));
    }
  });

  it("`plan`이 없으면 서지 않는다", () => {
    expect(flow(lines.filter((line) => line.seq !== 3))).not.toContain(LIST);
  });
});
