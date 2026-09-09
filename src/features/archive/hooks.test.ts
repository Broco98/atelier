/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { archivedDocsQuery, archivedFileQuery, archiveQuery, invalidateArchive } from "./hooks";
import { ALL_MODES } from "@/mode";
import type { Mode } from "@/mode";
import type { ArchiveEntry } from "./types";

// works 쪽과 같은 계약이고 근거도 같다(`works/hooks.test.ts`). **아카이빙은 works에서
// 하나가 사라지는 일**이라 이쪽도 `works:changed`를 듣는데, 그때 지우는 것이 한 세계뿐이면
// 저쪽 세계의 아카이브 목록만 조용히 낡는다.
// **훅이 짓는 키를 그대로 쓴다** — 손으로 같은 모양을 다시 지으면 진짜 키에서 `mode`가
// 빠져도 이 파일이 초록이다(works 쪽 `specKey`와 같은 이유).
const docsKey = (mode: Mode) => archivedDocsQuery(mode, "치운-가").queryKey;

function seeded() {
  const client = new QueryClient();
  for (const mode of ALL_MODES) {
    client.setQueryData(archiveQuery(mode).queryKey, [] as ArchiveEntry[]);
    client.setQueryData(docsKey(mode), ["record.md"]);
  }
  return client;
}

describe("archive 캐시는 세계별로 갈린다", () => {
  it("한 세계에 심은 목록이 저쪽 세계로 새지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(archiveQuery("atelier").queryKey, [] as ArchiveEntry[]);
    expect(client.getQueryData(archiveQuery("maison").queryKey)).toBeUndefined();
  });

  // **이쪽이 works보다 위험하다.** 아카이브 본문은 `staleTime: Infinity`라 한 번 겹치면
  // **다시 읽지 않는다** — 같은 이름(결정 10)의 저쪽 세계 본문이 영구히 뜬 채 화면은
  // 멀쩡해 보인다. 키에서 `mode`를 빼는 변형이 여기서 빨개진다.
  it("한 세계에 심은 문서 본문이 저쪽 세계로 새지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(
      archivedFileQuery("atelier", "겹친이름", "record.md").queryKey,
      "치운 작업의 본문",
    );
    expect(
      client.getQueryData(archivedFileQuery("maison", "겹친이름", "record.md").queryKey),
    ).toBeUndefined();
  });

  it("한 세계에 심은 문서 목록이 저쪽 세계로 새지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(archivedDocsQuery("atelier", "겹친이름").queryKey, ["record.md"]);
    expect(client.getQueryData(archivedDocsQuery("maison", "겹친이름").queryKey)).toBeUndefined();
  });
});

describe("아카이브 무효화", () => {
  it("두 세계의 목록과 그 아래 문서 목록을 다 지운다", () => {
    const client = seeded();
    invalidateArchive(client);
    for (const mode of ALL_MODES) {
      expect(
        client.getQueryState(archiveQuery(mode).queryKey)?.isInvalidated,
        `${mode} 아카이브 목록`,
      ).toBe(true);
      expect(client.getQueryState(docsKey(mode))?.isInvalidated, `${mode} 문서 목록`).toBe(true);
    }
  });

  it("이 파일에서 캐시를 지우는 자리가 하나다", () => {
    const source = readFileSync(fileURLToPath(new URL("./hooks.ts", import.meta.url)), "utf8");
    expect(source.split("invalidateQueries(").length - 1).toBe(1);
  });
});
