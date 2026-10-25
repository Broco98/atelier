import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThreadComposer, { type ThreadComposerProps } from "./ThreadComposer";
import { setDraft } from "./thread-store";

// 입력창(02 티켓 10 · 구현 스펙 §9 · 캔버스 v35 Diff-Chat · F1-Home · Screen-Live) — 정적 마크업으로 사람이 보는 것을 잰다: Work 칩이 어디에
// 서는지(Thread 안에는 없고, 새 Thread에서는 입력창 아래 트레이에 선다)와, 보내기 원 하나가 네 상태(빈 · 글 · 보내는 중 · 도는 중)에서
// 무엇을 할 수 있다고 말하는지(접근성 이름 · 꺼짐).

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

/** 트레이의 마크업 — 입력창(`form`) 뒤, 입력창 밖에 서는 줄이다. */
const trayOf = (markup: string) => /<div data-slot="composer-tray"[^>]*>.*?<\/div>/s.exec(markup)?.[0] ?? null;

describe("Work 칩의 자리", () => {
  it("Thread 안의 입력창에는 Work 칩이 없다 — 머리 줄이 이미 말한다", () => {
    const markup = composer();
    expect(markup).not.toContain("어디서 일할지");
    expect(trayOf(markup)).toBeNull();
  });

  it("새 Thread에서는 입력창 아래 트레이에 Work 칩이 서고, 입력창 안에는 없다", () => {
    const markup = composer({ work: { label: "Work 없음", link: { kind: "no-work" }, onPick: none } });
    const tray = trayOf(markup);
    expect(tray).toContain('aria-label="어디서 일할지 Work 없음"');
    const form = /<form[^>]*>.*<\/form>/s.exec(markup)?.[0] ?? "";
    expect(form).not.toContain("어디서 일할지");
    expect(markup.indexOf("</form>")).toBeLessThan(markup.indexOf('data-slot="composer-tray"'));
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
