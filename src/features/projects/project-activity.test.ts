import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "@/features/thread/types";
import { projectActivity } from "./project-activity";

// Project의 「최근 활동」(restart 03-1 · 스펙 「03 — 목록과 상세」 「마지막 활동 시각은 작업공간과 채팅의 활동에서 짓는다. 저장하지 않는다」) —
// 그 Project를 고치는 작업공간에 이은 채팅과, 그 Project를 범위로 연 작업공간 밖 채팅의 마지막 줄 시각 가운데 가장 늦은 것이다.

const chat = (id: string, lastAt: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-10-01T09:00:00.000+09:00",
  lastAt,
  work: null,
  service: null,
  project: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

const WORKS = [
  { slug: "watcher-signal", projects: ["atelier"] },
  { slug: "refund-webhook", projects: ["backend", "front"] },
];

describe("Project의 최근 활동", () => {
  it("그 Project를 고치는 작업공간의 채팅과 그 Project 범위의 채팅 가운데 가장 늦은 마지막 줄이다", () => {
    const threads = [
      chat("작업공간 채팅", "2026-11-02T10:00:00.000+09:00", { work: "watcher-signal" }),
      chat("범위 채팅", "2026-11-03T08:48:00.000+09:00", { project: "atelier" }),
      chat("다른 범위", "2026-11-03T08:59:00.000+09:00", { project: "backend" }),
      chat("결제 작업공간", "2026-10-31T12:00:00.000+09:00", { work: "refund-webhook" }),
    ];
    expect(projectActivity(["atelier", "backend", "front", "hub-docs"], WORKS, threads)).toEqual({
      atelier: "2026-11-03T08:48:00.000+09:00",
      backend: "2026-11-03T08:59:00.000+09:00",
      front: "2026-10-31T12:00:00.000+09:00",
      "hub-docs": null,
    });
  });

  it("보관되거나 지워진 작업공간의 채팅 · 깨진 채팅은 세지 않는다", () => {
    const threads = [
      chat("보관된 작업공간", "2026-11-03T08:00:00.000+09:00", { work: "watcher-signal", readOnly: "archived" }),
      chat("목록에 없는 작업공간", "2026-11-03T08:10:00.000+09:00", { work: "gone-work" }),
      chat("깨짐", "", { broken: "thread.json을 읽지 못했습니다", project: "atelier" }),
    ];
    expect(projectActivity(["atelier"], WORKS, threads)).toEqual({ atelier: null });
  });

  it("시각대가 달라도 실제로 늦은 것이다", () => {
    const threads = [
      chat("서울", "2026-11-03T09:00:00.000+09:00", { project: "atelier" }),
      chat("UTC", "2026-11-03T00:30:00.000Z", { work: "watcher-signal" }),
    ];
    expect(projectActivity(["atelier"], WORKS, threads)).toEqual({ atelier: "2026-11-03T00:30:00.000Z" });
  });
});
