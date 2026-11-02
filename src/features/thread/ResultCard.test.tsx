import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread } from "./fold";
import { ResultCard, ResultPlace, type ResultActions } from "./ResultCard";
import type { RecordLine } from "./types";

// 흐름의 결과 카드(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「대화로 한 설정 — 결과 카드」) — 엔진이 축복한 기록 `thread-setting`의
// `setting` 줄 넷을 접어 그린 글과 단추를 정적 마크업으로 잰다(목록 · 이동은 `ResultPlace`가 준다).

const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const off = (markup: string) => /<button[^>]*\sdisabled=""/.test(markup);
const cards = foldThread(record("thread-setting")).turns[0].entries.filter((entry) => entry.kind === "result");
const drawn = (actions?: ResultActions) =>
  cards.map((card) => {
    const one = <ResultCard card={card} />;
    return renderToStaticMarkup(actions ? <ResultPlace.Provider value={actions}>{one}</ResultPlace.Provider> : one);
  });

describe("결과 카드", () => {
  // ChatCards 「Service 고침」 — 「관계 그래프가 없어져 「열기」로 통일한다」(restart 02b-6). 한때 Service 고침만 「관계 보기」였다. 가는 곳(Service
  // 상세)은 그대로다.
  it("기록의 설정 줄 넷이 시안의 글 그대로 서고 단추는 모두 「열기」다", () => {
    expect(drawn().map(text)).toEqual([
      "Project를 추가했어요 — landing-page ~/MyProjects/landing-page · git 레포 · 기준 브랜치 main 열기",
      "web-app의 기준 브랜치를 main으로 바꿨어요 새 작업공간부터 main에서 갈라져요 열기",
      "결제 서비스에 backoffice를 넣었어요 Project 3 · 함께 쓰는 Service 1 열기",
      "Service를 만들었어요 — 정산 api-server · ~/.atelier/services/정산.md 열기",
    ]);
    expect(drawn().map(off)).toEqual([false, false, false, false]);
  });

  it("대상이 지금 목록에 없으면 단추가 꺼진다 — Project · Service를 제 목록에서 찾는다", () => {
    const markups = drawn({
      listed: (target) => (target === "project" ? ["web-app"] : ["정산"]),
      open: () => {},
    });
    expect(markups.map(off)).toEqual([true, false, true, false]);
  });
});

// ChatCards 보드 「결과 카드」(restart 02b-6 · `.ra-rcard`) — 열 폭 · 안쪽 10 10 10 12 · 사이 12 · 둥근 12 · 0.5 링(테두리가 아니다) · 흰 면, 왼쪽 32 상자
// (둥근 8 · `fill-soft`)의 글리프 15, 오른쪽 28 알약 「열기」(`.ra-opt`). 한때 1px `separator-soft` 테두리 · 상자 둥근 10 · 글리프 16 · 28 각진 단추였다.
describe("결과 카드의 모양", () => {
  const [markup] = drawn();
  const classes = (pattern: RegExp): string[] => pattern.exec(markup)?.[1].split("&amp;").join("&").split(" ") ?? [];

  it("카드는 둥근 12 · 0.5 링 · 흰 면이다", () => {
    const card = classes(/<section[^>]*class="([^"]*)"/);
    expect(card).toEqual(expect.arrayContaining(["rounded-xl", "shadow-hairline", "bg-surface", "py-2.5", "pr-2.5", "pl-3", "gap-3"]));
    expect(card.some((one) => one.startsWith("border"))).toBe(false);
  });

  // MainCards — 결과 카드는 턴의 한 칸이라 앞뒤 줄(작업 구분선 · 도구 줄 · 답)과 16이고, 여럿이면 사이 8로 쌓인다(`.ra-cards`). 턴 안 줄 사이는 8이라
  // 도구 줄 뒤 · 다음 줄 앞에 8을 더한다 — 다음이 결과 카드거나 턴 끝이면 더하지 않는다. 한때 답과 8이었다.
  it("앞의 도구 줄 · 뒤의 줄과는 16, 결과 카드끼리는 8이다", () => {
    expect(classes(/<section[^>]*class="([^"]*)"/)).toEqual(
      expect.arrayContaining(["[[data-log-run]+&]:mt-2", "[&:not(:last-child):not(:has(+[data-result]))]:mb-2"]),
    );
  });

  it("글리프 상자는 32 · 둥근 8이고 글리프는 15, 단추는 28 알약이다", () => {
    expect(classes(/<span class="([^"]*size-8[^"]*)"/)).toEqual(expect.arrayContaining(["rounded-md", "bg-fill-soft"]));
    expect(markup).toMatch(/<svg[^>]*class="[^"]*\bsize-3\.75\b/);
    expect(classes(/<button[^>]*class="([^"]*)"/)).toEqual(expect.arrayContaining(["h-7", "rounded-full", "px-3", "font-normal"]));
  });
});
