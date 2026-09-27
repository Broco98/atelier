import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 프로세스 티켓 29 — **nav 메타의 본 것이 앱을 껐다 켜도 남는다**(프로세스 스펙 S41). 본 것의 집합은 localStorage에 산다(`looked.ts`) —
// 실행마다 잊으면 지난주의 자동 기록 하나가 앱을 켤 때마다 점을 다시 켠다. 이 파일은 그 저장의 두 끝을 잰다: 앱이 뜰 때 읽고, 새것을
// 봤을 때 적는다. 저장소가 없거나 만지면 던지는 자리(사생활 모드)에서도 모듈이 뜬다.
//
// **저장 키(`processes-seen`)를 글자 그대로 적는다.** 키가 바뀌면 앱을 새 판으로 올린 날 저장된 집합을 못 찾아 사람이 본 것이 모두 새것이
// 된다 — 이름 글자(`needs-look.test.ts`)와 같은 까닭이다.

const SEEN_KEY = "processes-seen";

/** 이 파일은 DOM 없는 Node에서 돈다. 케이스마다 저장소를 새로 심고 돌려준 속으로 무엇이 적혔는지 본다. */
function installStorage(initial: Record<string, string> = {}, broken?: Partial<Storage>): Map<string, string> {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    ...broken,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return values;
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};

/** 본 것은 모듈이 뜰 때 한 번 읽힌다 — 앱을 다시 켜는 것을 모듈을 새로 들이는 것으로 흉내 낸다. */
async function launch() {
  vi.resetModules();
  return import("./looked");
}

let original: PropertyDescriptor | undefined;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("본 것의 저장", () => {
  it("앱이 뜰 때 저장해 둔 본 것을 읽는다", async () => {
    installStorage({ [SEEN_KEY]: JSON.stringify(["shell:G-1", "record:7"]) });
    const { lookStore } = await launch();
    expect(lookStore.state.seen).toEqual(["shell:G-1", "record:7"]);
  });

  it("저장된 값이 없거나 모양이 아니면 빈 집합이다 — 모르는 값을 본 것으로 치면 새것을 못 가린다", async () => {
    for (const stored of [undefined, "not json", JSON.stringify({ seen: [] }), JSON.stringify([1, 2])]) {
      installStorage(stored === undefined ? {} : { [SEEN_KEY]: stored });
      const { lookStore } = await launch();
      expect(lookStore.state.seen, String(stored)).toEqual([]);
    }
  });

  it("새것을 보면 적고, 새것이 없으면 안 적는다", async () => {
    const values = installStorage();
    const { lookStore, markSeen } = await launch();
    markSeen(["shell:G-1"]);
    expect(values.get(SEEN_KEY)).toBe(JSON.stringify(["shell:G-1"]));
    values.delete(SEEN_KEY);
    markSeen(["shell:G-1"]);
    expect(values.has(SEEN_KEY)).toBe(false);
    expect(lookStore.state.seen).toEqual(["shell:G-1"]);
  });

  // 사생활 모드의 웹뷰는 localStorage가 **있는데 만지면 던진다.** 그 편의 때문에 사이드바(nav 메타)가 죽으면 안 된다 — 이번 실행 동안만
  // 기억한다. 저장소가 아예 없는 자리(노드)도 같다.
  it("저장소가 던지거나 없어도 모듈이 뜨고, 본 것은 이번 실행 동안 기억한다", async () => {
    installStorage({}, throwing);
    const broken = await launch();
    expect(broken.lookStore.state.seen).toEqual([]);
    expect(() => broken.markSeen(["shell:G-1"])).not.toThrow();
    expect(broken.lookStore.state.seen).toEqual(["shell:G-1"]);

    Reflect.deleteProperty(globalThis, "localStorage");
    const none = await launch();
    expect(none.lookStore.state.seen).toEqual([]);
    expect(() => none.markSeen(["shell:G-1"])).not.toThrow();
    expect(none.lookStore.state.seen).toEqual(["shell:G-1"]);
  });
});
