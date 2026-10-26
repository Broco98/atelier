import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { projectsQuery } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import { spacesQuery } from "@/features/spaces/hooks";
import type { Space } from "@/features/spaces/types";
import { navItems } from "./nav-items";
import { PlaceCount } from "./place-count";

// 사람 메뉴(03 구현 스펙 §4 · 스토리 7 · 8). 항목의 차례와 `Projects` · `Space` 끝의 수를 잰다 — 수는 이미 읽힌 목록에서 센다.

describe("사람 메뉴", () => {
  it("항목은 Projects · Space · Terminal · Processes · Archive이고 Space는 Space 목록으로 간다", () => {
    expect(navItems.map((item) => item.label)).toEqual(["Projects", "Space", "Terminal", "Processes", "Archive"]);
    expect(navItems.find((item) => item.label === "Space")?.to).toBe("/spaces");
  });

  // 켜짐 판정은 `to` 접두사다(`AppShell`) — 다른 항목의 주소가 `/spaces`로 시작하거나 그 반대면 두 항목이 함께 켜진다.
  it("항목의 주소는 서로의 앞부분이 아니다", () => {
    for (const one of navItems) {
      for (const other of navItems) {
        if (one !== other) expect(`${other.to}/`.startsWith(`${one.to}/`), `${one.to} · ${other.to}`).toBe(false);
      }
    }
  });

  const render = (place: (typeof navItems)[number]["key"], projects?: number, spaces?: number) => {
    const client = new QueryClient();
    if (projects !== undefined) client.setQueryData(projectsQuery().queryKey, Array(projects).fill({}) as ProjectView[]);
    if (spaces !== undefined) client.setQueryData(spacesQuery().queryKey, Array(spaces).fill({}) as Space[]);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <PlaceCount place={place} />
      </QueryClientProvider>,
    );
  };

  it("Projects · Space 끝에 그 수가 서고, 다른 항목에는 서지 않는다", () => {
    expect(render("projects", 3, 2)).toContain(">3<");
    expect(render("spaces", 3, 2)).toContain(">2<");
    expect(render("spaces", 3, 0)).toContain(">0<");
    expect(render("archive", 3, 2)).toBe("");
  });

  it("아직 못 읽었으면 수가 서지 않는다", () => {
    expect(render("spaces")).toBe("");
  });
});
