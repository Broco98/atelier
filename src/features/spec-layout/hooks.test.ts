/// <reference types="node" />
// 소스 스캔 두 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { archivedDocsQuery, archiveQuery } from "@/features/archive/hooks";
import { worksQuery } from "@/features/works/hooks";
import { ALL_MODES } from "@/mode";
import type { Mode } from "@/mode";
import type { ArchivedDocs, ArchiveEntry } from "@/features/archive/types";
import type { WorkView } from "@/features/works/types";
import { invalidateSpecLayout, specLayoutReadQuery, specLayoutStatesQuery } from "./hooks";
import type { SpecLayoutRead, SpecLayoutState } from "./types";

// **레이아웃이 바뀌면 그것에서 나온 것이 모두 낡는다**(spec 레이아웃 결정 22, 구현 스펙 3절). 레이아웃
// 상태·읽기 쿼리, 그리고 spec 트리를 싣고 오는 work 목록과 아카이브 문서 목록이다. 넷 중 하나라도 빠지면
// 에이전트가 레이아웃을 고친 뒤 그 화면만 옛 트리나 옛 행을 든다 — 다시 읽기 전까지 「부탁이 안 먹었다」로
// 읽힌다.
//
// 훅을 렌더하지 않는다(이 저장소의 L2에는 DOM이 없다). 구독이 부르는 것은 아래 문 하나이고, 그 문이
// 무엇을 지우는지가 이 계약의 전부다. **훅이 짓는 키를 그대로 쓴다** — 손으로 같은 모양을 다시 지으면
// 진짜 키가 바뀌어도 이 파일이 초록이다(works 쪽 `specKey`와 같은 이유).

const docsKey = (mode: Mode) => archivedDocsQuery(mode, "치운-가").queryKey;

const RECORD_ONLY: ArchivedDocs = {
  docs: ["record.md"],
  specTree: { layoutId: "atelier", fallback: null, defaultDoc: null, items: [] },
};

const BROKEN_READ = (id: Mode): SpecLayoutRead => ({
  id,
  folder: `~/.atelier/layouts/${id}`,
  edited: true,
  errors: [{ path: null, message: "layout.json is missing" }],
  raw: null,
});

function seeded() {
  const client = new QueryClient();
  client.setQueryData(specLayoutStatesQuery().queryKey, [] as SpecLayoutState[]);
  for (const mode of ALL_MODES) {
    client.setQueryData(specLayoutReadQuery(mode).queryKey, BROKEN_READ(mode));
    client.setQueryData(worksQuery(mode).queryKey, [] as WorkView[]);
    client.setQueryData(archiveQuery(mode).queryKey, [] as ArchiveEntry[]);
    client.setQueryData(docsKey(mode), RECORD_ONLY);
  }
  return client;
}

const invalidated = (client: QueryClient, queryKey: readonly unknown[]) =>
  client.getQueryState(queryKey)?.isInvalidated;

describe("레이아웃이 바뀌었다고 알리는 문", () => {
  it("모드 둘의 레이아웃 상태를 지운다", () => {
    const client = seeded();
    void invalidateSpecLayout(client);
    expect(invalidated(client, specLayoutStatesQuery().queryKey)).toBe(true);
  });

  // 편집기(티켓 11)는 다시 읽힌 읽기로 밖 변경을 안다(티켓 15) — 되돌리거나 감시가 울렸는데 옛 읽기가
  // 남아 있으면 편집기가 지워진 폴더를 들고 선다. 두 모드의 것을 다 지운다.
  it("두 모드의 레이아웃 읽기를 지운다", () => {
    const client = seeded();
    void invalidateSpecLayout(client);
    for (const mode of ALL_MODES) {
      expect(invalidated(client, specLayoutReadQuery(mode).queryKey), `${mode} 레이아웃 읽기`).toBe(true);
    }
  });

  // spec 트리는 work 응답에 실려 온다(구현 스펙 3절) — 목록을 다시 읽어야 트리가 바뀐다. 두 세계를 다
  // 지우는 것은 모드마다 레이아웃이 따로라도 이벤트는 하나라서다: 어느 쪽 폴더가 바뀌었는지 모른다.
  it("두 세계의 work 목록을 지운다", () => {
    const client = seeded();
    void invalidateSpecLayout(client);
    for (const mode of ALL_MODES) {
      expect(invalidated(client, worksQuery(mode).queryKey), `${mode} work 목록`).toBe(true);
    }
  });

  it("두 세계의 아카이브 문서 목록을 지운다", () => {
    const client = seeded();
    void invalidateSpecLayout(client);
    for (const mode of ALL_MODES) {
      expect(invalidated(client, docsKey(mode)), `${mode} 아카이브 문서 목록`).toBe(true);
    }
  });

  // 되돌리기(티켓 10)와 편집기의 저장(티켓 11)도 이 문을 탄다 — mutation의 `onSuccess`가 이것을 돌려주면
  // 진행 표시가 다시 읽기가 끝날 때까지 선다(works 쪽 `invalidateWorks`의 머리말과 같은 계약).
  it("기다릴 수 있는 것을 돌려준다", async () => {
    await expect(invalidateSpecLayout(seeded())).resolves.toBeUndefined();
  });

  // work 목록과 아카이브는 **제 문을 지난다** — 이 파일이 그 키를 직접 지우면 옮기기가 떠 있을 때 미루는
  // 규칙(`invalidateWorks`)을 건너뛴다. 그 변형이 여기서 수를 늘려 빨개진다.
  it("이 파일에서 캐시를 지우는 자리가 하나다", () => {
    const source = readFileSync(fileURLToPath(new URL("./hooks.ts", import.meta.url)), "utf8");
    expect(source.split("invalidateQueries(").length - 1).toBe(1);
  });
});

// **`layouts:changed`를 듣는 자리는 앱 전역에 하나다**(구현 스펙 3절). 편집기(티켓 15)도 따로 듣지 않고,
// 이 구독이 다시 읽힌 읽기 쿼리로 밖 변경을 판정한다. 하나인 까닭 하나는 L3 하네스다 — 이벤트 쏘기는 그
// 이벤트의 **마지막** 구독 하나만 부르므로, 구독이 둘이면 L3가 한쪽만 깨워 다른 쪽을 잴 수 없다.
describe("layouts:changed 구독", () => {
  const src = fileURLToPath(new URL("../../", import.meta.url));
  const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(src, name), "utf8") }));

  it("그 이벤트를 듣는 자리가 앱 전체에 하나다", () => {
    const listens = sources.flatMap(({ name, text }) =>
      (text.match(/listen(?:<[^>]*>)?\(\s*["']layouts:changed["']/g) ?? []).map(() => name),
    );
    expect(listens).toEqual(["features/spec-layout/hooks.ts"]);
  });

  // 셸은 라우트 트리의 뿌리라 어느 화면에서든 한 번 떠 있다 — 설정 페이지에도, work 화면에도, 아카이브에도.
  // 화면마다 부르면 그 화면이 떠 있을 때만 들리고, 둘이 함께 뜨면 구독이 둘이 된다.
  it("구독하는 훅을 부르는 것은 셸 하나다", () => {
    const callers = sources
      .filter(({ text }) => /useFollowLayoutChanges\(\)/.test(text))
      .map(({ name }) => name)
      .filter((name) => name !== "features/spec-layout/hooks.ts");
    expect(callers).toEqual(["components/shell/AppShell.tsx"]);
  });
});
