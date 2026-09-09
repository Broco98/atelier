/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateWorks, specFileQuery, worksQuery } from "./hooks";
import { ALL_MODES } from "@/mode";
import type { Mode } from "@/mode";
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
