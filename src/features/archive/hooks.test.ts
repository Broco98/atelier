/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { archivedDocsQuery, archiveQuery, invalidateArchive } from "./hooks";
import type { ArchivedDocs, ArchiveEntry } from "./types";

// works 쪽과 같은 계약이고 근거도 같다(`works/hooks.test.ts`). **아카이빙은 works에서
// 하나가 사라지는 일**이라 `works:changed`가 오면 목록 무효화 문이 이쪽도 지운다.
// **훅이 짓는 키를 그대로 쓴다** — 손으로 같은 모양을 다시 지으면 진짜 키가 바뀌어도 이 파일이
// 초록이다(works 쪽 `specKey`와 같은 이유).
const docsKey = archivedDocsQuery("치운-가").queryKey;

// 문서 목록의 답 하나 — 목록과 spec 트리가 한 답으로 온다. 여기서 재는 것은 캐시 키라 트리는 비어 있다.
const RECORD_ONLY: ArchivedDocs = {
  docs: ["record.md"],
  specTree: { layoutId: "atelier", fallback: null, defaultDoc: null, items: [] },
};

function seeded() {
  const client = new QueryClient();
  client.setQueryData(archiveQuery().queryKey, [] as ArchiveEntry[]);
  client.setQueryData(docsKey, RECORD_ONLY);
  return client;
}

describe("아카이브 무효화", () => {
  it("목록과 그 아래 문서 목록을 다 지운다", () => {
    const client = seeded();
    invalidateArchive(client);
    expect(client.getQueryState(archiveQuery().queryKey)?.isInvalidated, "아카이브 목록").toBe(true);
    expect(client.getQueryState(docsKey)?.isInvalidated, "문서 목록").toBe(true);
  });

  it("이 파일에서 캐시를 지우는 자리가 하나다", () => {
    const source = readFileSync(fileURLToPath(new URL("./hooks.ts", import.meta.url)), "utf8");
    expect(source.split("invalidateQueries(").length - 1).toBe(1);
  });
});
