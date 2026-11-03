/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Arrival, settledPlace } from "./arrival";
import { foldThread, type QuestionEntry } from "./fold";
import { addChunk } from "./thread-store";
import ThreadFlow, { AnsweredRow, DocPlace, TURN_BOX, TURN_GAP, type FlowActions } from "./ThreadFlow";
import { threadUiStore, turnKey } from "./thread-store";
import type { RecordLine } from "./types";

const ACTIONS: FlowActions = { fill: () => {}, reconnect: () => {}, reconnecting: false, reconnectFailure: null };

/** 말 머리(보낸 시각 · 「메시지 복사」 — restart 02b-6)를 걷은 흐름 — 턴의 줄과 안내만 재는 시험이 쓴다. 말 머리는 「내 말의 말 머리」가 잰다. */
const withoutMeta = (markup: string) => markup.replace(/<div data-message-meta[^>]*>[\s\S]*?<\/div>/g, "");

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
      <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" />,
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

  // Tools 보드 「승인 대기」 · States 07(restart 02b-4) — 사람을 기다리는 동안 머리는 시간 없이 그 말 하나가 경고색으로 선다. 시계는 멈춰 있다
  // (`fold.test.ts` 「사람을 기다리는 동안의 시계」). 한때 「N초 동안 작업 중입니다 · 승인을 기다립니다」가 링크 색으로 붙었다.
  it("도는 턴의 머리는 기다리는 물음을 시간 없이 경고색으로 말한다 — 승인은 시안 문장, 나머지는 무엇의 답인지다", () => {
    const waiting = (lines: readonly RecordLine[]) => {
      const markup = flow(lines);
      const head = /<div data-work-divider[^>]*>(.*?)<\/div>/.exec(markup)?.[1] ?? "";
      expect(head).not.toContain("동안 작업 중입니다");
      return /<span class="[^"]*\btext-warning\b[^"]*">([^<]*)<\/span>/.exec(head)?.[1] ?? null;
    };
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

  // Codex 채팅의 카드는 사람이 답하지 않으면 한도에 닫힌다(01c-8 · Tools 보드 「승인 결정 줄」의 마지막 줄).
  it("답이 없어 닫힌 카드는 그 도구 줄 자리에 결정 줄 한 줄로 서고 실패한 도구 줄은 서지 않는다", () => {
    const closed = record("thread-codex-unanswered");
    const shut = closed.find((line) => line.kind === "question" && (line.payload as { state?: string }).state === "withdrawn")!.seq;
    for (const lines of [closed, through(closed, shut)]) {
      const markup = flow(lines);
      expect(rowText(markup, 'data-decision="unanswered"')).toBe("답이 없어 닫음 · Codex는 5분까지만 기다려요");
      expect(markup).not.toContain('role="group"');
    }
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
    withoutMeta(renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" />));
  const words = (markup: string) => markup.replace(/<[^>]*>/g, "");

  // States 보드 04 「생각 중 — 보낸 뒤 첫 출력까지」(restart 02b-1). 한때 Runtime 이름의 「답하는 중」과 점 셋이 섰다.
  it("보낸 뒤 아무 줄도 오지 않은 턴은 말풍선 아래 「생각 중」만 선다 — 이름 줄도 작업 머리줄도 없다", () => {
    const markup = flow([sent(1, "고쳐 줘")]);
    expect(words(markup)).toBe("고쳐 줘생각 중");
    expect(markup).not.toContain("<svg");
  });

  // States 보드 02 「세션 여는 중」 · 03 「보냄」(restart 02b-1) — Session이 내려가 있던 채팅은 Session이 열린 뒤에야 보낸 말이 기록에 선다. 그동안
  // 보낸 말이 흐름 끝에 말풍선으로 서고, Session을 띄우는 동안은 그 아래 「채팅을 시작하는 중」이다.
  describe("기록에 서기 전의 보낸 말", () => {
    const spawning = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "session", payload: { state: "spawning" } });
    const opened = (seq: number): RecordLine => ({ seq, at: at(seq), kind: "session", payload: { state: "opened", how: "resume" } });
    const pending = { text: "이어서 고쳐 줘", attachments: [], quote: null };
    const past = [sent(1, "봐 줘"), said(2, "봤어요"), ended(3)];
    const draw = (lines: readonly RecordLine[]) =>
      renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" pending={pending} />);

    it("Session을 띄우는 동안은 지난 턴 뒤에 말풍선과 「채팅을 시작하는 중」이 선다", () => {
      const text = words(draw([...past, spawning(4)]));
      expect(text.endsWith("봤어요이어서 고쳐 줘채팅을 시작하는 중")).toBe(true);
      expect(text).not.toContain("생각 중");
    });

    it("앞선 답 아래 줄(복사)은 걷힌다 — 이제 마지막 답이 아니다", () => {
      expect(draw([...past, spawning(4)])).not.toContain('aria-label="답 복사"');
      expect(flow(past)).toContain('aria-label="답 복사"');
    });

    it("Session이 열리면 말풍선만 남는다", () => {
      expect(words(draw([...past, spawning(4), opened(5)])).endsWith("봤어요이어서 고쳐 줘")).toBe(true);
    });
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
        <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" />
      </DocPlace.Provider>,
    );
    expect(markup).toContain("Claude Code가 만듦 · 27줄 · 같이 고칠 수 있어요");
    expect(markup).not.toContain("Host가 만듦");
    // ChatCards 보드 「문서 카드」(restart 02b-6) — 답 아래 16(턴 안 줄 사이 8 + 8)이고, 여럿이면 사이 8로 쌓인다. 한때 답 아래 8이었다.
    const docs = /<div data-created-docs="true" class="([^"]*)"/.exec(markup)?.[1].split(" ");
    expect(docs).toEqual(expect.arrayContaining(["mt-2", "gap-2"]));
  });

  // Thread 보드 「턴 끝」 · MainCards(restart 02b-6) — spec 폴더에 문서를 쓴 턴은 작업 로그에 문서 줄(문서 글리프 · 「생성됨 overview.md」 · 셈 없음)이 서고,
  // 답 아래에 그 문서 카드가 선다. 줄과 카드가 같은 문서를 같은 차례로 말한다.
  it("spec 폴더에 문서를 쓴 턴은 로그의 문서 줄과 답 아래 문서 카드가 함께 선다", () => {
    const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-work.jsonl", import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RecordLine);
    const model = foldThread(lines);
    threadUiStore.setState((state) => ({
      ...state,
      expanded: Object.fromEntries(model.turns.map((turn) => [turnKey("t", turn.key), true])),
    }));
    try {
      const markup = renderToStaticMarkup(
        <DocPlace.Provider value={{ specRoot: "~/.atelier/works/refund-partial-amount/spec", open: () => {} }}>
          <ThreadFlow thread="t" model={model} runtime="Claude Code" />
        </DocPlace.Provider>,
      );
      const docLines = [...markup.matchAll(/<div role="group" aria-label="([^"]*)"[^>]*><div class="[^"]*"><svg[^>]*data-glyph="doc"/g)].map((one) => one[1]);
      expect(docLines).toEqual(["생성됨 overview.md", "생성됨 plan.md"]);
      expect([...markup.matchAll(/data-doc-card="([^"]*)"/g)].map((one) => one[1])).toEqual(["overview.md", "01-fix/plan.md"]);
    } finally {
      threadUiStore.setState((state) => ({ ...state, expanded: {} }));
    }
  });
});

// 답 아래 사용량 줄(01b-7 · 스토리 66 · 캔버스 Cards 보드 「답 아래 줄」) — 마지막 답에만 복사 단추 옆에 선다. 바탕은 엔진이 쓴 두 턴 기록이다.
describe("답 아래 사용량", () => {
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const flow = (model: ReturnType<typeof foldThread>) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={model} runtime="Claude Code" />);
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

  // Cards 보드 「답 아래 줄」 `.ra-actions`(restart 02b-6) — 답(또는 문서 카드) 아래 12에 열 왼쪽 끝부터 선다. 복사는 26 · 둥근 8 · 글리프 14 ·
  // `fg-tertiary`이고 사용량은 그 곁 2 + 8에 12 / 18이다. 한때 24 단추 · 글리프 15 · `fg-subtle`이 왼쪽으로 4 나가 답 아래 6에 섰다.
  it("복사 단추는 26 · 글리프 14 · 옅은 글자이고, 줄은 답 아래 12에 열 왼쪽 끝부터 선다", () => {
    const markup = flow(foldThread(lines));
    const row = /<div data-answer-actions="true" class="([^"]*)">([\s\S]*?)<\/div>/.exec(markup);
    expect(row?.[1].split(" ")).toEqual(expect.arrayContaining(["mt-1", "gap-0.5"]));
    expect(row?.[1]).not.toMatch(/-ml-/);
    const button = /<button[^>]*aria-label="답 복사"[^>]*class="([^"]*)"/.exec(row![2]) ?? /<button[^>]*class="([^"]*)"[^>]*aria-label="답 복사"/.exec(row![2]);
    expect(button?.[1].split(" ")).toEqual(expect.arrayContaining(["icon-button-sm", "text-fg-tertiary"]));
    expect(row![2]).toMatch(/<svg[^>]*class="[^"]*\bsize-3\.5\b/);
    expect(row![2]).toMatch(/<span data-usage[^>]*class="[^"]*\bpl-2\b[^"]*\btext-xs\b/);
  });

  // 긴 답에서 이 줄을 더하는 배치가 턴 끝의 프레임에 얹히지 않게 한 프레임 뒤에 선다(01b-9). 처음 그린 화면에는 곧바로 선다.
  it("화면이 선 뒤에 턴이 끝나면 답 아래 줄은 그 그림에 서지 않는다", () => {
    const markup = renderToStaticMarkup(
      <Arrival.Provider value={settledPlace()}>
        <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" />
      </Arrival.Provider>,
    );
    expect(markup).not.toContain('aria-label="답 복사"');
    expect(flow(foldThread(lines))).toContain('aria-label="답 복사"');
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
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" />);
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

// 「대화를 정리하는 중」(01b-4 · 스토리 51 · 캔버스 Tools 보드 「생각 중 · 대화 정리 중」) — 정리 신호가 오는 동안만 「생각 중」 자리에 선다. 바탕은 엔진이
// `/compact` 녹음으로 쓴 기록이다 — seq 14가 정리의 시작, 15가 그 끝이다. 모양은 02b-4가 맞춘다.
describe("대화 정리 안내", () => {
  const WORDS = "대화를 정리하는 중";
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-compact.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const through = (seq: number) => lines.filter((line) => line.seq <= seq);
  const flow = (rows: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" />);
  const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
  const update = (seq: number, body: Record<string, unknown>): RecordLine => ({
    seq,
    at: at(seq),
    kind: "update",
    payload: { sessionId: "s", update: body },
  });
  const sent: RecordLine = { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } };
  const compacting = (seq: number) =>
    update(seq, { sessionUpdate: "tool_call", toolCallId: "compact", title: "Compact conversation", kind: "think", status: "in_progress" });

  it("정리하는 동안 서고, 「생각 중」은 서지 않는다", () => {
    const markup = flow(through(14));
    expect(markup).toContain(`>${WORDS}</p>`);
    expect(markup).not.toContain("생각 중");
  });

  it("정리가 끝나면 걷히고, 답을 기다리면 「생각 중」이 다시 선다", () => {
    const markup = flow(through(15));
    expect(markup).not.toContain(WORDS);
    expect(markup).toContain("생각 중");
    expect(flow(lines)).not.toContain(WORDS);
  });

  it("일하던 턴에서는 작업 줄 아래에 서고, 정리 줄은 작업 로그에 서지 않는다", () => {
    const read = update(2, { sessionUpdate: "tool_call", toolCallId: "r", title: "Read a.rs", kind: "read", status: "completed", locations: [{ path: "/w/a.rs" }] });
    const markup = flow([sent, read, compacting(3)]);
    expect(markup.indexOf("a.rs")).toBeLessThan(markup.indexOf(WORDS));
    expect(markup).not.toContain("Compact conversation");
  });

  it("「생각 중」과 함께 서지 않는다 — 정리가 그 자리를 잇는다", () => {
    const thought = update(2, { sessionUpdate: "agent_thought_chunk", messageId: "m", content: { type: "text", text: "살펴본다" } });
    const markup = flow([sent, thought, compacting(3)]);
    expect(markup).toContain(WORDS);
    expect(markup).not.toContain("생각 중");
  });

  it("끝나지 않은 줄도 턴이 끝나면 걷힌다", () => {
    const ended: RecordLine = { seq: 3, at: at(3), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000 } };
    expect(flow([sent, compacting(2), ended])).not.toContain(WORDS);
  });
});

// Runtime 경고(01b-8 · Cards 보드 「Runtime 경고」) — 안내 글은 첫 줄이고 「자세히」가 묶인 줄을 안내 안에서 모두 펼친다. 펼침은 `expanded`에 있어
// 턴이 끝나 자리를 옮겨도 남는다. 모양은 02b-5가 맞춘다.
describe("Runtime 경고의 자리", () => {
  const at = (second: number) => `2026-10-10T10:01:${String(second).padStart(2, "0")}.000+09:00`;
  const sent: RecordLine = { seq: 1, at: at(1), kind: "sent", payload: { text: "말" } };
  const warned = (seq: number, line: string): RecordLine => ({ seq, at: at(seq), kind: "stderr", payload: { line } });
  const said: RecordLine = {
    seq: 4,
    at: at(4),
    kind: "update",
    payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: "끝났어요" } } },
  };
  const ended: RecordLine = { seq: 5, at: at(5), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 4000 } };
  const inTurn = [sent, warned(2, "앱 기능 도구에 연결하지 못했어요"), warned(3, "둘째 줄")];
  const flow = (rows: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" />);
  const opened = (key: string, rows: readonly RecordLine[]) => {
    threadUiStore.setState((state) => ({ ...state, expanded: { [turnKey("t", key)]: true } }));
    try {
      return flow(rows);
    } finally {
      threadUiStore.setState((state) => ({ ...state, expanded: {} }));
    }
  };

  it("안내 글은 첫 줄이고 나머지는 「자세히」 안에 있다", () => {
    const markup = flow(inTurn);
    expect(markup).toContain("앱 기능 도구에 연결하지 못했어요");
    expect(markup).toContain(">자세히<");
    expect(markup).not.toContain("둘째 줄");
  });

  it("「자세히」는 묶인 줄을 안내 안에서 모두 펼친다", () => {
    const markup = opened("e2", inTurn);
    const details = markup.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    expect(details).toBe("앱 기능 도구에 연결하지 못했어요\n둘째 줄");
    expect(markup).toContain('aria-expanded="true"');
    // 펼친 원문은 안내 상자 안이다 — 상자가 닫히기 전에 선다.
    expect(markup).toMatch(/data-warning[^>]*>(?:(?!<\/div><\/div>)[\s\S])*<pre/);
  });

  it("안내는 실패 · 끊김 안내와 같은 상자다(Cards 보드 `.ra-notice`) — 글리프 ⓘ, 굵은 첫마디 없이 첫 줄, 끝에 작은 단추 「자세히」", () => {
    const markup = flow(inTurn);
    const box = markup.match(/<div data-warning[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(box.split(" ")).toEqual(expect.arrayContaining(["rounded-xl", "bg-fill-soft", "min-h-10", "text-chat-meta", "text-fg-secondary"]));
    expect(markup).not.toMatch(/data-warning[\s\S]*<b[\s>]/);
    expect(markup).toMatch(/<button[^>]*class="[^"]*h-6[^"]*"[^>]*>자세히<\/button>/);
  });

  it("턴 사이의 안내도 같다", () => {
    const rows = [sent, ended, warned(6, "첫 줄"), warned(7, "둘째 줄")];
    expect(flow(rows)).toContain("첫 줄");
    expect(flow(rows)).not.toContain("둘째 줄");
    expect(opened("n6", rows)).toContain("둘째 줄");
  });

  it("경고만 온 도는 턴은 안내와 「생각 중」이 서고 작업 머리줄은 서지 않는다", () => {
    const markup = flow(inTurn);
    expect(markup).toContain("생각 중");
    expect(markup).not.toContain("동안 작업 중입니다");
  });

  it("생각하는 중에 온 경고가 「생각 중」을 지우지 않는다", () => {
    const thought: RecordLine = {
      seq: 2,
      at: at(2),
      kind: "update",
      payload: { sessionId: "s", update: { sessionUpdate: "agent_thought_chunk", messageId: "m", content: { type: "text", text: "" } } },
    };
    expect(flow([sent, thought, warned(3, "경고")])).toContain("생각 중");
  });

  it("끝나 접힌 턴에도 서고, 턴이 끝나도 펼침이 남는다", () => {
    const rows = [...inTurn, said, ended];
    expect(flow(rows)).toContain("앱 기능 도구에 연결하지 못했어요");
    expect(opened("e2", rows)).toContain("둘째 줄");
  });

  it("경고 뒤에도 입력창을 막을 물음이 서지 않고 답은 그대로 흐른다", () => {
    const model = foldThread([...inTurn, said]);
    expect(model.asks).toEqual([]);
    expect(renderToStaticMarkup(<ThreadFlow thread="t" model={model} runtime="Claude Code" />)).toContain("끝났어요");
  });
});

// 실패한 턴과 끝 까닭의 안내(01b-5 · Cards 보드) — 글이 있어도 턴 끝 자리에 안내 줄이 선다. 문장은 `fold.test.ts`의 `endNotice`가 재고, 여기서는 자리를 잰다.
describe("턴 끝 안내", () => {
  const record = (name: string): RecordLine[] =>
    readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RecordLine);
  const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
  const flow = (lines: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" />);
  const words = (markup: string) => markup.replace(/<[^>]*>/g, "");

  it("실패한 턴은 받은 글 뒤에 안내가 서고 「다시 시도」도 복사 줄도 없다", () => {
    const markup = flow(through(record("thread-failed"), 7));
    expect(markup.indexOf("fails in the middle")).toBeGreaterThan(-1);
    expect(markup.indexOf('data-end-notice="failed"')).toBeGreaterThan(markup.indexOf("fails in the middle"));
    expect(words(markup)).toContain("이 턴이 실패로 끝났어요.");
    expect(words(markup)).toContain("받은 글까지는 남아 있어요.");
    expect(markup).not.toContain("다시 시도");
    expect(markup).not.toContain("답 복사");
  });

  it("거절과 턴 한도도 안내 줄로 선다", () => {
    expect(words(flow(through(record("thread-limits"), 8)))).toContain("이 요청에는 답할 수 없어요.");
    expect(flow(record("thread-limits"))).toContain('data-end-notice="max_turn_requests"');
  });

  it("길이 제한과 턴 한도의 단추는 지금의 턴에만 선다 — 지난 안내는 지나간 일이다", () => {
    const lines = record("thread-limits");
    const ends = lines.filter((line) => line.kind === "turn-end").map((line) => line.seq);
    const shown = (rows: readonly RecordLine[]) =>
      renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" actions={ACTIONS} />);
    expect(shown(through(lines, ends[1]))).toContain("이어서 쓰기");
    expect(shown(through(lines, ends[0]))).not.toContain("이어서 쓰기");
    const finished = shown(lines);
    expect(finished).toContain("이어서 하기");
    expect(finished).not.toContain("이어서 쓰기");
  });

  it("읽기만인 채팅에는 채울 입력창이 없어 단추가 서지 않는다", () => {
    expect(flow(record("thread-limits"))).not.toContain("이어서 하기");
  });
});

// 끊긴 턴(01b-6 · Cards 보드 「연결 끊김」 · 「다시 잇는 중」 · 「다시 잇지 못함」) — 문장은 `fold.test.ts`의 `cutNotice`가 재고, 여기서는 자리와 단추를 잰다.
describe("끊긴 턴의 안내", () => {
  const at = "2026-10-10T10:01:00.000+09:00";
  const session = (seq: number, payload: Record<string, unknown>): RecordLine => ({ seq, at, kind: "session", payload });
  const said: RecordLine = {
    seq: 2,
    at,
    kind: "update",
    payload: { update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "고치는 중" } } },
  };
  const cut: RecordLine[] = [{ seq: 1, at, kind: "sent", payload: { text: "고쳐 줘" } }, said, session(3, { state: "died", reason: "signal 9" })];
  const drawn = (lines: readonly RecordLine[], actions: Partial<FlowActions> | null = {}) =>
    withoutMeta(
      renderToStaticMarkup(
        <ThreadFlow thread="t" model={foldThread(lines)} runtime="Claude Code" actions={actions && { ...ACTIONS, ...actions }} />,
      ),
    );
  const shown = (markup: string) => markup.replace(/<[^>]*>/g, " ");

  it("받은 글 뒤에 안내와 「다시 잇기」가 서고 복사 줄은 없다", () => {
    const markup = drawn(cut);
    expect(markup.indexOf("고치는 중")).toBeGreaterThan(-1);
    expect(markup.indexOf('data-end-notice="cut"')).toBeGreaterThan(markup.indexOf("고치는 중"));
    expect(shown(markup)).toContain("Claude Code와 연결이 끊겼어요.");
    expect(shown(markup)).toContain("다시 잇기");
    expect(markup).not.toContain("답 복사");
    expect(markup).not.toContain("다시 시도");
  });

  // States 보드 15 「연결 끊김」(restart 02b-1) — 머리 없이 한 일이 펼친 채 남는다. 한때 「N초 동안 작업」으로 접혔다.
  it("도구까지 한 턴은 머리 없이 끊기기 전의 일이 펼쳐 선다", () => {
    const tool: RecordLine = {
      seq: 2,
      at: "2026-10-10T10:01:05.000+09:00",
      kind: "update",
      payload: { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "pnpm test", kind: "execute", status: "completed" } },
    };
    const lines = [cut[0], tool, { ...session(3, { state: "died", reason: "signal 9" }), at: "2026-10-10T10:01:09.000+09:00" }];
    const markup = drawn(lines);
    expect(shown(markup)).not.toContain("동안 작업");
    expect(markup).not.toContain("data-work-divider");
    expect(markup.indexOf("pnpm test")).toBeGreaterThan(-1);
    expect(markup.indexOf("pnpm test")).toBeLessThan(markup.indexOf('data-end-notice="cut"'));
  });

  it("다시 잇는 동안은 단추 대신 「다시 잇는 중」이다", () => {
    for (const markup of [drawn(cut, { reconnecting: true }), drawn([...cut, session(4, { state: "spawning" })])]) {
      expect(shown(markup)).toContain("다시 잇는 중");
      expect(markup).not.toContain("<button");
      expect(markup).not.toContain('data-end-notice="cut"');
    }
  });

  it("다시 잇지 못하면 까닭이 서고 단추가 남는다 — 명령의 거절도 기록의 죽음도 같다", () => {
    for (const markup of [
      drawn(cut, { reconnectFailure: "Runtime을 시작할 수 없어요" }),
      drawn([...cut, session(4, { state: "spawning" }), session(5, { state: "died", reason: "Runtime을 시작할 수 없어요" })]),
    ]) {
      expect(shown(markup)).toContain("다시 잇지 못했어요.");
      expect(shown(markup)).toContain("Runtime을 시작할 수 없어요.");
      expect(shown(markup)).toContain("다시 잇기");
    }
  });

  it("다시 이은 뒤에는 지난 일이다 — 단추가 없고 다시 잇자고 말하지 않는다", () => {
    const markup = drawn([...cut, session(4, { state: "spawning" }), session(5, { state: "opened", how: "resumed" })]);
    expect(shown(markup)).toContain("Claude Code와 연결이 끊겼어요.");
    expect(shown(markup)).toContain("받은 글까지는 남아 있어요.");
    expect(markup).not.toContain("다시 이으면");
    expect(markup).not.toContain("<button");
  });

  it("읽기만인 채팅은 다시 잇지 못한다 — 단추가 없고 다시 잇자고 말하지 않는다", () => {
    const markup = drawn(cut, null);
    expect(shown(markup)).toContain("Claude Code와 연결이 끊겼어요.");
    expect(markup).not.toContain("다시 이으면");
    expect(markup).not.toContain("<button");
  });
});

// 사람이 멈춘 턴(States 보드 14 · Tools 보드 「사람이 멈춤」 · restart 02b-1) — 머리가 「N초 후에 중단했습니다」로 턴 위에 서고 한 일은 펼친 채 남는다.
// 머리를 누르면 접힌다. 한때 ■ 줄이 턴 아래에 서고 로그는 접혀 있었으며, 흐른 답은 옅었다. 바탕은 엔진이 쓴 멈춤 기록이다.
describe("멈춘 턴", () => {
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-stopped.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const flow = (rows: readonly RecordLine[]) =>
    renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Claude Code" />);
  const head = (markup: string) => /<button[^>]*data-work-divider[^>]*>/.exec(markup)?.[0] ?? "";
  const words = (markup: string) => markup.replace(/<[^>]*>/g, " ");
  const said: RecordLine = {
    seq: 12,
    at: "2026-10-24T11:06:02.000+09:00",
    kind: "update",
    payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m9", content: { type: "text", text: "멈추기 전 글" } } },
  };

  it("머리가 턴 위에 서고 로그는 펼친 채 남는다 — ■ 줄은 따로 서지 않는다", () => {
    const markup = flow(lines);
    expect(head(markup)).toContain('aria-expanded="true"');
    expect(words(markup)).toContain("후에 중단했습니다");
    expect(words(markup).match(/후에 중단했습니다/g)).toHaveLength(1);
    expect(markup.indexOf("data-log-run")).toBeGreaterThan(markup.indexOf("후에 중단했습니다"));
  });

  // restart 02b-7 · 03-15a — 멈추는 순간 그려 둔 줄을 새 상자로 옮기면 앞선 긴 글을 통째로 다시 그려 그 프레임이 300ms 멎는다(L3 fixture에서 앞선 글
  // 4만 자 · 도구 60쌍). 도는 턴의 로그가 처음부터 로그 상자(`unfold`)에 서서, 멈추면 그 상자가 그대로 펼친 채 남는다 — 같은 칸 · 같은 열쇠라 다시
  // 그리지 않는다. 한때 도는 턴은 상자 없이 줄로 섰고, 멈춘 턴은 사람이 처음 접을 때 상자로 옮겨 섰다.
  describe("도는 턴의 로그 상자가 그대로 펼친 채 남는다", () => {
    const end = lines.find((line) => line.kind === "turn-end")!;
    const running = lines.filter((line) => line.seq < end.seq);
    /** 작업 로그 상자의 여는 꼬리표 — 머리 아래 8을 당겨 선다(`-mt-2`). 명령 출력의 펼침 상자와 그것으로 갈린다. */
    const box = (markup: string) => /<div[^>]*class="unfold -mt-2[^"]*"[^>]*>/.exec(markup)?.[0] ?? "";

    it("로그 묶음이 도는 턴과 같은 상자에 선다", () => {
      for (const markup of [flow(lines), flow(running)]) {
        expect(box(markup)).toBe('<div data-open="true" data-settled="true" class="unfold -mt-2 w-full">');
        expect(markup.indexOf("data-log-run")).toBeGreaterThan(markup.indexOf(box(markup)));
      }
    });

    it("머리에서 첫 줄까지 12, 로그 끝에서 멈추기 전 답까지 16이다 — 펼친 로그와 같다", () => {
      const markup = withoutMeta(flow([...running.filter((line) => line.seq !== 12), said, end]));
      // 머리 아래 8 · 칸 사이 8 · 상자가 당긴 −8 · 상자 안 위 4, 그리고 상자 안 아래 8 · 칸 사이 8.
      expect(/<div data-turn-head[^>]*class="([^"]*)"/.exec(markup)?.[1].split(" ")).toContain("mb-2");
      const inner = markup.slice(markup.indexOf(box(markup)) + box(markup).length);
      expect(/^<div><div class="([^"]*)"/.exec(inner)?.[1].split(" ")).toEqual(expect.arrayContaining(["gap-2", "pt-1", "pb-2"]));
      expect(markup.indexOf("멈추기 전 글")).toBeGreaterThan(markup.lastIndexOf("data-log-run"));
    });

    it("도는 동안은 로그 끝에서 그 뒤의 글까지 턴 안 줄 사이 8이다 — 글이 다음 도구에 상자로 들어도 자리가 그대로다", () => {
      const markup = withoutMeta(flow([...running.filter((line) => line.seq !== 12), said]));
      const inner = markup.slice(markup.indexOf(box(markup)) + box(markup).length);
      const classes = /^<div><div class="([^"]*)"/.exec(inner)?.[1].split(" ");
      expect(classes).toContain("pt-1");
      expect(classes).not.toContain("pb-2");
    });
  });

  it("머리를 눌러 접으면 한 일이 숨는다", () => {
    const [turn] = foldThread(lines).turns;
    threadUiStore.setState((state) => ({ ...state, expanded: { [turnKey("t", turn.key)]: false } }));
    try {
      const markup = flow(lines);
      expect(head(markup)).toContain('aria-expanded="false"');
      expect(markup).not.toContain("data-log-run");
    } finally {
      threadUiStore.setState((state) => ({ ...state, expanded: {} }));
    }
  });

  it("멈추기 전까지 흐른 답은 옅어지지 않고 그 자리에 남는다", () => {
    const end = lines.find((line) => line.kind === "turn-end")!;
    const markup = flow([...lines.filter((line) => line.seq < end.seq && line.seq !== 12), said, end]);
    const answer = /<div class="([^"]*)"><p>멈추기 전 글/.exec(markup);
    expect(answer?.[1]).toBeDefined();
    expect(answer?.[1]).not.toContain("text-fg-secondary");
  });
});

// 거부로 멈춘 턴 · 앱이 막아서 멈춘 턴(Tools 보드 「거부로 멈춤」 · 「앱이 막아서 멈춤」 · restart 02b-4) — 사람이 멈춘 턴처럼 머리가 위에 서고 로그는
// 펼친 채 남는다. 둘은 머리의 글로 갈리고, 앱이 막은 턴은 아래에 까닭 안내가 선다. 바탕은 엔진이 쓴 Codex 거절 기록이다(`thread-codex-refused`).
describe("거부로 멈춘 턴", () => {
  const refused = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-codex-refused.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const denied = refused.map((line) => {
    if (line.kind !== "turn-end") return line;
    const { appRefusal: _reason, ...payload } = line.payload as Record<string, unknown>;
    return { ...line, payload };
  });
  const flow = (rows: readonly RecordLine[]) => renderToStaticMarkup(<ThreadFlow thread="t" model={foldThread(rows)} runtime="Codex" />);
  const heads = (markup: string) => [...markup.matchAll(/<button[^>]*data-work-divider[^>]*>(.*?)<\/button>/g)];

  it("앱이 막은 턴은 「앱이 막아서 멈췄어요」가 펼친 채 서고 그 아래 까닭 안내가 선다", () => {
    const markup = flow(refused);
    const head = heads(markup)[heads(markup).length - 1];
    expect(head[0]).toContain('aria-expanded="true"');
    expect(head[1]).toContain("앱이 막아서 멈췄어요");
    expect(markup.indexOf('data-end-notice="app-refused"')).toBeGreaterThan(head.index);
  });

  it("사람이 거부한 턴은 「거부해서 멈췄어요」가 펼친 채 서고 안내가 없다", () => {
    const markup = flow(denied);
    const head = heads(markup)[heads(markup).length - 1];
    expect(head[0]).toContain('aria-expanded="true"');
    expect(head[1]).toContain("거부해서 멈췄어요");
    expect(markup).not.toContain("data-end-notice");
  });
});

// 흐르는 글(스펙 「01b — 스트리밍」) — 기록 줄이 아니라 접은 모델에 없다. 화면은 마지막 턴 꼬리에만 붙인다.
describe("흐르는 글", () => {
  const at = (second: number) => `2026-10-10T10:02:${String(second).padStart(2, "0")}.000+09:00`;
  const sent = (seq: number, text: string): RecordLine => ({ seq, at: at(seq), kind: "sent", payload: { text } });
  const update = (seq: number, sessionUpdate: string, text: string): RecordLine => ({
    seq,
    at: at(seq),
    kind: "update",
    payload: { sessionId: "s", update: { sessionUpdate, messageId: `m${seq}`, content: { type: "text", text } } },
  });
  const said = (seq: number, text: string) => update(seq, "agent_message_chunk", text);
  const thought = (seq: number, text: string) => update(seq, "agent_thought_chunk", text);
  const ended = (seq: number): RecordLine => ({
    seq,
    at: at(seq),
    kind: "turn-end",
    payload: { stopReason: "end_turn", durationMs: 1000, cancelledByUs: false, outOfTurn: false },
  });

  let serial = 0;
  /** 그 글이 흐르는 Thread 하나를 그린다 — 조각 이벤트가 쌓는 그 스토어에 넣는다. */
  const flow = (lines: readonly RecordLine[], kind: "message" | "thought", text: string) => {
    const thread = `흐름-${(serial += 1)}`;
    addChunk(thread, { stream: 1, kind, offset: 0, text });
    return renderToStaticMarkup(<ThreadFlow thread={thread} model={foldThread(lines)} runtime="Claude Code" />);
  };

  // States 보드 12의 말만 한 턴(restart 02b-1) — 끝나도 구분선이 없는 턴이라 도는 동안에도 머리가 없다. 한때 머리가 섰다가 턴 끝에 걷혔다.
  it("턴의 첫 조각부터 글이 서고 「생각 중」은 걷힌다 — 말만 하는 턴에는 작업 머리줄이 없다", () => {
    const markup = flow([sent(1, "물음")], "message", "흐르는답");
    expect(markup).toContain("흐르는답");
    expect(markup).not.toContain("동안 작업 중입니다");
    expect(markup).not.toContain("생각 중");
  });

  it("글이 흐르는 낱말로 선다 — 끝난 줄은 다시 움직이지 않는다", () => {
    const markup = flow([sent(1, "물음"), said(2, "앞선 글")], "message", "흐르는답");
    expect(markup).toContain('class="word-in">흐르는답');
    expect(markup).not.toContain('class="word-in">앞선');
  });

  it("마지막 턴의 줄들 뒤에 붙고 앞선 턴에는 붙지 않는다", () => {
    const lines = [sent(1, "앞선 물음"), said(2, "앞선 답"), ended(3), sent(4, "물음"), said(5, "먼저 온 글")];
    const markup = flow(lines, "message", "흐르는답");
    const order = ["앞선 답", "먼저 온 글", "흐르는답"].map((text) => markup.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(markup.match(/흐르는답/g)).toHaveLength(1);
  });

  it("끝나지 않은 앞선 턴에는 붙지 않는다", () => {
    const markup = flow([sent(1, "앞선 물음"), sent(2, "물음")], "message", "흐르는답");
    expect(markup.match(/흐르는답/g)).toHaveLength(1);
    expect(markup.indexOf("흐르는답")).toBeGreaterThan(markup.indexOf("물음</p>", markup.indexOf("앞선 물음") + 6));
  });

  it("끝난 턴의 꼬리에는 붙지 않는다 — 글은 기록 줄이 말한다", () => {
    expect(flow([sent(1, "물음"), said(2, "끝난 답"), ended(3)], "message", "남은 조각")).not.toContain("남은 조각");
  });

  it("글이 빈 생각은 「생각 중」으로만 선다", () => {
    const markup = flow([sent(1, "물음")], "thought", "");
    expect(markup.match(/생각 중/g)).toHaveLength(1);
    expect(markup).not.toContain("동안 작업 중입니다");
  });

  it("생각에 글이 있으면 옅은 글로 함께 선다", () => {
    const markup = flow([sent(1, "물음")], "thought", "살펴본다");
    expect(markup).toContain("살펴본다");
    expect(markup).toContain("text-fg-tertiary");
    expect(markup).toContain("생각 중");
  });

  it("답이 흐르면 앞선 생각 줄이 끝이어도 「생각 중」이 서지 않는다", () => {
    expect(flow([sent(1, "물음"), thought(2, "살폈다")], "message", "흐르는답")).not.toContain("생각 중");
  });

  it("흐르는 글이 없으면 기록 줄의 마지막 줄이 생각일 때 그대로 「생각 중」이다", () => {
    const markup = renderToStaticMarkup(
      <ThreadFlow thread="흐름-없음" model={foldThread([sent(1, "물음"), thought(2, "")])} runtime="Claude Code" />,
    );
    expect(markup).toContain("생각 중");
  });
});

// States 보드 12 「답 흐르는 중」(restart 03-15a) — 마지막 답이 흐르기 시작하면 로그가 「N초 동안 작업함 ›」으로 접히고 답이 그 아래로 흐른다. 마지막
// 답은 일 뒤의 글이 둘째 줄로 넘어간 때다(`fold.ts`의 `answerFrom`). 한 번 접히면 턴이 끝날 때까지 스스로 펴지지 않는다 — 뒤에 온 일은 답 아래에
// 이어 선다. 로그는 도는 동안 처음부터 한 상자(`unfold`)에 서서 접힐 때 높이 · 옅음으로 접히고(Motion 「작업 로그가 접힌다」), 접혀도 줄을 그대로
// 둔다(멈추면 다시 그리지 않고 펼친다). 한때 턴이 끝날 때까지 펼친 로그 아래로 답이 흘렀다(02b-1).
describe("답이 흐르는 턴", () => {
  const worked = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-work.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const through = (seq: number) => worked.filter((line) => line.seq <= seq);
  let serial = 0;
  /** 그 기록을 그린다 — 흐르는 글이 있으면 조각 이벤트가 쌓는 그 스토어에 넣는다. */
  const flow = (lines: readonly RecordLine[], flowing: string | null = null, thread = `답-${(serial += 1)}`) => {
    if (flowing !== null) addChunk(thread, { stream: 99, kind: "message", offset: 0, text: flowing });
    return withoutMeta(renderToStaticMarkup(<ThreadFlow thread={thread} model={foldThread(lines)} runtime="Claude Code" />));
  };
  const head = (markup: string) => /<(button|div)[^>]*data-work-divider[^>]*>([\s\S]*?)<\/\1>/.exec(markup);
  /** 작업 로그 상자의 여는 꼬리표 — 머리 아래 8을 당겨 선다(`-mt-2`). */
  const box = (markup: string) => /<div[^>]*class="unfold -mt-2[^"]*"[^>]*>/.exec(markup)?.[0] ?? null;
  const ANSWER = "버그는 찾았고, 재현도 해 봤어요.\n\n**원인** — 금액을 버린다";

  it("일 뒤의 글이 한 줄인 동안은 로그가 펼친 채 「N초 동안 작업 중입니다」 아래에 선다", () => {
    const markup = flow(through(68), "프런트를 확인해 볼게요.");
    expect(head(markup)?.[1]).toBe("div");
    expect(head(markup)?.[2]).toContain("동안 작업 중입니다");
    expect(box(markup)).toContain("data-open");
    expect(markup.indexOf("볼게요.")).toBeGreaterThan(markup.lastIndexOf("data-log-run"));
  });

  it("흐르는 답이 둘째 줄로 넘어가면 로그가 접힌 머리 「N초 동안 작업함 ›」 아래로 답이 흐른다", () => {
    const markup = flow(through(68), ANSWER);
    const [tag] = head(markup) ?? [""];
    expect(tag).toMatch(/^<button[^>]*aria-expanded="false"/);
    expect(head(markup)?.[2]).toMatch(/ 동안 작업함<svg/);
    expect(markup).not.toContain("동안 작업 중입니다");
    expect(box(markup)).not.toContain("data-open");
    expect(markup.indexOf("버린다")).toBeGreaterThan(markup.lastIndexOf("data-log-run"));
  });

  it("기록 줄이 된 답도 같다", () => {
    const markup = flow(through(69));
    expect(head(markup)?.[0]).toMatch(/^<button[^>]*aria-expanded="false"/);
    expect(head(markup)?.[2]).toContain("동안 작업함");
    expect(box(markup)).not.toContain("data-open");
  });

  it("접혀도 도는 동안은 로그의 줄이 상자 안에 그대로 있고, 닫힌 상자는 읽기에서 빠진다", () => {
    const markup = flow(through(68), ANSWER);
    const at = markup.indexOf(box(markup)!);
    expect(markup.indexOf("data-log-run")).toBeGreaterThan(at);
    expect(box(markup)).toContain('aria-hidden="true"');
    expect(box(markup)).not.toContain("inert");
  });

  it("접힌 뒤에 일이 다시 와도 스스로 펴지지 않고, 그 일은 답 아래에 이어 선다", () => {
    const late: RecordLine = {
      seq: 90,
      at: worked[worked.length - 1].at,
      kind: "update",
      payload: { sessionId: "s", update: { sessionUpdate: "tool_call", toolCallId: "late", title: "Read late.rs", kind: "read", status: "in_progress" } },
    };
    const markup = flow([...through(69), late]);
    expect(head(markup)?.[0]).toMatch(/^<button[^>]*aria-expanded="false"/);
    expect(markup.lastIndexOf("data-log-run")).toBeGreaterThan(markup.indexOf("버그는 찾았고"));
  });

  it("접힌 머리를 누르면 도는 동안에도 로그가 펼쳐진다", () => {
    const thread = "답-펼침";
    const [turn] = foldThread(through(69)).turns;
    threadUiStore.setState((state) => ({ ...state, expanded: { [turnKey(thread, turn.key)]: true } }));
    try {
      const markup = flow(through(69), null, thread);
      expect(head(markup)?.[0]).toMatch(/^<button[^>]*aria-expanded="true"/);
      expect(box(markup)).toContain("data-open");
    } finally {
      threadUiStore.setState((state) => ({ ...state, expanded: {} }));
    }
  });
});

// 턴 상자(restart 02b-6 · States · Thread · MainCards 보드 `.ra-turn`) — 턴 하나가 상자 하나다: 내 말(말풍선 · 말 머리), 턴의 줄, 그 턴 뒤에 온 PR
// 카드가 칸 사이 16으로 선다. 턴 사이는 48(`--gap-turn`)이다. 한때 흐름 한 줄에 말풍선 · 턴 상자 · PR 카드가 나란히 줄 사이 46으로 섰다(02b-1).
describe("턴 상자", () => {
  const css = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-pr.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  /** 그 속성을 단 `div`마다의 마크업 — 열고 닫는 `div`를 세어 끝을 찾는다. */
  const boxes = (markup: string, attribute: string) =>
    [...markup.matchAll(new RegExp(`<div ${attribute}`, "g"))].map((match) => {
      let depth = 0;
      const tags = /<div\b|<\/div>/g;
      tags.lastIndex = match.index;
      for (let tag = tags.exec(markup); tag; tag = tags.exec(markup)) {
        depth += tag[0] === "</div>" ? -1 : 1;
        if (depth === 0) return markup.slice(match.index, tag.index + 6);
      }
      return markup.slice(match.index);
    });

  it("턴 사이는 `--gap-turn`의 48이고 턴 안 칸 사이는 16이다", () => {
    const turnGap = /--gap-turn:\s*(\d+)px/.exec(css)?.[1];
    expect(turnGap).toBe("48");
    expect(TURN_GAP).toBe(`gap-${Number(turnGap) / 4}`);
    expect(TURN_BOX.split(" ")).toContain("gap-4");
  });

  it("말과 턴의 줄, 턴 뒤에 온 PR 카드가 그 턴의 상자에 선다", () => {
    const markup = renderToStaticMarkup(<ThreadFlow thread="턴-상자" model={foldThread(lines)} runtime="Claude Code" />);
    const [box, ...more] = boxes(markup, "data-turn-box");
    expect(more).toEqual([]);
    expect(box).toContain("data-message-meta");
    expect(box.split("<section").length - 1).toBe(lines.filter((line) => line.kind === "pr").length);
    expect(box.indexOf("<section")).toBeGreaterThan(box.indexOf("답 복사"));
  });
});

// 내 말의 말 머리(restart 02b-6 · Cards 보드 「내 말 — 기본 · 호버」 · Thread 보드 `.ra-msg-meta` · 스토리 72) — 말풍선 아래 4에 26 줄이 서고, 보낸
// 시각과 「메시지 복사」가 옅음에서 호버로 선다. 줄은 늘 자리를 차지한다 — 호버로 흐름이 밀리지 않는다.
describe("내 말의 말 머리", () => {
  const today = (hour: number, minute: number) => {
    const at = new Date();
    at.setHours(hour, minute, 0, 0);
    return at.toISOString();
  };
  const lines: RecordLine[] = [
    { seq: 1, at: today(14, 14), kind: "sent", payload: { text: "테스트도 같이 돌려 줘" } },
    {
      seq: 2,
      at: today(14, 15),
      kind: "update",
      payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "돌렸어요" } } },
    },
    { seq: 3, at: today(14, 15), kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 1000, cancelledByUs: false, outOfTurn: false } },
  ];
  const flow = (pending: { text: string; attachments: []; quote: null } | null = null) =>
    renderToStaticMarkup(<ThreadFlow thread="말-머리" model={foldThread(lines)} runtime="Claude Code" pending={pending} />);
  /** 말 머리 줄 — 시각 · 복사 단추. */
  const meta = (markup: string) => [...markup.matchAll(/<div data-message-meta[^>]*>([\s\S]*?)<\/div>/g)];

  it("말풍선 아래에 보낸 시각과 「메시지 복사」가 선다", () => {
    const [row, ...more] = meta(flow());
    expect(more).toEqual([]);
    expect(row[1].replace(/<[^>]*>/g, "")).toBe("오후 2:14");
    expect(row[1]).toContain('aria-label="메시지 복사"');
    const markup = flow();
    expect(markup.indexOf("data-message-meta")).toBeGreaterThan(markup.indexOf("테스트도 같이 돌려 줘"));
  });

  it("호버 전에는 옅음 속에 숨어 자리만 차지하고, 말에 올리거나 초점이 들면 선다", () => {
    const [row] = meta(flow());
    const classes = /class="([^"]*)"/.exec(row[0])![1].split(" ");
    expect(classes).toEqual(expect.arrayContaining(["h-6.5", "opacity-0", "group-hover/message:opacity-100", "group-focus-within/message:opacity-100"]));
  });

  it("기록에 서기 전의 보낸 말에도 복사가 선다 — 시각은 기록이 말한다", () => {
    const rows = meta(flow({ text: "이어서 고쳐 줘", attachments: [], quote: null }));
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toContain('aria-label="메시지 복사"');
    expect(rows[1][1].replace(/<[^>]*>/g, "")).toBe("");
  });
});

// 대기 중에 끼어든 말(restart 02b-2 · Cards 「대기 중에 끼어든 말」 · 스토리 70) — 대기 줄의 「지금 보내기」로 하던 턴을 끊고 들어간 말은 엔진이 `sent` 줄에
// `sendNow`로 적는다. 흐름은 그 말풍선 아래에 「하던 일을 멈추고 보냄」을 세워 차례대로 간 말과 가른다. 바탕은 축복한 두 턴짜리 기록이다.
describe("끼어든 말", () => {
  const twoTurns = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  /** 둘째 보낸 말을 「지금 보내기」로 보낸 기록. */
  const interjected = (() => {
    let sents = 0;
    return twoTurns.map((line) =>
      line.kind === "sent" && (sents += 1) === 2 ? { ...line, payload: { ...(line.payload as object), sendNow: true } } : line,
    );
  })();
  const flow = (lines: readonly RecordLine[]) => renderToStaticMarkup(<ThreadFlow thread="끼어든-말" model={foldThread(lines)} runtime="Claude Code" />);
  const NOTE = "하던 일을 멈추고 보냄";
  const second = (lines: readonly RecordLine[]) =>
    (lines.filter((line) => line.kind === "sent")[1].payload as { text: string }).text;

  it("「지금 보내기」로 보낸 말은 말풍선 아래에 그렇게 보낸 말이라고 선다", () => {
    const markup = flow(interjected);
    expect(markup.split(NOTE)).toHaveLength(2);
    expect(markup.indexOf(NOTE)).toBeGreaterThan(markup.indexOf(second(interjected)));
  });

  it("차례대로 간 말에는 서지 않는다", () => {
    expect(flow(twoTurns)).not.toContain(NOTE);
  });
});

// 보낸 말이 선다(restart 02b-7 · Motion 「보낸 말이 선다」 — 아래 12 · .985배에서 제자리, `duration-rise` 320ms · `ease-enter-snappy`). 화면이 선 뒤에
// 새로 선 말만 오르고, 처음 그린 말은 그대로 선다(Motion 머리말). 기록에 서기 전의 대기 말풍선이 먼저 올랐으면 그 말이 기록의 턴으로 옮겨 서도
// 다시 오르지 않는다 — 같은 것이 자리를 옮겨 다시 선 것이다.
describe("보낸 말이 선다", () => {
  const twoTurns = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  /** 첫 턴이 끝난 데까지 — 둘째 보낸 말 앞이다. */
  const firstTurn = twoTurns.slice(0, twoTurns.findIndex((line) => line.kind === "sent" && line.seq > 4));
  const pending = { text: "이어서 고쳐 줘", attachments: [], quote: null };
  /** 말 묶음(`data-user-message`)마다 그 클래스. */
  const messages = (markup: string) => [...markup.matchAll(/<div data-user-message[^>]*class="([^"]*)"/g)].map((m) => m[1].split(" "));
  const draw = (lines: readonly RecordLine[], place?: ReturnType<typeof settledPlace>, sent: typeof pending | null = null) => {
    const flow = <ThreadFlow thread="보낸-말" model={foldThread(lines)} runtime="Claude Code" pending={sent} />;
    return renderToStaticMarkup(place ? <Arrival.Provider value={place}>{flow}</Arrival.Provider> : flow);
  };

  it("처음 그린 말은 오르지 않는다", () => {
    const shown = messages(draw(twoTurns));
    expect(shown).toHaveLength(2);
    for (const one of shown) expect(one).not.toContain("msg-rise");
  });

  it("화면이 선 뒤에 새로 선 말은 오른다", () => {
    expect(messages(draw(twoTurns, settledPlace()))[1]).toContain("msg-rise");
  });

  it("기록에 서기 전의 대기 말풍선도 오른다", () => {
    const shown = messages(draw(firstTurn, settledPlace(), pending));
    expect(shown).toHaveLength(2);
    expect(shown[1]).toContain("msg-rise");
  });

  it("대기 말풍선으로 오른 말이 기록의 턴으로 옮겨 서면 다시 오르지 않는다", () => {
    // 대기 말풍선을 그린 그림이 자리에 묻는 이름들을 엿듣는다 — 이름은 커밋 뒤에 적히는데 정적 그림에는 커밋이 없다. 그 이름들이 적힌 자리에
    // 기록의 둘째 턴(같은 말)이 선다.
    const asked: string[] = [];
    class Listening extends Set<string> {
      has(name: string) {
        asked.push(name);
        return super.has(name);
      }
    }
    expect(messages(draw(firstTurn, { settled: true, seen: new Listening() }, pending))[1]).toContain("msg-rise");
    expect(messages(draw(twoTurns, { settled: true, seen: new Set(asked) }))[1]).not.toContain("msg-rise");
  });
});
