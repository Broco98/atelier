import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThreadComposer, { type ThreadComposerProps } from "./ThreadComposer";
import { setDraft } from "./thread-store";
import { lockedWork } from "./work-chip";

// 입력창(02 티켓 10 · 03 구현 스펙 §5 · §6 · 캔버스 v52 F4-KitComposer · v35 Diff-Chat · Screen-Live) — 정적 마크업으로 사람이 보는 것을 잰다:
// 트레이가 어디에 서는지(첫 화면은 상자 아래, Thread 화면은 상자 위)와 그 Work 칩(첫 말 전은 고르는 칩, 뒤는 잠긴 칩), 입력창 안의 것(`+` ·
// 물어보는 정도 · 모델 칩 — `@` 단추는 숨겼다), 보내기 원 하나가 네 상태(빈 · 글 · 보내는 중 · 도는 중)에서 무엇을 할 수 있다고 말하는지
// (접근성 이름 · 꺼짐).

const none = () => {};
const quiet = async () => {};

let drafts = 0;
/** 입력창의 정적 마크업 — `draft`는 입력칸에 이미 쓴 글이다. */
const composer = (over: Partial<ThreadComposerProps> = {}, draft = "") => {
  const draftKey = `composer-test-${(drafts += 1)}`;
  setDraft(draftKey, draft);
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ThreadComposer
        draftKey={draftKey}
        models={null}
        model={null}
        effort={null}
        onModel={none}
        onEffort={none}
        commands={[]}
        running={false}
        onSend={quiet}
        onNewThread={none}
        agents={[]}
        recipient={null}
        level="always"
        onLevel={none}
        {...over}
      />
    </QueryClientProvider>,
  );
};

/** 트레이의 마크업 — 입력창(`form`)에 붙어 서는 회색 띠다. */
const trayOf = (markup: string) => /<div data-slot="composer-tray"[^>]*>.*?<\/div>/s.exec(markup)?.[0] ?? null;
/** 트레이가 입력창 상자의 어느 쪽에 섰나 — 마크업의 차례로 읽는다. */
const sideOf = (markup: string) => (markup.indexOf('data-slot="composer-tray"') < markup.indexOf("<form") ? "above" : "below");
const formOf = (markup: string) => /<form[^>]*>.*<\/form>/s.exec(markup)?.[0] ?? "";

describe("트레이의 자리", () => {
  it("트레이를 주지 않으면 서지 않는다", () => {
    const markup = composer();
    expect(markup).not.toContain("어디서 일할지");
    expect(trayOf(markup)).toBeNull();
  });

  it("첫 화면(입력창이 가운데)에서는 상자 아래에 서고, 고르는 Work 칩이 든다 — 입력창 안에는 없다", () => {
    const markup = composer({
      tray: { at: "below", work: { kind: "pick", label: "새 Work", link: { kind: "new-work" }, onPick: none } },
    });
    expect(trayOf(markup)).toContain('aria-label="어디서 일할지 새 Work"');
    expect(formOf(markup)).not.toContain("어디서 일할지");
    expect(sideOf(markup)).toBe("below");
  });

  it("Thread 화면(입력창이 아래에 붙음)에서는 상자 위에 선다 — 첫 말 뒤의 칩은 잠겨 메뉴가 없다", () => {
    const markup = composer({
      tray: { at: "above", work: { kind: "locked", locked: lockedWork(null, null, false), onOpen: none } },
    });
    expect(sideOf(markup)).toBe("above");
    expect(trayOf(markup)).toContain("Work 없이 대화");
    expect(trayOf(markup)).not.toContain("어디서 일할지");
    expect(trayOf(markup)).not.toContain("aria-haspopup");
  });

  it("입력창 자리에 카드가 서면 트레이도 걷힌다", () => {
    const markup = composer({
      card: <section aria-label="승인" />,
      tray: { at: "above", work: { kind: "locked", locked: lockedWork(null, null, false), onOpen: none } },
    });
    expect(trayOf(markup)).toBeNull();
  });
});

describe("잠긴 Work 칩(03 §5 · S3)", () => {
  it("Work에 이은 Thread는 그 Work 이름이고, 누르면 그 Work로 가는 단추다", () => {
    const tray = trayOf(
      composer({ tray: { at: "above", work: { kind: "locked", locked: lockedWork("refund-api", "환불 API 버그 수정", false), onOpen: none } } }),
    );
    expect(tray).toContain('aria-label="Work로 가기: 환불 API 버그 수정"');
    expect(tray).toContain("환불 API 버그 수정");
  });

  it("Work 없는 Thread · 아직 Work가 없는 「새 Work」 Thread는 보이기만 한다 — 누를 것이 없다", () => {
    for (const [locked, text] of [
      [lockedWork(null, null, false), "Work 없이 대화"],
      [lockedWork(null, null, true), "새 Work"],
    ] as const) {
      const tray = trayOf(composer({ tray: { at: "above", work: { kind: "locked", locked, onOpen: none } } })) ?? "";
      expect(tray, text).toContain(text);
      expect(tray, text).not.toContain("<button");
    }
  });
});

describe("입력창 안(03 §6)", () => {
  it("`+` · 물어보는 정도 · 모델 칩만 선다 — `@` 단추(Agent 부르기)는 숨겼다", () => {
    const names = buttonsOf(composer({ models: [{ value: "default", name: "Default", description: null }], model: "default" })).map(
      (one) => one.name,
    );
    expect(names).toContain("파일 첨부");
    expect(names).toContain("물어보는 정도 매번 묻기");
    expect(names.some((name) => name.startsWith("모델과 생각 깊이"))).toBe(true);
    expect(names).not.toContain("Agent 부르기");
  });
});

/** 입력창의 둥근 단추들 — 접근성 이름과 꺼졌는지. 보내기 원은 `+` · `@` · 칩 뒤 맨 끝이다. */
const buttonsOf = (markup: string) =>
  [...markup.matchAll(/<button\b([^>]*)>/g)].flatMap(({ 1: attrs }) => {
    const name = /aria-label="([^"]+)"/.exec(attrs)?.[1];
    return name === undefined ? [] : [{ name, disabled: /\sdisabled=""/.test(attrs) }];
  });
const sendSpot = (markup: string) => buttonsOf(markup).filter((one) => ["보내기", "보내는 중", "멈추기"].includes(one.name));

describe("보내기 원 하나의 네 상태", () => {
  it("비었으면 꺼진 「보내기」다", () => {
    expect(sendSpot(composer())).toEqual([{ name: "보내기", disabled: true }]);
  });

  it("글이 있으면 켜진 「보내기」다", () => {
    expect(sendSpot(composer({}, "환불 API 고쳐 줘"))).toEqual([{ name: "보내기", disabled: false }]);
  });

  it("보내는 중(새 Thread의 첫 말 — Session이 열리기까지)이면 꺼진 「보내는 중」이다", () => {
    expect(sendSpot(composer({ busy: true }, "환불 API 고쳐 줘"))).toEqual([{ name: "보내는 중", disabled: true }]);
  });

  it("턴이 도는 동안 비었으면 「멈추기」다", () => {
    expect(sendSpot(composer({ running: true, onStop: quiet }))).toEqual([{ name: "멈추기", disabled: false }]);
  });

  it("턴이 도는 동안 글을 쓰면 원은 「보내기」다 — 멈추기는 Esc가 맡고, 원은 하나다", () => {
    expect(sendSpot(composer({ running: true, onStop: quiet }, "이것도 봐 줘"))).toEqual([{ name: "보내기", disabled: false }]);
  });
});
