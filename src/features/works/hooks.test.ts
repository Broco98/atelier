/// <reference types="node" />
// 소스 스캔 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { dialogStore } from "@/components/ui/confirm-store";
import { archivedFileQuery, archiveQuery } from "@/features/archive/hooks";
import {
  invalidateWorks,
  moveWorkOptions,
  readOtherWorldsWith,
  specFileQuery,
  worksQuery,
  type MoveWorkArgs,
} from "./hooks";
import { ALL_MODES } from "@/mode";
import type { Mode } from "@/mode";
import { queryClient } from "@/query-client";
import type { WorkView } from "./types";

// 캐시가 세계별로 갈렸다는 것과, 그것을 지우는 일이 **두 세계를 함께** 덮는다는 것.
// 둘은 반대 방향으로 틀릴 수 있어 함께 재야 한다 — 키를 안 가르면 Maison이 Atelier 목록을
// 읽고, 지우기를 모드까지 좁히면 저쪽 세계가 옛 목록을 든 채 남는다.
//
// 훅을 렌더하지 않는다(이 저장소의 L2에는 DOM이 없다). 훅이 부르는 것은 아래 문 하나이고,
// 그 문이 무엇을 지우는지가 이 계약의 전부다. 문이 하나뿐인 것은 맨 아래 스캔이 지킨다.

// 목록 아래에 사는 깊은 키. **훅이 짓는 것을 그대로 쓴다** — 손으로 같은 모양을 다시 지으면
// 이 파일은 자기가 적은 것을 자기가 확인하는 꼴이 되고, 진짜 키에서 `mode`가 빠져도 초록이다.
const specKey = (mode: Mode) => specFileQuery(mode, "가", "overview.md").queryKey;

function seeded() {
  const client = new QueryClient();
  for (const mode of ALL_MODES) {
    client.setQueryData(worksQuery(mode).queryKey, [] as WorkView[]);
    client.setQueryData(specKey(mode), "본문");
  }
  return client;
}

describe("works 캐시는 세계별로 갈린다", () => {
  it("한 세계에 심은 목록이 저쪽 세계로 새지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(worksQuery("atelier").queryKey, [] as WorkView[]);
    expect(client.getQueryData(worksQuery("maison").queryKey)).toBeUndefined();
  });

  // **목록만 가르면 반쪽이다.** 결정 10이 두 세계에 같은 이름을 허락하므로, 문서 키가 안
  // 갈리면 Atelier work `가`의 `record.md`와 Maison Room `가`의 그것이 같은 캐시 항목을
  // 맞는다 — 한 프레임 동안 남의 세계 본문이 그려지고, 화면으로는 「가끔 다른 문서가 떠
  // 있다」로만 보인다. 키에서 `mode`를 빼는 변형이 여기서 빨개진다.
  it("한 세계에 심은 문서 본문이 저쪽 세계로 새지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(specFileQuery("atelier", "겹친이름", "record.md").queryKey, "작업의 본문");
    expect(
      client.getQueryData(specFileQuery("maison", "겹친이름", "record.md").queryKey),
    ).toBeUndefined();
  });
});

describe("works:changed 무효화", () => {
  // 백엔드는 이벤트를 모드별로 나누지 않는다(#181) — 그래서 이 한 번이 두 세계를 다 덮어야
  // 한다. 키를 `["works", mode]`로 좁히는 변형은 여기서 빨개진다.
  it("두 세계의 목록을 다 지운다", () => {
    const client = seeded();
    invalidateWorks(client);
    for (const mode of ALL_MODES) {
      expect(
        client.getQueryState(worksQuery(mode).queryKey)?.isInvalidated,
        `${mode} 목록이 안 지워졌다`,
      ).toBe(true);
    }
  });

  // **돌려주는 promise도 계약이다.** react-query가 `onSuccess`의 반환을 `await`하므로, 이
  // 문이 promise를 삼키면(`void`) work을 지운 순간 진행 표시가 걷혀 **방금 지운 work이 화면에
  // 그대로 서 있는 창**이 생긴다 — 목록이 도착할 때까지. `.resolves`는 붙들 것이 없으면
  // 빨개지므로 그 변형이 여기서 걸린다.
  it("기다릴 수 있는 것을 돌려준다", async () => {
    await expect(invalidateWorks(seeded())).resolves.toBeUndefined();
  });

  it("목록 아래 걸린 것들도 함께 지운다", () => {
    const client = seeded();
    invalidateWorks(client);
    for (const mode of ALL_MODES) {
      expect(client.getQueryState(specKey(mode))?.isInvalidated, `${mode} spec 본문`).toBe(true);
    }
  });
});

// mutation은 렌더 없이 돌릴 수 없다 — 대신 **문이 하나뿐임**을 센다. 위 검사가 그 문의
// 행동을 재므로, 무효화가 전부 이 문을 타는 한 mutation도 두 세계를 지운다. 두 번째 문이
// 생기는 순간(어느 mutation이 자기 키로 좁혀 지우는 순간) 이 수가 늘어 빨개진다.
//
// 세는 것이 파싱이 아니라 리터럴의 **개수**라 파서가 샐 자리가 없다.
describe("무효화하는 문", () => {
  it("이 파일에서 캐시를 지우는 자리가 하나다", () => {
    const source = readFileSync(fileURLToPath(new URL("./hooks.ts", import.meta.url)), "utf8");
    expect(source.split("invalidateQueries(").length - 1).toBe(1);
  });
});

// **`works:changed`를 듣는 자리는 앱 루트 하나다**(프로세스 결정 18 ① · 티켓 14). 목록을 쓰는 훅이 저마다 들으면
// 부르는 자리(사이드바 · 사이드바 work 목록 · works 라우트 · 작업 화면 · 프로젝트 상세 · 아카이브 둘)마다 구독이 붙어,
// 이벤트 한 번에 목록 조회가 그 수만큼 돈다 — 워크트리 21개면 `git status` 84번이다. L3가 화면 셋에서 살아 있는 구독 수를
// 재지만 화면은 더 있다. 그래서 여기서는 **소스 전체**를 훑는다: 구독이 서는 파일이 앱 셸 하나여야 한다.
//
// 아카이브 목록도 같은 문을 탄다 — 아카이브 무효화를 부르는 자리가 그 문 하나여야 합치기를 함께 받는다(아래 「합치기 문」).
const src = fileURLToPath(new URL("../..", import.meta.url));

/** 화면 소스(테스트 파일을 뺀 `src`의 `.ts` · `.tsx`)마다 `pattern`이 몇 번 서는가. 0인 파일은 안 싣는다. */
function occurrences(pattern: RegExp): Record<string, number> {
  const names = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
  );
  // 훑기가 무너지면 아래 검사가 빈 표를 통과시킬 뻔한다 — 여기서 먼저 선다.
  expect(names.length, "src에서 소스 파일을 하나도 찾지 못했다").toBeGreaterThan(0);
  const found: Record<string, number> = {};
  for (const name of names) {
    const count = [...readFileSync(join(src, name), "utf8").matchAll(pattern)].length;
    if (count > 0) found[name.split("\\").join("/")] = count;
  }
  return found;
}

describe("works:changed를 듣는 자리", () => {
  it("앱 셸 한 곳에서 한 번 듣고, 그 구독이 무효화 문을 부른다", () => {
    expect(occurrences(/listen(?:<[^>]*>)?\(\s*"works:changed"/g)).toEqual({
      "components/shell/AppShell.tsx": 1,
    });
    const shell = readFileSync(join(src, "components/shell/AppShell.tsx"), "utf8");
    expect(shell).toMatch(/listen\("works:changed", \(\) => \{\s*void invalidateWorks\(queryClient\);/);
  });

  it("아카이브 무효화를 부르는 자리가 목록 무효화 문 하나다", () => {
    expect(occurrences(/(?<!function )invalidateArchive\(/g)).toEqual({ "features/works/hooks.ts": 1 });
  });
});

// **옮기기와 `works:changed`의 경쟁**(UI개선 스펙 §5 · S9). 순서만 바뀐 쓰기는 감시자가 안 쏘므로
// 화면은 옮기기의 **응답**으로 캐시를 갈아 끼운다. 그런데 옮기는 사이 다른 이유(spec 쓰기 ·
// `work.json`의 `pinned` 쓰기)로 온 무효화가 재조회를 띄우면, 쓰기 **전** 파일을 읽은 느린 답
// (워크트리마다 상태를 묻는다)이 응답 **뒤에** 도착해 옛 순서로 덮는다 — 그리고 감시자가 다시 안
// 쏘므로 그 옛 순서가 `staleTime` 동안 남는다.
//
// 훅을 렌더하지 않는다 — 옵션과 이벤트 처리를 훅 밖 함수로 두고 **실물 `QueryClient`**에 그대로
// 물린다(선례: `features/search/hooks.test.ts`). 답은 손으로 붙든다: 순서를 뒤집을 수 없으면
// 경쟁을 재는 검사가 늘 초록이다.
const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{
    command: string;
    /** 그 호출의 인자 — 목록 조회가 어느 세계를 물었는지를 본다. */
    args: unknown;
    /** 이 호출이 나갔을 때 옮기기가 아직 답을 못 받았는가 — 쓰기 전 파일을 읽은 재조회다. */
    beforeMoveAnswered: boolean;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    answered: boolean;
  }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) =>
    new Promise((resolve, reject) => {
      const moveAnswered = calls.some((call) => call.command === "move_work" && call.answered);
      calls.push({ command, args, beforeMoveAnswered: !moveAnswered, resolve, reject, answered: false });
    }),
}));

const settle = () => new Promise((done) => setTimeout(done, 0));

const row = (slug: string) => ({ slug, title: slug, status: "active", pinned: false }) as WorkView;
/** 옮기기 전 목록과, `c`를 맨 앞으로 옮긴 뒤 코어가 돌려줄 목록. */
const OLD = [row("a"), row("b"), row("c")];
const NEW = [row("c"), row("a"), row("b")];
const slugsOf = (works: unknown) =>
  (works as WorkView[] | undefined)?.map((work) => work.slug).join("") ?? "";

type Call = (typeof calls)[number];

/** 아직 답을 못 받은 그 명령 호출들. */
const waiting = (command: string, pick: (call: Call) => boolean = () => true) =>
  calls.filter((call) => call.command === command && !call.answered && pick(call));

function answer(command: string, value: unknown, pick?: (call: Call) => boolean) {
  const found = waiting(command, pick);
  for (const call of found) {
    call.answered = true;
    call.resolve(value);
  }
  return found.length;
}

/** 목록 화면 하나를 세우고 첫 목록을 받는다. */
async function listed() {
  calls.length = 0;
  const client = new QueryClient();
  const observer = new QueryObserver(client, worksQuery("atelier"));
  const seen: string[] = [];
  observer.subscribe((result) => seen.push(slugsOf(result.data)));
  await settle();
  expect(answer("list_works", OLD)).toBe(1);
  await settle();
  return { client, seen, shown: () => slugsOf(client.getQueryData(worksQuery("atelier").queryKey)) };
}

/** 기본은 `c`를 맨 앞으로(→ `NEW`). 겹친 옮기기 검사는 둘째 것을 따로 준다. */
function move(client: QueryClient, args: MoveWorkArgs = { slug: "c", pinned: false, before: "a" }) {
  const observer = new MutationObserver(client, moveWorkOptions(client, "atelier"));
  // 실패는 옵션의 `onError`가 다룬다 — 여기서 삼키는 것은 러너의 미처리 거절뿐이다.
  void observer.mutate(args).catch(() => {});
}

/** 그 명령의 **가장 먼저 나간** 대기 호출 하나만 거절한다. */
function rejectFirst(command: string, error: unknown) {
  const [call] = waiting(command);
  call.answered = true;
  call.reject(error);
}

/** 그 명령의 대기 호출 중 `index`번째 하나만 답한다 — 겹친 옮기기의 답 순서를 뒤집는 손잡이. */
function answerNth(command: string, index: number, value: unknown) {
  const call = waiting(command)[index];
  call.answered = true;
  call.resolve(value);
}

describe("옮기기와 works:changed의 경쟁", () => {
  it("놓는 순간 낙관적으로 선다", async () => {
    const { client, shown } = await listed();
    move(client);
    await settle();
    expect(shown()).toBe("cab");
    expect(waiting("move_work")).toHaveLength(1);
  });

  it("진행 중 들어온 무효화가 응답 뒤에 옛 목록으로 덮지 않는다", async () => {
    const { client, seen, shown } = await listed();
    move(client);
    await settle();
    void invalidateWorks(client);
    await settle();

    // 응답이 먼저, 쓰기 전 파일을 읽은 재조회의 답이 나중에 온다.
    answer("move_work", NEW);
    await settle();
    answer("list_works", OLD, (call) => call.beforeMoveAnswered);
    await settle();
    // 끝난 뒤에 나간 재조회는 새 파일을 읽는다.
    answer("list_works", NEW);
    await settle();

    expect(shown()).toBe("cab");
    // 마지막 값만 보면 덮었다가 되돌아온 것도 초록이다 — 낙관적 목록이 선 뒤로 옛 목록이 한 번도
    // 다시 서면 안 된다.
    expect(seen.slice(seen.indexOf("cab"))).not.toContain("abc");
  });

  // 부르는 쪽이 이벤트든 mutation의 `onSuccess`(고정 토글·제목)든 같은 문이라 이 한 검사가 둘을 덮는다 —
  // 문이 하나뿐인 것은 위 「무효화하는 문」의 개수 검사가 지킨다.
  it("미룬 무효화는 끝난 뒤 한 번 돈다", async () => {
    const { client } = await listed();
    move(client);
    await settle();
    void invalidateWorks(client);
    void invalidateWorks(client);
    void invalidateWorks(client);
    await settle();
    expect(waiting("list_works")).toHaveLength(0);

    answer("move_work", NEW);
    await settle();
    await settle();
    expect(waiting("list_works")).toHaveLength(1);
  });

  // `onSettled` 무효화를 두지 않는다(티켓 05) — 응답이 곧 새 목록이라 다시 물을 것이 없다.
  it("아무것도 안 왔으면 끝난 뒤에도 다시 묻지 않는다", async () => {
    const { client, shown } = await listed();
    move(client);
    await settle();
    answer("move_work", NEW);
    await settle();
    await settle();
    expect(waiting("list_works")).toHaveLength(0);
    expect(shown()).toBe("cab");
  });

  it("옮기기 전에 떠 있던 재조회도 낙관적 목록을 덮지 않는다", async () => {
    const { client, shown } = await listed();
    void invalidateWorks(client);
    await settle();
    expect(waiting("list_works")).toHaveLength(1);

    move(client);
    await settle();
    answer("list_works", OLD);
    await settle();
    expect(shown()).toBe("cab");
  });

  it("옮기기가 끝나면 무효화는 다시 곧바로 돈다", async () => {
    const { client } = await listed();
    move(client);
    await settle();
    answer("move_work", NEW);
    await settle();
    await settle();

    void invalidateWorks(client);
    await settle();
    expect(waiting("list_works")).toHaveLength(1);
  });

  it("실패하면 원래 목록으로 돌아가고 오류를 알린다", async () => {
    const { client, shown } = await listed();
    move(client);
    await settle();
    expect(shown()).toBe("cab");

    for (const call of waiting("move_work")) {
      call.answered = true;
      call.reject("slug가 없습니다");
    }
    await settle();
    await settle();

    expect(shown()).toBe("abc");
    expect(dialogStore.state?.title).toBe("오류");
    expect(dialogStore.state?.body).toContain("slug가 없습니다");
    dialogStore.state?.answer(true);
    // **되돌린 목록이 디스크와 같다고 믿지 않는다.** 코어는 `work.json` 쓰기가 실패해도 순서 파일을 안
    // 되돌리고(스펙 §2), 그 점 파일은 감시자가 안 쏜다 — 다시 읽기를 한 번 띄워야 화면이 디스크를 따른다.
    expect(waiting("list_works")).toHaveLength(1);
  });
});

// **옮기기가 겹치면**(첫 응답이 오기 전에 둘째를 놓았다) 어느 응답도 믿지 않는다. 응답은 그 호출이
// 순서 파일을 읽은 순간의 목록이라 뒤에 놓은 옮기기가 빠져 있을 수 있고, 답이 어느 순서로 올지도
// 모른다(명령이 비동기다). 낙관적 목록을 둔 채 마지막이 끝난 뒤 한 번 다시 읽는다.
describe("겹친 옮기기", () => {
  /** 둘째 옮기기: `b`를 `c` 앞으로 — 첫 옮기기의 낙관적 목록 `cab` 위에서 `bca`. */
  const SECOND: MoveWorkArgs = { slug: "b", pinned: false, before: "c" };

  async function twoMoves() {
    const listing = await listed();
    move(listing.client);
    await settle();
    move(listing.client, SECOND);
    await settle();
    expect(listing.shown()).toBe("bca");
    expect(waiting("move_work")).toHaveLength(2);
    return listing;
  }

  it("첫 응답이 둘째 옮기기의 낙관적 목록을 덮지 않는다", async () => {
    const { shown, seen } = await twoMoves();
    // 첫 호출은 둘째가 쓰기 전에 파일을 읽었다 — 그 응답에는 `b`의 옮김이 없다.
    answerNth("move_work", 0, NEW);
    await settle();
    await settle();
    expect(shown()).toBe("bca");
    expect(seen.slice(seen.indexOf("bca"))).not.toContain("cab");

    answerNth("move_work", 0, [row("b"), row("c"), row("a")]);
    await settle();
    await settle();
    expect(shown()).toBe("bca");
    expect(waiting("list_works")).toHaveLength(1);
  });

  it("답이 거꾸로 와도 낡은 첫 응답이 마지막에 서지 않는다", async () => {
    const { shown } = await twoMoves();
    answerNth("move_work", 1, [row("b"), row("c"), row("a")]);
    await settle();
    answerNth("move_work", 0, NEW);
    await settle();
    await settle();
    expect(shown()).toBe("bca");
    expect(waiting("list_works")).toHaveLength(1);
  });

  it("첫 옮기기가 실패해도 둘째의 낙관적 목록을 되돌리지 않는다", async () => {
    const { shown } = await twoMoves();
    rejectFirst("move_work", "쓰지 못했습니다");
    await settle();
    await settle();
    expect(shown()).toBe("bca");
    dialogStore.state?.answer(true);
  });
});

// 티켓 12 · 프로세스 스펙 S13. **MCP로 아카이브된 work은 목록 재조회로만 안다** — 그런데 목록 쿼리는 관찰자가 있는 것만
// 다시 부르고, 앱 루트가 관찰하는 것은 지금 세계 하나다. 저쪽 세계에 셸이 있으면 그 목록도 **같은 무효화 문 안에서**
// 함께 읽어야 그 세계의 주인 잃은 셸이 보인다. 따로 부르는 자리를 만들면 무효화 문이 둘이 된다(위 「무효화하는 문」).
//
// 누가 저쪽 세계를 읽을지는 문이 모른다 — 셸을 아는 쪽(앱 루트의 `ShellOwners`)이 **고르는 함수**를 걸어 두고, 문은
// 무효화할 때마다 그 함수를 부른다. 걸 때가 아니라 부를 때 고르는 것이 요점이다: 셸은 그사이 열리고 닫힌다.
describe("저쪽 세계를 함께 읽는 문", () => {
  /** 지금 세계(Atelier) 목록을 관찰하는 화면 하나와, 한 번 읽어 둔 저쪽 세계(Maison) 목록. */
  async function twoWorlds() {
    const { client } = await listed();
    client.setQueryData(worksQuery("maison").queryKey, [] as WorkView[]);
    calls.length = 0;
    return client;
  }
  /** 지금까지 나간 목록 조회가 물은 세계들. */
  const listedWorlds = () =>
    calls.filter((call) => call.command === "list_works").map((call) => (call.args as { mode: Mode }).mode);

  it("고르는 함수가 없으면 관찰되는 지금 세계만 다시 읽는다", async () => {
    const client = await twoWorlds();
    void invalidateWorks(client);
    await settle();
    expect(listedWorlds()).toEqual(["atelier"]);
  });

  it("저쪽 세계를 고르면 같은 무효화에서 그 세계도 읽는다 — 이벤트 한 번에 조회 둘", async () => {
    const client = await twoWorlds();
    const release = readOtherWorldsWith(client, () => ["maison"]);
    try {
      void invalidateWorks(client);
      await settle();
      expect(listedWorlds().sort()).toEqual(["atelier", "maison"]);
    } finally {
      release();
    }
  });

  it("고르는 것은 무효화할 때다 — 걸어 둔 뒤 바뀐 답을 따른다", async () => {
    const client = await twoWorlds();
    let worlds: Mode[] = [];
    const release = readOtherWorldsWith(client, () => worlds);
    try {
      void invalidateWorks(client);
      await settle();
      expect(listedWorlds()).toEqual(["atelier"]);

      answer("list_works", OLD);
      calls.length = 0;
      worlds = ["maison"];
      void invalidateWorks(client);
      await settle();
      expect(listedWorlds().sort()).toEqual(["atelier", "maison"]);
    } finally {
      release();
    }
  });

  // 루트가 내려가면(StrictMode의 두 번 돌기 · 세계를 건넘) 건 것을 푼다. 뒤에 건 것을 앞의 풀기가 지우면 저쪽 세계를
  // 영영 안 읽는다 — 풀기는 제가 건 것만 푼다.
  it("풀면 다시 지금 세계만 읽고, 앞의 풀기가 뒤에 건 것을 지우지 않는다", async () => {
    const client = await twoWorlds();
    const first = readOtherWorldsWith(client, () => ["maison"]);
    const second = readOtherWorldsWith(client, () => ["maison"]);
    first();
    void invalidateWorks(client);
    await settle();
    expect(listedWorlds().sort()).toEqual(["atelier", "maison"]);

    answer("list_works", OLD);
    calls.length = 0;
    second();
    void invalidateWorks(client);
    await settle();
    expect(listedWorlds()).toEqual(["atelier"]);
  });

  // 문이 기다리게 하는 것은 **지금 세계의** 재조회다 — 삭제의 진행 표시가 그것을 기다린다. 저쪽 세계는 이 화면의 목록이
  // 아니라 그 답까지 기다리게 하지 않는다.
  it("돌려주는 promise는 저쪽 세계의 답을 안 기다린다", async () => {
    const client = await twoWorlds();
    const release = readOtherWorldsWith(client, () => ["maison"]);
    try {
      let done = false;
      void invalidateWorks(client).then(() => (done = true));
      await settle();
      answer("list_works", OLD, (call) => (call.args as { mode: Mode }).mode === "atelier");
      await settle();
      expect(done).toBe(true);
    } finally {
      release();
    }
  });

  // **도는 조회에 합류하면 아카이브 전 목록이 앉는다**(티켓 12 리뷰). 저쪽 세계 쿼리는 관찰자가 없어, 무효화가 도는 조회를
  // 끊지 않고 `prefetchQuery`는 새로 안 부르고 거기 합류한다. 그러면 첫 이벤트(spec 쓰기)의 느린 조회가 MCP 아카이브 **전에**
  // 읽은 목록 — 그 work이 든 — 을 성공으로 앉히고, 그 세계를 다시 읽을 까닭이 사라진다(다음 이벤트까지 주인 잃은 셸을 못 본다).
  // 재는 것은 결과다: 둘째 무효화 **뒤에** 나간 조회가 있고, 마지막에 앉은 목록이 그 조회의 답이다. 끊고 다시 부르든 끝난 뒤
  // 한 번 더 부르든 초록이다 — 둘째 무효화 뒤에 나간 조회가 없으면 빨갛다.
  //
  // 둘째 무효화 앞의 조회는 **두 세계 모두** 답한다. 합치기 문(티켓 14)은 도는 조회가 모두 끝난 뒤에 한 번 더 읽으므로,
  // 지금 세계의 조회가 남아 있으면 뒤따르는 한 번이 아직 안 나간다 — 그것은 이 검사가 재는 경쟁이 아니다.
  const isMaison = (call: Call) => (call.args as { mode: Mode }).mode === "maison";
  /** 아카이브 전(`x`가 있다)과 뒤(`x`가 없다)의 Maison 목록. */
  const BEFORE_ARCHIVE = [row("a"), row("x")];
  const AFTER_ARCHIVE = [row("a")];

  async function archivedWhileReading(client: QueryClient) {
    const release = readOtherWorldsWith(client, () => ["maison"]);
    try {
      void invalidateWorks(client);
      await settle();
      expect(waiting("list_works", isMaison), "첫 무효화가 저쪽 세계를 읽는다").toHaveLength(1);

      const mark = calls.length;
      const afterMark = (call: Call) => isMaison(call) && calls.indexOf(call) >= mark;
      void invalidateWorks(client);
      await settle();
      answer("list_works", BEFORE_ARCHIVE, (call) => isMaison(call) && calls.indexOf(call) < mark);
      answer("list_works", OLD, (call) => !isMaison(call) && calls.indexOf(call) < mark);
      await settle();

      expect(waiting("list_works", afterMark), "둘째 무효화 뒤에 저쪽 세계를 다시 읽지 않았다").toHaveLength(1);
      answer("list_works", AFTER_ARCHIVE, afterMark);
      await settle();
      expect(slugsOf(client.getQueryData(worksQuery("maison").queryKey))).toBe("a");
    } finally {
      release();
    }
  }

  it("저쪽 세계 조회가 도는 중에 다시 무효화하면, 그 뒤에 나간 조회의 답이 앉는다", async () => {
    await archivedWhileReading(await twoWorlds());
  });

  // 저쪽 세계 목록은 관찰자가 없어 5분 조용하면 캐시에서 빠진다 — 긴 코드 작업 끝에 claude가 spec을 쓰고 곧 아카이브하는 흔한
  // 순서에서 첫 조회는 **값 없는** 조회다. react-query는 값 없는 조회를 안 끊으므로(`cancelRefetch`도 합류한다) 이 경우를 따로 잰다.
  it("캐시에서 빠진 뒤의 첫 조회가 도는 중이어도 같다", async () => {
    const { client } = await listed();
    expect(client.getQueryState(worksQuery("maison").queryKey)).toBeUndefined();
    calls.length = 0;
    await archivedWhileReading(client);
  });
});

// **합치기 문**(프로세스 스펙 판 02 ① · S20 · 티켓 14). 에이전트가 spec을 쉬지 않고 쓰면 `works:changed`가 조회보다
// 자주 온다. 그때마다 도는 조회를 버리고 새로 부르면 코어는 버려진 조회까지 다 돈다(IPC는 취소되지 않는다). 그래서
// 조회 중에 온 무효화는 **표시만** 하고, 도는 조회가 끝나면 **한 번 더** 읽는다.
//
// 표시만 한 쪽이 받는 promise는 **뒤따르는 한 번**의 것이다. 도는 조회의 것을 주면 삭제의 진행 표시가 쓰기 **전**
// 파일을 읽었을 수 있는 조회에서 걷혀, 방금 지운 work이 브레드크럼과 본문에 잠깐 다시 선다(스토리 52 · `invalidateWorks`
// 머리말의 계약).
describe("합치기 문 — 조회 중에 온 무효화는 표시만 하고 끝난 뒤 한 번 더", () => {
  const listCalls = () => calls.filter((call) => call.command === "list_works");

  it("조회 중에 무효화가 N번 오면, 도는 조회를 버리지 않고 끝난 뒤 한 번만 더 돈다", async () => {
    const { client, shown } = await listed();
    void invalidateWorks(client);
    await settle();
    expect(waiting("list_works")).toHaveLength(1);

    for (let n = 0; n < 3; n += 1) void invalidateWorks(client);
    await settle();
    expect(waiting("list_works"), "도는 조회를 버리고 새로 불렀다").toHaveLength(1);

    answer("list_works", OLD);
    await settle();
    expect(waiting("list_works"), "끝난 뒤 한 번 더 읽지 않았다").toHaveLength(1);
    answer("list_works", NEW);
    await settle();
    expect(shown()).toBe("cab");
    // 첫 목록 · 도는 조회 · 뒤따르는 한 번 — 그 뒤로는 멎는다.
    expect(listCalls()).toHaveLength(3);
    expect(waiting("list_works")).toHaveLength(0);
  });

  it("표시만 한 쪽의 promise는 뒤따르는 조회가 끝난 뒤에 풀린다 — 도는 조회가 끝났을 때가 아니다", async () => {
    const { client } = await listed();
    const done = { running: false, marked: false };
    void invalidateWorks(client).then(() => (done.running = true));
    await settle();

    const marked = invalidateWorks(client);
    const alsoMarked = invalidateWorks(client);
    void marked.then(() => (done.marked = true));

    answer("list_works", OLD);
    await settle();
    expect(done.running, "도는 조회를 부른 쪽은 그 조회가 끝나면 풀린다").toBe(true);
    expect(done.marked, "표시만 한 쪽이 쓰기 전 파일을 읽었을 수 있는 조회에서 풀렸다").toBe(false);

    answer("list_works", NEW);
    await settle();
    expect(done.marked).toBe(true);
    // 같은 회차에 온 무효화는 뒤따르는 한 번의 promise 하나를 나눠 갖는다.
    expect(alsoMarked).toBe(marked);
  });

  // 도는 조회가 이 문이 띄운 것이 아니어도 같다 — 화면이 처음 선 순간의 조회(값이 없어 react-query가 `cancelRefetch`로도 안
  // 끊는다)에 합류하면, 그 답이 쓰기 전 목록이어도 무효 표시가 걷히고 promise가 풀린다.
  it("화면이 처음 부른 조회가 도는 중이어도 거기 합류하지 않고 끝난 뒤 한 번 더 읽는다", async () => {
    calls.length = 0;
    const client = new QueryClient();
    new QueryObserver(client, worksQuery("atelier")).subscribe(() => {});
    await settle();
    expect(waiting("list_works")).toHaveLength(1);

    let done = false;
    void invalidateWorks(client).then(() => (done = true));
    await settle();
    answer("list_works", OLD);
    await settle();
    expect(done).toBe(false);
    expect(waiting("list_works"), "처음 부른 조회에 합류하고 다시 안 읽었다").toHaveLength(1);

    answer("list_works", NEW);
    await settle();
    expect(done).toBe(true);
    expect(slugsOf(client.getQueryData(worksQuery("atelier").queryKey))).toBe("cab");
  });

  // 옮기기는 도는 목록 조회를 끊고(`moveWorkOptions`의 1) 그동안 온 무효화를 끝난 뒤로 미룬다(S9). 표시해 둔 한 번이
  // 옮기기 도중에 풀려 나가면 쓰기 전 순서 파일을 읽고, 끝난 뒤의 미룬 한 번과 함께 두 번이 된다.
  it("옮기기 중 미룸과 겹쳐도 뒤따르는 조회는 한 번이고, 옮기기가 끝난 뒤에 나간다", async () => {
    const { client, shown } = await listed();
    void invalidateWorks(client);
    await settle();
    void invalidateWorks(client);
    const moveStart = calls.length;
    move(client);
    await settle();
    void invalidateWorks(client);
    await settle();
    expect(listCalls().filter((call) => calls.indexOf(call) >= moveStart), "옮기기 도중에 목록을 읽었다").toHaveLength(0);

    answer("move_work", NEW);
    await settle();
    await settle();
    const after = listCalls().filter((call) => calls.indexOf(call) >= moveStart);
    expect(after).toHaveLength(1);
    expect(after[0].beforeMoveAnswered).toBe(false);
    answer("list_works", NEW, (call) => calls.indexOf(call) >= moveStart);
    await settle();
    expect(shown()).toBe("cab");
    expect(waiting("list_works", (call) => calls.indexOf(call) >= moveStart)).toHaveLength(0);
  });

  // **아카이브 목록도 같은 문을 탄다**(스펙 판 02 ①의 아카이브 줄). 아카이브 폴더는 감시하지 않지만 아카이빙은 언제나
  // works/에서 하나가 사라지는 일이라 `works:changed`가 함께 온다 — 그 한 번에 아카이브 목록도 한 번이고 합치기를 받는다.
  it("아카이브 목록도 이 문으로 다시 읽고, 조회 중에 온 무효화는 끝난 뒤 한 번으로 합친다", async () => {
    calls.length = 0;
    const client = new QueryClient();
    new QueryObserver(client, archiveQuery("atelier")).subscribe(() => {});
    await settle();
    expect(answer("list_archive", [])).toBe(1);
    await settle();

    void invalidateWorks(client);
    await settle();
    expect(waiting("list_archive"), "목록 무효화 문이 아카이브를 안 읽었다").toHaveLength(1);
    void invalidateWorks(client);
    void invalidateWorks(client);
    await settle();
    expect(waiting("list_archive")).toHaveLength(1);

    answer("list_archive", []);
    await settle();
    expect(waiting("list_archive")).toHaveLength(1);
    answer("list_archive", []);
    await settle();
    expect(waiting("list_archive")).toHaveLength(0);
  });

  // **「조회 중」은 목록 조회만 센다**(티켓 14 리뷰). spec 본문과 아카이브 문서도 이 문으로 다시 읽지만 문을 잡지 않는다.
  // 웹뷰의 react-query는 실패한 조회를 세 번 더 시도하고(1 · 2 · 4초 쉼) 그동안 내내 「도는 중」이다. 읽을 수 없는 문서
  // (spec/의 `ref.pdf` — 코어의 `read_to_string`이 UTF-8이 아니라 매번 실패한다)를 띄워 두면 그것이 문을 잡아, 이벤트마다
  // 목록 다시 읽기가 7초씩 밀리고 표시한 쪽(상태 · 제목 · 고정 · 삭제의 진행 표시)은 14초를 섰다.
  const docs = [
    { name: "spec 본문이", doc: specFileQuery("atelier", "가", "ref.pdf"), command: "read_spec_file" },
    { name: "아카이브 문서가", doc: archivedFileQuery("atelier", "치운-가", "ref.pdf"), command: "read_archived_file" },
  ];
  for (const { name, doc, command } of docs) {
    it(`실패해 다시 시도하는 ${name} 목록 다시 읽기를 붙잡지 않는다`, async () => {
      calls.length = 0;
      // 웹뷰의 기본값을 세운다 — Node에서는 react-query가 서버로 보고 다시 시도하지 않는다(query-core `retryer`의 `isServer`).
      const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
      // 쉬는 중인 다시 시도를 거둔다 — 남기면 1초 뒤 다음 검사의 기록에 그 부름이 선다. 빨간 판에서도 거두도록 끝에 건다.
      onTestFinished(() => client.cancelQueries());
      new QueryObserver(client, worksQuery("atelier")).subscribe(() => {});
      new QueryObserver(client, doc).subscribe(() => {});
      await settle();
      expect(answer("list_works", OLD)).toBe(1);
      // 문서는 한 번 읽힌 뒤, 다시 읽다(창으로 돌아올 때의 재조회처럼) 실패한다. **값이 있어야** 맨 끝 단언이 `cancelRefetch`를
      // 가른다 — 값 없는 조회는 react-query가 `cancelRefetch: true`로도 안 끊고 합류한다(query-core `query.js`의 `fetch`).
      expect(answer(command, "본문")).toBe(1);
      await settle();
      void client.refetchQueries({ queryKey: doc.queryKey, exact: true });
      await settle();
      rejectFirst(command, "stream did not contain valid UTF-8");
      await settle();
      // 앵커: 쉬는 동안에도 그 문서는 「도는 중」이다 — 아니면 아래가 옛 판정에서도 초록이다. 값을 든 채다.
      expect(client.getQueryState(doc.queryKey)).toMatchObject({
        fetchStatus: "fetching",
        fetchFailureCount: 1,
        data: "본문",
      });

      void invalidateWorks(client);
      await settle();
      expect(waiting("list_works"), "다시 시도하는 문서가 목록 다시 읽기를 붙잡았다").toHaveLength(1);

      // 목록이 도는 중에 온 것은 표시만 하고, 그 목록이 끝나면 곧바로 한 번 더 — 문서의 다시 시도를 안 기다린다.
      void invalidateWorks(client);
      answer("list_works", OLD);
      await settle();
      expect(waiting("list_works"), "뒤따르는 한 번이 문서의 다시 시도를 기다렸다").toHaveLength(1);
      answer("list_works", NEW);
      await settle();
      expect(slugsOf(client.getQueryData(worksQuery("atelier").queryKey))).toBe("cab");
      // 문서는 도는 시도를 버리지 않는다(`cancelRefetch: false`) — 쉬는 중이라 새로 나간 부름이 없다. 끊으면(`true`) 값이 있는
      // 조회라 도는 시도를 버리고 곧바로 새로 부른다.
      expect(waiting(command), "도는 문서 읽기를 버리고 새로 불렀다").toHaveLength(0);
      expect(client.getQueryState(doc.queryKey)?.fetchFailureCount, "도는 시도가 끊기고 새 시도가 섰다").toBe(1);
    });
  }
});

// **work 목록은 창으로 돌아올 때 다시 읽지 않는다**(프로세스 결정 18 ①). 변화는 감시자가 이미 알린다 — 창을 오갈 때마다
// 워크트리마다 `git status`를 돌 까닭이 없다. 다른 쿼리의 기본값은 그대로다.
//
// **이것을 L3에 두지 않는다.** TanStack v5는 창 `focus`가 아니라 `visibilitychange`만 듣고(`focusManager`), 그마저
// `staleTime` 30초 안이면 다시 부르지 않는다. 그래서 창 포커스를 쏘는 L3는 이 옵션과 상관없이 초록이다(스펙 리뷰 코드 8).
// 값으로 잰다.
describe("창 포커스 재조회", () => {
  it("work 목록 쿼리는 두 세계 모두 끈다", () => {
    for (const mode of ALL_MODES) expect(worksQuery(mode).refetchOnWindowFocus, mode).toBe(false);
  });

  // 「기본값 그대로」는 쿼리 옵션만 봐서는 못 잰다 — 앱 캐시(`query-client.ts`)의 기본 옵션에서 끄면 모든 쿼리가 꺼지는데
  // 쿼리 옵션은 여전히 비어 있다. 그래서 **앱 캐시가 합친 값**(`defaultQueryOptions` — 캐시의 기본 옵션 · 키별 기본값 · 쿼리
  // 옵션 순)으로 잰다. 비어 있으면 react-query는 다시 읽는다(`false`만 끈다).
  it("다른 쿼리는 기본값 그대로다 — 앱 캐시의 기본 옵션까지 합친 값으로", () => {
    expect(queryClient.defaultQueryOptions(specFileQuery("atelier", "가", "overview.md")).refetchOnWindowFocus).not.toBe(false);
    expect(queryClient.defaultQueryOptions(archiveQuery("atelier")).refetchOnWindowFocus).not.toBe(false);
    // 앵커: 합친 값이 쿼리 옵션을 싣는다 — 안 싣으면 위 둘이 저절로 참이다.
    for (const mode of ALL_MODES) {
      expect(queryClient.defaultQueryOptions(worksQuery(mode)).refetchOnWindowFocus, mode).toBe(false);
    }
  });
});
