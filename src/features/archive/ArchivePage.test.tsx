import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ArchivePage from "./ArchivePage";
import { ToastProvider } from "@/components/ui/toast";
import { archiveQuery } from "./hooks";
import type { ArchiveEntry } from "./types";
import type { Mode } from "@/mode";

// **프로젝트라는 것이 Maison 화면 어디에도 없다**(결정 17)를 재는 자리. 목록 패널의 필터와
// 머리말의 프로젝트 칩은 서로 다른 파일에 있어서(ArchiveList · ArchivePage), 한쪽만 고친
// 커밋이 실제로 있었다 — 화면을 통째로 그려야 그 어긋남이 한 번에 걸린다.
//
// 정보 탭(`WorkInfo.test.tsx`)과 달리 프로바이더를 세운다. 이 화면은 목록도 문서도 스스로
// 조회하므로 순수 표현일 수 없고, 「목록이 왔다」와 「아직이다」가 빈 화면의 갈래를
// 가르기 때문에(`entriesPending`) 캐시를 심어 도착을 흉내낸다 — `WorkPanel.test.tsx` 방식.

const withProject: ArchiveEntry = {
  slug: "shipped",
  title: "치운 것",
  status: "done",
  archivedAt: "2026-08-16",
  // **Room에도 프로젝트 이름이 실려 올 수 있다** — 손으로 고친 work.json이나 저쪽 세계에서
  // 옮겨 온 폴더가 그렇다. 값이 비어 있으면 「비면 안 그린다」로 두어도 초록이라, 조건이
  // 실제로 세계를 보는지 재려면 여기가 채워져 있어야 한다.
  projects: ["atelier"],
};

// 토스트 자리(Viewport)는 Provider 밖에서 던진다 — 앱 루트(`main.tsx`)가 싸는 토스트 Provider를 여기서도 싼다(S14).
function render(mode: Mode, entries: ArchiveEntry[], selectedSlug: string | null = null): string {
  const client = new QueryClient();
  // `[]`도 심는다 — 안 심으면 pending이라 빈 화면이 아예 안 그려진다(도착 전에는 아무 말도
  // 하지 않는 것이 이 화면의 계약이다).
  client.setQueryData(archiveQuery(mode).queryKey, entries);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ArchivePage
          mode={mode}
          sidebarOpen
          selectedSlug={selectedSlug}
          currentFile={null}
          onSelectDoc={() => {}}
          onFollowLink={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // 패널 폭과 접힘이 여기서 온다 — 없으면 첫 렌더에서 던진다
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

describe("Maison 아카이브에는 프로젝트 자리가 없다", () => {
  it("목록 패널에 프로젝트 필터가 없다", () => {
    const markup = render("maison", [withProject]);
    expect(markup).not.toContain("모든 프로젝트");
    expect(markup).not.toContain("프로젝트");
  });

  it("머리말에 프로젝트 칩이 없다", () => {
    const markup = render("maison", [withProject], "shipped");
    // 제목은 떠 있는데(고른 것이 있다) 프로젝트 이름만 없다 — 머리말을 통째로 못 그린
    // 것과 갈라야 한다.
    expect(markup).toContain("치운 것");
    expect(markup).not.toContain("atelier");
  });

  // **같은 값이 Atelier에서는 둘 다 선다.** 한쪽만 재면 조건을 통째로 지워도 초록이다.
  it("같은 아카이브를 Atelier로 그리면 필터도 칩도 선다", () => {
    const markup = render("atelier", [withProject], "shipped");
    expect(markup).toContain("모든 프로젝트");
    expect(markup).toContain("atelier");
  });
});

describe("아무것도 안 치웠을 때", () => {
  // 낱말이 세계를 탄다(#183). 「작업」은 저쪽 세계의 이름이고 「워크트리」는 Room에 없는
  // 것이라(결정 17), 그 말을 읽은 사용자는 이 세계에 없는 것을 찾아 나선다.
  it("Maison은 Room 어휘로 말한다", () => {
    const markup = render("maison", []);
    expect(markup).toContain("아직 치운 Room이 없어요");
    expect(markup).toContain("끝난 Room의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.");
    expect(markup).toContain("끝난 Room의 ⋯ 메뉴에서 아카이빙하면 스펙과 기록이 여기 남아요.");
    expect(markup).not.toContain("작업");
    expect(markup).not.toContain("워크트리");
  });

  it("Atelier 문구는 그대로다", () => {
    const markup = render("atelier", []);
    expect(markup).toContain("아직 치운 작업이 없어요");
    expect(markup).toContain("끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.");
    expect(markup).toContain(
      "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.",
    );
  });
});

// 좁혀서 0개일 때 하는 말은 **렌더로 못 닿는다** — 검색어를 치거나 필터를 골라야 하는데
// 정적 마크업에는 그럴 손이 없다. 그래서 낱말의 계약은 `archive-copy.test.ts`가 재고,
// 화면이 리터럴로 되돌아가지 않았는지만 여기서 소스로 본다.
//
// **fail-closed로 짠다**: 파일이 옮겨지면 readFileSync가 던지고, 목록 패널이 통째로
// 사라져도 아래 첫 두 줄이 빨개진다. 「못 찾았으니 깨끗하다」로 떨어질 길이 없어야 검사다.
describe("좁혀서 0개일 때 하는 말", () => {
  it("목록이 그 문장을 손으로 적지 않는다", () => {
    const src = readFileSync(fileURLToPath(new URL("./ArchiveList.tsx", import.meta.url)), "utf8");

    // 잴 대상이 아직 거기 있다는 것부터 — 없으면 아래 「리터럴이 없다」는 공허하게 참이다
    expect(src).toContain("아카이브 검색");
    expect(src).toMatch(/narrowedNotice\(\s*mode\s*,/);

    // 이 문장은 **프로젝트 필터가 만든 좁힘**이라 Maison에서는 닿을 길이 없다. 화면에
    // 리터럴로 남으면 그 세계에서 영영 안 뜨는 문장이 코드에 앉고, 다음 사람이 그것을
    // 고치며 뜬다고 믿는다.
    expect(src).not.toContain("해당 프로젝트의 아카이브가 없어요");
  });
});
