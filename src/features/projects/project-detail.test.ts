import { describe, expect, it } from "vitest";
import type { Service } from "@/features/services/types";
import type { ThreadSummary } from "@/features/thread/types";
import { projectSections } from "./project-detail";

// Project 상세의 묶음(restart 03-2 · 스토리 114 · 보드 MainProjectDetail · Places `DETAILS`) — 작업공간 · 채팅 · Service. 값은 꾸민 것이다.

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

const work = (slug: string, projects: string[], over: { title?: string; branch?: string | null; service?: string } = {}) => ({
  slug,
  title: over.title ?? slug,
  branch: over.branch === undefined ? `feat/${slug}` : over.branch,
  projects,
  ...(over.service !== undefined && { service: over.service }),
});

const service = (slug: string, projects: string[], name = slug, problems: Service["problems"] = []) => ({ slug, name, projects, problems });

describe("작업공간 묶음", () => {
  it("그 Project를 고치는 작업공간이 이름 · 브랜치 · 그 작업공간 채팅의 마지막 줄 시각으로 서고, 최근 활동 순이다", () => {
    const works = [
      work("runtime-driver", ["atelier"], { title: "Runtime Driver 구조" }),
      work("watcher-signal", ["atelier", "backend"], { title: "워처 실패 신호" }),
      work("refund-webhook", ["backend"], { title: "환불 웹훅" }),
      work("terminal-batch", ["atelier"], { title: "터미널 출력 배칭", branch: null }),
    ];
    const threads = [
      chat("옛 채팅", "2026-11-02T07:00:00.000+09:00", { work: "watcher-signal" }),
      chat("새 채팅", "2026-11-03T08:48:00.000+09:00", { work: "watcher-signal" }),
      chat("구조 채팅", "2026-11-03T06:00:00.000+09:00", { work: "runtime-driver" }),
      chat("환불 채팅", "2026-11-03T08:59:00.000+09:00", { work: "refund-webhook" }),
    ];
    expect(projectSections("atelier", works, threads, []).works).toEqual([
      { slug: "watcher-signal", name: "워처 실패 신호", desc: "feat/watcher-signal", at: "2026-11-03T08:48:00.000+09:00" },
      { slug: "runtime-driver", name: "Runtime Driver 구조", desc: "feat/runtime-driver", at: "2026-11-03T06:00:00.000+09:00" },
      { slug: "terminal-batch", name: "터미널 출력 배칭", desc: "", at: null },
    ]);
  });
});

describe("채팅 묶음", () => {
  it("그 Project를 범위로 연 작업공간 밖 채팅이 「작업공간 밖」으로 서고, 깨진 채팅 · 다른 범위 · 작업공간의 채팅은 들지 않는다", () => {
    const threads = [
      chat("t1", "2026-11-02T09:00:00.000+09:00", { title: "ACP v2 변경점 조사", project: "atelier" }),
      chat("t2", "2026-11-03T08:00:00.000+09:00", { title: "", project: "atelier" }),
      chat("t3", "2026-11-03T08:30:00.000+09:00", { project: "backend" }),
      chat("t4", "2026-11-03T08:40:00.000+09:00", { work: "watcher-signal" }),
      chat("t5", "", { project: "atelier", broken: "기록을 읽지 못했어요" }),
      chat("t6", "2026-11-03T08:50:00.000+09:00", { service: "atelier-app" }),
    ];
    expect(projectSections("atelier", [work("watcher-signal", ["atelier"])], threads, []).chats).toEqual([
      { id: "t2", name: "새 채팅", desc: "작업공간 밖", at: "2026-11-03T08:00:00.000+09:00" },
      { id: "t1", name: "ACP v2 변경점 조사", desc: "작업공간 밖", at: "2026-11-02T09:00:00.000+09:00" },
    ]);
  });
});

describe("Service 묶음", () => {
  it("그 Project를 넣은 Service가 이름 · Project 수 · 그 Service의 최근 활동으로 선다", () => {
    const services = [
      service("admin", ["front", "legacy-admin"], "관리자 콘솔"),
      service("payments", ["backend", "front"], "결제 시스템"),
      service("atelier-app", ["atelier"], ""),
    ];
    const works = [work("refund-webhook", ["backend", "front"], { service: "payments" }), work("console-fix", ["front"])];
    const threads = [
      // Service 범위의 작업공간 밖 채팅과 그 Service를 쓰는 작업공간의 채팅이 그 Service의 활동이다.
      chat("범위 채팅", "2026-11-01T09:00:00.000+09:00", { service: "payments" }),
      chat("작업공간 채팅", "2026-11-03T06:00:00.000+09:00", { work: "refund-webhook" }),
      // Service 없는 작업공간 · 그 Project만 범위로 고른 채팅은 Service의 활동이 아니다.
      chat("다른 작업공간", "2026-11-03T08:00:00.000+09:00", { work: "console-fix" }),
      chat("Project 범위", "2026-11-03T08:30:00.000+09:00", { project: "front" }),
      chat("보관한 작업공간", "2026-11-03T08:40:00.000+09:00", { service: "admin", readOnly: "archived" }),
    ];
    expect(projectSections("front", works, threads, services).services).toEqual([
      { slug: "payments", name: "결제 시스템", desc: "Project 2개", at: "2026-11-03T06:00:00.000+09:00" },
      { slug: "admin", name: "관리자 콘솔", desc: "Project 2개", at: null },
    ]);
    expect(projectSections("atelier", works, threads, services).services).toEqual([
      { slug: "atelier-app", name: "atelier-app", desc: "Project 1개", at: null },
    ]);
  });

  // restart 03-3 — Service의 Project 수는 등록된 것만이다(Services 목록 · Service 상세와 같은 수 — 보드 legacy-admin 상세의 「관리자 콘솔 · Project 2개」).
  it("Service의 Project 수는 등록된 것만 센다", () => {
    const unknown = [{ line: 3, kind: "unknownProject" as const, project: "legacy-api", message: "등록되지 않은 Project예요" }];
    const services = [service("admin", ["front", "legacy-api", "legacy-admin"], "관리자 콘솔", unknown)];
    expect(projectSections("legacy-admin", [], [], services).services.map((row) => row.desc)).toEqual(["Project 2개"]);
  });
});
