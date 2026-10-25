import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread } from "./fold";
import { ResultCard, ResultPlace, type ResultActions } from "./ResultCard";
import type { RecordLine } from "./types";

// 흐름의 결과 카드(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「대화로 한 설정 — 결과 카드」) — 엔진이 축복한 기록 `thread-setting`의
// `setting` 줄 넷을 접어 그린 글과 단추를 정적 마크업으로 잰다. 카드는 훅 없이 그린다(목록 · 이동은 `ResultPlace`가 준다).

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
  it("기록의 설정 줄 넷이 시안의 글 그대로 선다 — Space 고침만 「관계 보기」다", () => {
    expect(drawn().map(text)).toEqual([
      "Project를 추가했어요 — landing-page ~/MyProjects/landing-page · git 레포 · 기준 브랜치 main 열기",
      "web-app의 기준 브랜치를 main으로 바꿨어요 새 Work부터 main에서 갈라져요 열기",
      "결제 서비스에 backoffice를 넣었어요 Project 3 · 함께 쓰는 Space 1 관계 보기",
      "Space를 만들었어요 — 정산 api-server · ~/.atelier/spaces/정산.md 열기",
    ]);
    expect(drawn().map(off)).toEqual([false, false, false, false]);
  });

  it("대상이 지금 목록에 없으면 단추가 꺼진다 — Project · Space를 제 목록에서 찾는다", () => {
    const markups = drawn({
      listed: (target) => (target === "project" ? ["web-app"] : ["정산"]),
      open: () => {},
    });
    expect(markups.map(off)).toEqual([true, false, true, false]);
  });
});
