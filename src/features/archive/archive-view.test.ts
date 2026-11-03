import { describe, expect, it } from "vitest";
import { archiveDesc, archiveFacts, shownArchive } from "./archive-view";
import type { ArchiveEntry } from "./types";

// Archive 목록 줄과 상세 위 카드의 값(restart 03-4 · 보드 PlaceSheet 「세 화면」 — 이름 옆 「상태와 Project」 · 상세 위 카드 「상태 · 보관한 날 · Project ·
// 브랜치」 · Places `DATA.archive` · `DETAILS['process-manager']`). 기대 글은 보드의 글자 그대로다(「완료 · atelier」 · 「검토 · backend · front」 · 「초안」).

const entry = (slug: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  slug,
  title: slug,
  status: "done",
  archivedAt: "2026-10-28",
  projects: ["atelier"],
  branch: `feat/${slug}`,
  ...over,
});

describe("줄의 이름 옆 글", () => {
  it("상태와 Project를 「 · 」로 잇는다 — Project가 없으면 상태뿐이다", () => {
    expect(archiveDesc(entry("process-manager"))).toBe("완료 · atelier");
    expect(archiveDesc(entry("pay-retry", { status: "review", projects: ["backend", "front"] }))).toBe("검토 · backend · front");
    expect(archiveDesc(entry("old-notes", { status: "draft", projects: [] }))).toBe("초안");
    expect(archiveDesc(entry("half", { status: "active" }))).toBe("진행 중 · atelier");
  });
});

describe("상세 위 카드", () => {
  it("상태 · 보관한 날(해까지 적은 그날) · Project · 브랜치다", () => {
    expect(archiveFacts(entry("process-manager", { branch: "feat/process-manager" }))).toEqual([
      { label: "상태", value: "완료" },
      { label: "보관한 날", value: "2026년 10월 28일" },
      { label: "Project", value: "atelier" },
      { label: "브랜치", value: "feat/process-manager" },
    ]);
  });

  it("Project가 여럿이면 「 · 」로 잇고, 날 · Project · 브랜치가 없으면 「—」다 — 없는 것을 지어내지 않는다", () => {
    expect(archiveFacts(entry("pay-retry", { status: "review", projects: ["backend", "front"] }))[2]).toEqual({ label: "Project", value: "backend · front" });
    expect(archiveFacts(entry("old-notes", { status: "draft", archivedAt: null, projects: [], branch: null }))).toEqual([
      { label: "상태", value: "초안" },
      { label: "보관한 날", value: "—" },
      { label: "Project", value: "—" },
      { label: "브랜치", value: "—" },
    ]);
  });

  it("보관한 날은 뒤에 시각이 붙은 값도 그날로 읽는다", () => {
    expect(archiveFacts(entry("a", { archivedAt: "2026-08-10T03:04:05Z" }))[1].value).toBe("2026년 8월 10일");
  });
});

describe("찾기", () => {
  const entries = [
    entry("process-manager", { title: "프로세스 매니저" }),
    entry("pay-retry", { title: "결제 재시도", status: "review", projects: ["backend", "front"] }),
    entry("old-notes", { title: "old-notes", status: "draft", projects: [] }),
  ];
  const titles = (query: string) => shownArchive(entries, query).map((one) => one.title);

  it("빈 글이면 모두다", () => {
    expect(titles("  ")).toEqual(["프로세스 매니저", "결제 재시도", "old-notes"]);
  });

  it("이름 · slug · 줄의 옆 글(상태 · Project)에서 대소문자 없이 찾는다", () => {
    expect(titles("매니저")).toEqual(["프로세스 매니저"]);
    expect(titles("PAY")).toEqual(["결제 재시도"]);
    expect(titles("front")).toEqual(["결제 재시도"]);
    expect(titles("초안")).toEqual(["old-notes"]);
    expect(titles("zzz")).toEqual([]);
  });
});
