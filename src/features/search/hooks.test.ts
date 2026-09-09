import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Mode } from "@/mode";
import { searchQuery } from "./hooks";
import type { SearchResults } from "./types";

// **디바운스를 안 두는 대신 늦게 온 답을 버린다**(결정 29). 막아야 할 것은 비용이 아니라
// 순서 뒤바뀜이다 — 그만큼 싼 일에 지연을 얹으면 「치는 동안 즉시 따라온다」를 스스로 깨는
// 것이다. 얼마나 싼지는 코어 주석 한 자리에 있다(`search.rs`의 `search`).
//
// 그 규칙은 훅이 아니라 **옵션**이 든다(질의가 queryKey에 실린다). 이 저장소의 L2에는 DOM이
// 없어 훅을 렌더할 수 없지만, 옵션을 `QueryObserver`에 그대로 물리면 화면이 보는 것과 같은
// 것을 잰다 — `useQuery`가 하는 일이 그 관찰자를 다는 것이다.
//
// 답을 **손으로 붙잡는다.** 순서를 뒤집을 수 없으면 이 검사는 늘 초록이고 아무것도 안 잰다.
const { pending, asked, askedMode } = vi.hoisted(() => ({
  pending: new Map<string, (results: unknown) => void>(),
  /** 그 질의와 **함께 나간 목적지**. key만 적는다 — 재는 것은 「어느 세계의 목록인가」다. */
  asked: new Map<string, string[]>(),
  /**
   * 그 질의가 **어느 세계를 싣고 나갔는가**. 목적지와 따로 적는 것은 **둘이 따로 눕기**
   * 때문이다 — `run(mode, …)`의 첫 인자만 리터럴로 눕히는 변형은 목적지를 안 건드리므로 위
   * `asked`가 갈린 채 그대로고, 키에는 `mode`가 남아 있어 「세계를 건널 때」도 초록이다.
   * 그때 Maison에서 누른 ⇧⇧가 Atelier의 works·아카이브를 뒤진다 — 리터럴로 누운 값도 멀쩡한
   * 인자라 백엔드도 안 나무란다(#187이 닫은 것은 빠뜨린 호출이지 틀린 값이 아니다).
   */
  askedMode: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (
    _command: string,
    args: { mode: string; query: string; destinations: { key: string }[] },
  ) =>
    new Promise((resolve) => {
      pending.set(args.query, resolve);
      asked.set(
        args.query,
        args.destinations.map((place) => place.key),
      );
      askedMode.set(args.query, args.mode);
    }),
}));

const results = (path: string): SearchResults => ({
  hits: [{ kind: "doc", slug: "가", title: "가 작업", path, archived: false }],
});

/** 붙잡아 둔 답을 놓아 주고 자리가 잡히기를 기다린다. */
async function answer(query: string, path: string) {
  const resolve = pending.get(query);
  if (!resolve) throw new Error(`\`${query}\`로 묻지 않았다 — 붙잡은 것: ${[...pending.keys()]}`);
  resolve(results(path));
  await new Promise((done) => setTimeout(done, 0));
}

/** 화면에 선 첫 줄의 문서 경로. 갈래가 넷이라 태그로 가른다 — 이 검사가 세우는 것은 문서뿐이다. */
function pathOf(data: unknown): string | undefined {
  const hit = (data as SearchResults | undefined)?.hits[0];
  return hit?.kind === "doc" ? hit.path : undefined;
}

/** 화면 하나를 세운다. 구독이 곧 첫 물음이다. */
function watch(query: string) {
  const observer = new QueryObserver(new QueryClient(), searchQuery("atelier", query));
  const seen: (string | undefined)[] = [];
  observer.subscribe((result) => seen.push(pathOf(result.data)));
  return { observer, seen, shown: () => pathOf(observer.getCurrentResult().data) };
}

describe("빨리 칠 때", () => {
  it("늦게 온 답이 화면을 덮지 않는다", async () => {
    const { observer, seen, shown } = watch("가");
    await new Promise((done) => setTimeout(done, 0));

    // 앞 질의의 답이 오기 전에 한 글자를 더 친다.
    observer.setOptions(searchQuery("atelier", "가나"));
    await new Promise((done) => setTimeout(done, 0));

    // 순서가 뒤집혀 도착한다 — 지금 질의의 답이 먼저, 지나간 질의의 답이 나중에.
    await answer("가나", "지금.md");
    await answer("가", "지나간.md");

    expect(shown()).toBe("지금.md");
    // 한 번도 스쳐 지나가지 않았어야 한다. 마지막 값만 보면 덮었다가 되돌아온 것도 초록이다.
    expect(seen).not.toContain("지나간.md");
  });

  // 키가 바뀔 때마다 목록이 비면 **글자 하나마다 「맞는 것이 없습니다」가 깜빡인다** — 그것은
  // 「치는 동안 즉시 따라온다」의 반대다.
  it("다음 답이 오는 동안 앞 답이 서 있는다", async () => {
    const { observer, shown } = watch("가");
    await answer("가", "먼저.md");
    expect(shown()).toBe("먼저.md");

    observer.setOptions(searchQuery("atelier", "가나"));
    await new Promise((done) => setTimeout(done, 0));
    expect(shown(), "다음 답을 기다리는 동안 목록이 비었다").toBe("먼저.md");

    await answer("가나", "다음.md");
    expect(shown()).toBe("다음.md");
  });
});

describe("못 물었을 때", () => {
  // **재시도를 껐다**(`retry: false`). 디바운스가 없다는 것이 결정 29의 판단이라 글자 하나마다
  // 한 번이 나가는데, 기본값(3회 + 백오프)을 그대로 두면 백엔드가 실패하는 동안 그것이 글자
  // 하나마다 최대 네 번이 된다 — `search`는 부를 때마다 코퍼스 전량을 읽는 명령이다.
  //
  // **이 층에서는 동작으로 못 잰다.** query-core는 재시도 기본값을 `retry ?? (isServer ? 0 : 3)`로
  // 정하는데, L2에는 DOM이 없어(vite.config의 `node` 환경) 여기서는 이미 0이다 — 옵션을 통째로
  // 지워도 실패가 한 번에 `error`로 앉아 **관찰자로 재는 검사는 늘 초록이다.** 그래서 값으로
  // 못박는다. 이 옵션이 실물에서 무엇을 막는지는 위 문단이 든다.
  it("재시도를 끈 채로 나간다", () => {
    expect(searchQuery("atelier", "가").retry).toBe(false);
  });
});

// **세계마다 결과가 갈린다**(US 53). 캐시를 안 남기기로 한 것(`gcTime: 0`)과 두 세계가 같은
// 질의로 같은 자리를 쓰는 것은 다른 이야기라, 키에서 `mode`가 빠지면 Maison에서 친 `가`가
// 방금 Atelier에서 물어 둔 답을 그대로 세운다 — 결정 10이 두 세계에 같은 slug를 허용하므로
// 화면만 봐서는 「가끔 남의 것이 보인다」로만 보인다.
describe("세계를 건널 때", () => {
  /** 지금 저 세계의 팔레트를 새로 열면 화면에 무엇이 서는가. 물음 없이 캐시만 본다. */
  function opened(client: QueryClient, mode: Mode, query: string) {
    return pathOf(new QueryObserver(client, searchQuery(mode, query)).getCurrentResult().data);
  }

  it("저쪽 세계의 답이 캐시에서 나오지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(searchQuery("atelier", "가").queryKey, results("아틀리에.md"));

    // 심은 답이 실제로 잡히는지 **먼저** 본다 — 안 잡히면 아래 줄은 아무것도 안 재는 초록이다.
    expect(opened(client, "atelier", "가"), "심어 둔 답이 자기 세계에서도 안 선다").toBe(
      "아틀리에.md",
    );
    expect(opened(client, "maison", "가")).toBeUndefined();
  });
});

// **나가는 물음도 세계를 탄다.** 위 벌은 답이 어느 자리에 앉는가를 재는데, 목적지는 키에
// 안 실리므로(결정 21) 그 층에서는 안 보인다 — 두 세계에 한 목록을 보내는 변형은 키를
// 하나도 안 건드린 채 Maison에 `Projects` 줄을 세운다(그 세계에 프로젝트는 없다 — 결정 17).
describe("무엇을 물어 나가는가", () => {
  // 목록을 **리터럴로 적는다.** 표에서 뽑아 조립하면 구현을 베껴 적은 것이 되어, 표가 통째로
  // 기울어도 함께 기운다. 순서까지 적는 것은 코어가 건넨 순서로 줄을 세우기 때문이다
  // (`search.rs`의 `destination_hits`).
  it("그 세계의 목적지만 묻는다", () => {
    void searchQuery("maison", "마루").queryFn();
    expect(asked.get("마루")).toEqual(["terminal", "archive", "settings"]);

    void searchQuery("atelier", "아뜰").queryFn();
    expect(asked.get("아뜰")).toEqual(["projects", "terminal", "archive", "settings"]);
  });

  // **세계 자체도 함께 나간다** — 코어가 works·아카이브 루트를 그 값으로 고른다. 위 줄은 목적지
  // 목록만 들므로 `run`의 **첫 인자만** 누이는 변형을 못 물고, `api.test.ts`는 래퍼를 직접 불러
  // 자기가 준 인자가 그대로 나가는지만 보므로 **훅이 무엇을 넘겼는지는 안 본다** — 그 사이가 이
  // 줄이다. 잃으면 잡는 층이 L3 하나뿐이다.
  it("그 세계를 싣고 묻는다", () => {
    void searchQuery("maison", "마루").queryFn();
    void searchQuery("atelier", "아뜰").queryFn();
    expect(askedMode.get("마루")).toBe("maison");
    expect(askedMode.get("아뜰")).toBe("atelier");
  });
});
