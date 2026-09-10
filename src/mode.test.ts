/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 `context-glossary.test.ts`의 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { navItems } from "@/components/shell/nav-items";
import {
  ALL_MODES,
  destinationsOf,
  hasProjects,
  modeOf,
  navItemsOf,
  navTargetOf,
  placeModeOf,
  refPrefixesOf,
  routesOf,
  slugOf,
} from "./mode";

// 모드는 **URL이 정본**이라(결정 8) 이 파일의 검사는 전부 주소에서 시작한다. 순수 함수라
// DOM도 라우터도 없이 전수할 수 있고, 여기서 못 잡는 것(정규화·히스토리)만 `router.test.ts`가
// 든다 — 두 층이 같은 것을 재면 한쪽이 낡아도 안 보인다.

describe("주소가 세계를 말한다", () => {
  // **경계가 이 함수의 전부다.** `startsWith("/maison")` 하나로 두면 `/maisonette`가 Maison이
  // 되고, 그 사고는 화면에서 「가끔 저쪽으로 뜬다」로만 보인다.
  it.each(["/maison", "/maison/", "/maison/rooms", "/maison/rooms/금융", "/maison/terminal"])(
    "%s는 Maison이다",
    (pathname) => {
      expect(modeOf(pathname)).toBe("maison");
    },
  );

  it.each(["/maisonette", "/maisonette/rooms", "/", "/works", "/works/maison", "/settings"])(
    "%s는 Atelier다",
    (pathname) => {
      expect(modeOf(pathname)).toBe("atelier");
    },
  );

  // `/settings`가 Atelier로 떨어지는 것은 **판정이 아니라 기본값**이다 — 설정에는 모드
  // 접두사가 없어서(공용 `settings.json`) URL로는 어느 세계에서 왔는지 모른다. 그 화면의
  // 세그먼트는 마지막 모드 값을 써야 하고, 이 줄이 그 사실을 남긴다.
  it("설정 주소는 모드를 안 싣는다", () => {
    const settings = destinationsOf("maison").find((place) => place.key === "settings");
    expect(settings?.to).toBe("/settings");
    expect(modeOf(settings?.to ?? "")).toBe("atelier");
  });
});

// 「어느 세계에 있었다고 적어 둘 것인가」는 `modeOf`로 물으면 안 된다 — 그 함수의 기본값은
// 판정이 아니라 **모르는 주소를 눕히는 자리**라, 적는 쪽에서는 거짓말이 된다.
describe("적어 둘 세계를 묻는다", () => {
  it.each(["/", "/settings"])("%s는 세계 밖이라 적지 않는다", (pathname) => {
    expect(placeModeOf(pathname)).toBeNull();
  });

  // 설정 아래로 화면이 갈라지는 날(`/settings/일반`) 그 칸도 세계 밖이다 — 접두사로 보지
  // 않으면 그날 하나가 조용히 마지막 모드를 덮어쓴다.
  it("설정 아래 화면도 세계 밖이다", () => {
    expect(placeModeOf("/settings/일반")).toBeNull();
  });

  // 모드를 싣는 주소는 `modeOf`와 **같은 답**이어야 한다. 갈리면 적어 둔 세계와 지금 켜진
  // 세그먼트가 어긋난다.
  it.each(["/works", "/works/생활-모드", "/projects", "/maisonette", "/terminal", "/archive"])(
    "%s는 Atelier로 적는다",
    (pathname) => {
      expect(placeModeOf(pathname)).toBe("atelier");
    },
  );

  it.each(["/maison", "/maison/rooms", "/maison/rooms/금융", "/maison/archive"])(
    "%s는 Maison으로 적는다",
    (pathname) => {
      expect(placeModeOf(pathname)).toBe("maison");
    },
  );

  // 표의 다섯 화면은 전부 적히는 자리여야 한다 — 하나가 세계 밖으로 떨어지면 그 화면에
  // 머무는 동안 마지막 주소가 낡은 채 굳는다.
  it("표의 주소는 모두 자기 세계로 적힌다", () => {
    for (const mode of ALL_MODES) {
      for (const to of Object.values(routesOf(mode))) {
        expect(placeModeOf(to)).toBe(mode);
      }
    }
  });
});

describe("주소에서 slug를 읽는다", () => {
  // 두 모드를 **한 함수가** 읽는다. 한글은 두 모드 다에서 디코드돼야 한다 — 갈래를 나눠
  // 적었다면 한쪽만 잊는 사고가 한글 slug에서만 조용히 났을 자리다.
  it("두 모드의 항목 주소를 다 읽는다", () => {
    expect(slugOf("/works/spec-search")).toBe("spec-search");
    expect(slugOf("/maison/rooms/finance")).toBe("finance");
    expect(slugOf(`/works/${encodeURIComponent("생활 모드")}`)).toBe("생활 모드");
    expect(slugOf(`/maison/rooms/${encodeURIComponent("금융")}`)).toBe("금융");
  });

  // 목록 주소는 **아직 아무것도 안 고른 상태**다(정규화가 붙는 자리). 빈 문자열을 돌려주면
  // 부르는 쪽이 「고른 것이 있다」로 읽어 없는 항목을 찾는다.
  it.each(["/works", "/works/", "/maison/rooms", "/maison/rooms/"])(
    "목록 주소 %s에는 고른 것이 없다",
    (pathname) => {
      expect(slugOf(pathname)).toBeNull();
    },
  );

  // 이 세 줄이 「그 모드의 목록 주소만 본다」를 세운다 — 앞머리를 모드와 무관하게 잡으면
  // Maison 아카이브 항목이 Room으로 읽히거나 그 반대가 된다.
  it.each(["/terminal", "/maison/terminal", "/archive/shipped", "/maison/archive/shipped", "/"])(
    "%s는 항목 주소가 아니다",
    (pathname) => {
      expect(slugOf(pathname)).toBeNull();
    },
  );

  // slug는 경로의 **한 칸**이다. 뒤가 더 붙은 주소는 그 항목의 하위 화면이지 다른 slug가 아니다.
  it("첫 칸만 slug다", () => {
    expect(slugOf("/maison/rooms/finance/spec")).toBe("finance");
  });
});

describe("모드별 표", () => {
  it("모드는 둘뿐이다 — 결정 5", () => {
    expect(ALL_MODES).toEqual(["atelier", "maison"]);
  });

  // **이 다섯이 서로 다른 값이어야 한다.** 표 한쪽을 다른 쪽으로 눕히는 변형(둘 다 `/works`를
  // 돌려주는 것)은 화면을 안 죽이고 지나간다 — Maison으로 가도 Atelier가 뜰 뿐이다.
  it.each(["list", "item", "terminal", "archive", "archiveItem"] as const)(
    "%s 주소가 두 모드에서 갈린다",
    (key) => {
      expect(routesOf("maison")[key]).not.toBe(routesOf("atelier")[key]);
    },
  );

  // 표와 `modeOf`가 서로를 확인한다 — 표의 주소를 고치다 접두사를 빠뜨리면 그 화면이
  // Maison인데 셸은 Atelier로 읽는 어긋남이 생기고, 그것은 URL만 봐서는 안 보인다.
  it("표의 주소가 스스로 자기 모드로 읽힌다", () => {
    for (const mode of ALL_MODES) {
      for (const to of Object.values(routesOf(mode))) {
        expect(modeOf(to)).toBe(mode);
      }
    }
  });

  // `slugOf`가 기대는 불변식이다 — 항목 주소는 목록 주소 아래 한 칸. 이것이 깨지면 slug
  // 해석기가 조용히 `null`만 돌려준다(주소는 멀쩡한데 사이드바 강조가 안 선다).
  it("항목 주소는 목록 주소 아래 한 칸이다", () => {
    for (const mode of ALL_MODES) {
      const routes = routesOf(mode);
      expect(routes.item).toBe(`${routes.list}/$slug`);
      expect(routes.archiveItem).toBe(`${routes.archive}/$slug`);
    }
  });
});

describe("모드별 nav", () => {
  // 결정 6. `Projects`가 없는 것은 빠뜨린 게 아니라 이 세계에 프로젝트가 없기 때문이다(결정 17).
  it("Maison nav는 Terminal·Archive 둘이다", () => {
    expect(navItemsOf("maison").map((item) => item.key)).toEqual(["terminal", "archive"]);
  });

  // **양쪽을 함께 못 박는다**: 「둘이다」만 세우면 그 둘이 Atelier 주소를 가리켜도 초록이다.
  it("Maison nav는 Maison 주소로 간다", () => {
    for (const item of navItemsOf("maison")) {
      expect(modeOf(item.to)).toBe("maison");
    }
  });

  // Atelier 벌의 정본은 계속 `nav-items.ts`다(그 파일의 주석이 「왜 Works가 없는가」를
  // 든다). 그래서 여기서는 **어긋나지 않는지**만 본다 — 저쪽에서 `to`를 고치면 라우트 표와
  // 갈라지고, 그 어긋남은 nav는 멀쩡한데 정규화만 딴 데로 가는 모양으로 나온다.
  it("Atelier nav는 nav-items.ts 그대로이고 라우트 표와 안 어긋난다", () => {
    expect(navItemsOf("atelier")).toBe(navItems);
    const routes = routesOf("atelier");
    expect(navItemsOf("atelier").find((item) => item.key === "terminal")?.to).toBe(routes.terminal);
    expect(navItemsOf("atelier").find((item) => item.key === "archive")?.to).toBe(routes.archive);
  });

  // 사이드바가 **그 세계의 배열**을 그리게 되면서(#183) 화면에 선 항목은 전부 그 배열의
  // 것이다 — 그리는 자리가 실제로 `navItemsOf`를 도는지는 `Sidebar.test.tsx`가 본다.
  it.each(ALL_MODES)("%s에서 사이드바가 그리는 항목은 전부 갈 곳이 있다", (mode) => {
    for (const item of navItemsOf(mode)) {
      expect(navTargetOf(mode, item.key), item.key).toBeTruthy();
    }
  });

  // **되돌림이 걷혔다.** 사이드바가 두 세계에 Atelier 배열을 그리던 동안에는 Maison 화면에도
  // `Projects`가 서 있어서 아무 데도 안 보내면 「눌리는데 아무 일도 없는 버튼」이었고, 그래서
  // Atelier 벌로 떨어뜨렸다. 이제 그 항목은 화면에 없으니 갈 곳이 없다고 답하는 것이 정직하다 —
  // 남겨 두면 그 항목이 어떤 이유로든 되살아나는 날 조용히 세계를 건넌다(결정 17).
  it("그 세계에 없는 항목은 갈 곳이 없다", () => {
    expect(navItemsOf("maison").some((item) => item.key === "projects")).toBe(false);
    expect(navTargetOf("maison", "projects")).toBeUndefined();
  });

  // 되돌림이 **먼저 걸리면 안 된다** — 그러면 Maison의 Terminal·Archive가 Atelier 주소로 가서
  // nav 한 번에 세계를 떠난다. 「갈 곳이 있다」와 「그 세계로 간다」는 반대 방향으로 틀린다.
  it.each(ALL_MODES)("%s에 있는 항목은 그 세계의 주소로 간다", (mode) => {
    for (const item of navItemsOf(mode)) {
      expect(navTargetOf(mode, item.key)).toBe(item.to);
    }
  });
});

describe("모드별 팔레트 목적지", () => {
  // 팔레트는 nav 줄에 **설정 한 줄을 얹은 것**이다(결정 51) — 두 모드 다 같은 규칙이다.
  it.each(ALL_MODES)("%s의 목적지는 nav 뒤에 설정 한 줄이다", (mode) => {
    expect(destinationsOf(mode).map(({ key, label, to }) => ({ key, label, to }))).toEqual([
      ...navItemsOf(mode).map(({ key, label, to }) => ({ key, label, to })),
      { key: "settings", label: "Settings", to: "/settings" },
    ]);
  });

  // 한때 여기에 **두 표를 잇는 다리**가 있었다 — 팔레트가 계속 `destinations.ts`의 Atelier
  // 전용 배열을 읽던 동안, 그 배열과 이 표가 갈리는 것을 막던 줄이다. #185가 팔레트를 이
  // 표로 옮기면서 저쪽 배열이 없어졌고, 그때부터 그 줄은 **자기 자신을 재는 검사**가 됐다
  // (양쪽이 같은 표에서 나오므로 무엇을 바꿔도 함께 움직인다). 그래서 걷었다.
  //
  // 그 다리가 지키던 결정 51은 `features/search/destinations.test.ts`가 두 모드 모두에서
  // 든다 — 「설정은 nav 줄에 없고 팔레트에는 있다」의 양쪽을 함께 못 박는 그 검사다.
});

describe("모드별 참조 접두사", () => {
  // Room의 참조는 `~/.atelier/maison/rooms/…`다(결정 7·US 30). 두 루트가 같은 앞머리를
  // 쓰면 에이전트에게 넘긴 참조가 저쪽 세계의 폴더를 가리킨다.
  it("Maison은 자기 홈 아래다", () => {
    expect(refPrefixesOf("maison")).toEqual({
      work: "~/.atelier/maison/rooms/",
      archive: "~/.atelier/maison/archive/",
    });
    expect(refPrefixesOf("atelier").work).not.toBe(refPrefixesOf("maison").work);
    expect(refPrefixesOf("atelier").archive).not.toBe(refPrefixesOf("maison").archive);
  });

  // 생성기 넷이 이 표를 실제로 읽는지는 여기서 안 잰다 — `refs.ts`가 표에서 앞머리를
  // 꺼내 쓰게 된 뒤로(#186), 표에서 뽑아 조립한 기대값은 구현을 베껴 적은 것이라 앞머리가
  // 통째로 뒤바뀌어도 초록으로 남는다. 완성된 참조는 `features/works/refs.test.ts`가
  // **글자 그대로** 잰다.
});

// **이 세계에 프로젝트가 있는가**(결정 17). 값 자체는 두 줄이면 끝나지만, 이 함수가 생긴
// 이유는 값이 아니라 **물음에 이름이 없었다는 것**이다 — 같은 판정이 화면 여섯과 훅 하나에
// 세계 이름을 리터럴로 맞대는 같은 모양으로 흩어져 있었다.
describe("세계가 프로젝트를 갖는가", () => {
  it("Atelier만 갖는다", () => {
    expect(hasProjects("atelier")).toBe(true);
    expect(hasProjects("maison")).toBe(false);
  });

  // **nav와 같은 답을 해야 한다.** 두 사실이 갈리면 Maison nav에 `Projects`가 없는데 화면은
  // 프로젝트 구획을 그리거나, 그 반대가 된다 — 표가 하나라는 것이 이 동치의 근거이므로
  // 표에서 두 칸을 따로 뽑아 맞대는 것이 그물이 된다.
  it.each(ALL_MODES)("%s: nav의 `Projects` 유무와 같은 답이다", (mode) => {
    const inNav = navItemsOf(mode).some((item) => item.label === "Projects");
    expect(hasProjects(mode)).toBe(inNav);
  });

  // **리터럴 비교가 다시 태어나지 않는다.** 이 함수가 생기기 전에는 일곱 자리가 각자 늙었고,
  // 새 자리가 하나 더 늘어도 아무 검사가 안 빨개졌다. 프로덕션 소스를 통째로 훑어 그 모양을
  // 막는다 — 「값을 정하는 자리는 하나」를 구조로 세우는 마지막 한 칸이다.
  //
  // **`shell-registry.ts`가 유일한 예외다.** 그 모듈은 타입 말고 아무것도 import하지 않고
  // (그 성질을 자기 소스 스캔이 지킨다) 그래야 `SidebarWorkList`가 정적 마크업 검사에서
  // 그것을 쓸 수 있다 — 값 하나를 들이면 `@/mode`가 딸려 온다. 예외를 **목록으로 못박아**
  // 두 번째 예외가 조용히 생기지 않게 한다.
  //
  // **fail-closed다**: 파일을 하나도 못 읽거나 예외 파일이 사라지면 「깨끗하다」가 아니라
  // 빨개진다.
  it("리터럴로 세계를 비교하는 자리가 예외 하나뿐이다", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const sources = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    })(root);
    expect(sources.length).toBeGreaterThan(50);

    const ALLOWED = ["features/terminal/shell-registry.ts"];
    const offenders = sources
      .filter((path) => /mode === "(?:atelier|maison)"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path).split("\\").join("/"));
    expect(offenders.sort()).toEqual(ALLOWED);
  });
});
