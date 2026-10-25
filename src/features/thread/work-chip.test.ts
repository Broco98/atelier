import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchHit } from "@/features/search/types";
import { lockedWork, recentWorks, rememberSwitch, startLink, workHome } from "./work-chip";

// 입력창 Work 칩(v1 티켓 31 · 03 구현 스펙 §5 · 캔버스 v52 F4-KitComposer · F4-HomeWorkMenu) — 첫 말 전에는 「새 Work」 · 「Work 없이 대화」
// 스위치와 최근 Work를 고르고, 고른 것이 칩 글자 · 입력창 안내를 바꾼다. 처음 고를 곳은 주소 씨앗 › 기억한 스위치 쪽 › 「새 Work」다(S2).
// 첫 말 뒤에는 잠겨 보이기만 한다(S3). 메뉴의 최근 Work는 마지막으로 연 차례(⌘K의 빈 화면과 같은 차례 — `recent.rs`)다.

describe("Work 칩이 고른 것", () => {
  it("칩 글자 · 입력창 안내가 고른 것을 따른다", () => {
    expect(workHome({ kind: "no-work" }, null)).toEqual({ chip: "Work 없이 대화", placeholder: "무엇이든 요청하세요" });
    expect(workHome({ kind: "new-work" }, null)).toEqual({ chip: "새 Work", placeholder: "만들 기능이나 고칠 문제를 적어 주세요" });
    expect(workHome({ kind: "work", slug: "refund-api" }, "환불 API 버그 수정")).toEqual({
      chip: "환불 API 버그 수정",
      placeholder: "환불 API 버그 수정에서 무엇을 할까요?",
    });
  });

  it("제목을 아직 모르는 Work는 slug로 선다", () => {
    expect(workHome({ kind: "work", slug: "refund-api" }, null).chip).toBe("refund-api");
  });
});

describe("처음 고를 곳 — 주소 씨앗 › 기억한 스위치 쪽 › 「새 Work」(03 §5 · S2)", () => {
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear();
    globalThis.localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    } as Storage;
  });
  afterEach(() => {
    // @ts-expect-error — 시험이 심은 저장소를 걷는다.
    delete globalThis.localStorage;
  });

  it("처음 쓰는 사람에겐 「새 Work」다 — 대표 길이 기본이다(스토리 14)", () => {
    expect(startLink(null)).toEqual({ kind: "new-work" });
  });

  it("마지막에 고른 스위치 쪽을 다음 새 Thread가 따른다(스토리 18)", () => {
    rememberSwitch({ kind: "no-work" });
    expect(startLink(null)).toEqual({ kind: "no-work" });
    rememberSwitch({ kind: "new-work" });
    expect(startLink(null)).toEqual({ kind: "new-work" });
  });

  it("최근 Work를 고른 것은 기억하지 않는다 — 다음 새 Thread가 엉뚱한 Work에 붙지 않게(스토리 19)", () => {
    rememberSwitch({ kind: "no-work" });
    rememberSwitch({ kind: "work", slug: "refund-api" });
    expect(startLink(null)).toEqual({ kind: "no-work" });
  });

  it("주소 씨앗은 기억보다 앞선다", () => {
    rememberSwitch({ kind: "no-work" });
    expect(startLink({ kind: "new-work" })).toEqual({ kind: "new-work" });
    expect(startLink({ kind: "work", slug: "refund-api" })).toEqual({ kind: "work", slug: "refund-api" });
    rememberSwitch({ kind: "new-work" });
    expect(startLink({ kind: "no-work" })).toEqual({ kind: "no-work" });
  });

  it("저장소를 읽지 못하거나 모르는 값이 적혀 있으면 「새 Work」다", () => {
    stored.set("work-chip-switch", "work:refund-api");
    expect(startLink(null)).toEqual({ kind: "new-work" });
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("막힘");
      },
      setItem: () => {
        throw new Error("막힘");
      },
    } as unknown as Storage;
    rememberSwitch({ kind: "no-work" });
    expect(startLink(null)).toEqual({ kind: "new-work" });
  });
});

describe("잠긴 Work 칩 — 첫 말 뒤(03 §5 · S3)", () => {
  it("Work에 이은 Thread는 그 Work 이름이다 — 제목을 아직 모르면 slug다", () => {
    expect(lockedWork("refund-api", "환불 API 버그 수정", false)).toEqual({
      kind: "work",
      slug: "refund-api",
      label: "환불 API 버그 수정",
    });
    expect(lockedWork("refund-api", null, false)).toEqual({ kind: "work", slug: "refund-api", label: "refund-api" });
  });

  it("Work 없는 Thread는 「Work 없이 대화」다", () => {
    expect(lockedWork(null, null, false)).toEqual({ kind: "no-work", label: "Work 없이 대화" });
  });

  it("「새 Work」로 시작해 아직 Work가 서지 않았으면 「새 Work」이고, Work 만들기 카드를 받아들이면 그 Work 이름이 된다", () => {
    expect(lockedWork(null, null, true)).toEqual({ kind: "new-work", label: "새 Work" });
    expect(lockedWork("refund-api", "환불 API 버그 수정", true)).toEqual({
      kind: "work",
      slug: "refund-api",
      label: "환불 API 버그 수정",
    });
  });
});

describe("최근 Work", () => {
  const hits: SearchHit[] = [
    { kind: "destination", key: "settings" },
    { kind: "work", slug: "refund-api", title: "환불 API 버그 수정", archived: false },
    { kind: "thread", id: "t1", title: "환불 API 버그 고쳐줘", archived: false },
    { kind: "work", slug: "checkout", title: "결제 페이지 리디자인", archived: false },
    { kind: "work", slug: "old", title: "치운 일", archived: true },
    { kind: "work", slug: "notes", title: "릴리스 노트 0.9", archived: false },
  ];

  it("검색이 준 Work 차례 그대로이고 보관된 것은 뺀다 — 진행 중인 Work만 이을 수 있다", () => {
    expect(recentWorks(hits)).toEqual([
      { slug: "refund-api", title: "환불 API 버그 수정" },
      { slug: "checkout", title: "결제 페이지 리디자인" },
      { slug: "notes", title: "릴리스 노트 0.9" },
    ]);
  });

  it("다섯까지만 선다 — 메뉴가 길어지지 않게", () => {
    const many: SearchHit[] = Array.from({ length: 8 }, (_, at) => ({
      kind: "work",
      slug: `w${at}`,
      title: `일 ${at}`,
      archived: false,
    }));
    expect(recentWorks(many).map((work) => work.slug)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
  });
});
