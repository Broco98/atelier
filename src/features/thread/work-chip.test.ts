import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/features/search/types";
import type { ThreadSummary } from "./types";
import { recentWorks, workHome } from "./work-chip";

// 입력창 Work 칩(v1 티켓 31 · 구현 스펙 §11 · 스토리 94–96 · 캔버스 Screen-Home 보드 「Work 칩 메뉴」) — 고른 것이 칩 글자 · 빈 Thread의
// 부제 · 입력창 안내를 바꾸고, 메뉴의 최근 Work는 마지막으로 연 차례(⌘K의 빈 화면과 같은 차례 — `recent.rs`)에 Thread 수를 단다.

const summary = (id: string, work: string | null): ThreadSummary => ({
  id,
  title: id,
  createdAt: "",
  work,
  handles: ["host"],
  lastRead: 0,
  readOnly: null,
  broken: null,
});

describe("Work 칩이 고른 것", () => {
  it("칩 글자 · 부제 · 입력창 안내가 Screen-Home 보드의 세 갈래 그대로다", () => {
    expect(workHome({ kind: "no-work" }, null)).toEqual({
      chip: "Work 없음",
      subtitle: "Host가 답합니다. Work는 필요할 때 Host가 만들어요.",
      placeholder: "무엇이든 요청하세요",
    });
    expect(workHome({ kind: "new-work" }, null)).toEqual({
      chip: "새 Work",
      subtitle: "첫 메시지로 Host가 Work를 만들어요. 고칠 Project는 Host가 물어봐요.",
      placeholder: "만들 기능이나 고칠 문제를 적어 주세요",
    });
    expect(workHome({ kind: "work", slug: "refund-api" }, "환불 API 버그 수정")).toEqual({
      chip: "환불 API 버그 수정",
      subtitle: "‘환불 API 버그 수정’에 새 Thread를 열어요.",
      placeholder: "환불 API 버그 수정에서 무엇을 할까요?",
    });
  });

  it("제목을 아직 모르는 Work는 slug로 선다", () => {
    expect(workHome({ kind: "work", slug: "refund-api" }, null).chip).toBe("refund-api");
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
  const threads = [summary("t1", "refund-api"), summary("t2", "refund-api"), summary("t3", "checkout"), summary("t4", null)];

  it("검색이 준 Work 차례 그대로, 보관된 것을 빼고, 그 Work에 이은 Thread 수를 단다", () => {
    expect(recentWorks(hits, threads)).toEqual([
      { slug: "refund-api", title: "환불 API 버그 수정", threads: 2 },
      { slug: "checkout", title: "결제 페이지 리디자인", threads: 1 },
      { slug: "notes", title: "릴리스 노트 0.9", threads: 0 },
    ]);
  });

  it("다섯까지만 선다 — 메뉴가 길어지지 않게", () => {
    const many: SearchHit[] = Array.from({ length: 8 }, (_, at) => ({
      kind: "work",
      slug: `w${at}`,
      title: `일 ${at}`,
      archived: false,
    }));
    expect(recentWorks(many, []).map((work) => work.slug)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
  });
});
