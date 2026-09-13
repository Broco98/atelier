/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 끌기 제스처가 **기능 폴더 밖**에 사는 이유가 import 금지 검사 둘이다(스펙 S4) — 작업 기능
// 폴더는 `/terminal`이 못 부르고(TerminalPage.test.tsx), 터미널 기능 폴더는 사이드바 목록이
// 못 부른다(SidebarWorkList.test.tsx). 그 둘은 **각자 자기 파일만** 세서, 이 모듈이 기능
// 폴더 하나를 끌어오면 둘 다 초록인 채 두 화면 중 하나가 이 모듈을 못 쓰게 된다.
//
// owner 타입(`ShellOwner`)이 터미널 기능 폴더에 산다 — **`import type`도 걸린다.** 타입만
// 들어도 경계가 값 차원에서 한 번 뚫리면 다음 사람이 값을 들여온다. 좁히기는 소비자가 한다.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

describe("공용 끌기 모듈은 기능 폴더를 모른다", () => {
  const gesture = read("./pointer-drag.ts");

  // **세는 파일이 정말 그 모듈인가를 먼저 묶는다.** 모듈이 옮겨 가고 이 이름의 파일만 남으면
  // 아래 0이 빈 초록이다 — 분할 모듈이 실제로 이 경로를 import하는 것을 알려진 양성으로 센다.
  it("분할 모듈이 이 파일을 import한다", () => {
    expect(countOf(read("../features/works/split-view.ts"), 'from "@/lib/pointer-drag"')).toBeGreaterThan(0);
  });

  it("기능 폴더 import가 0개다", () => {
    // 세는 방법이 새지 않는지 — 기능 폴더를 부르는 것이 확실한 화면에서 같은 리터럴이 잡힌다.
    expect(countOf(read("../features/works/WorksPage.tsx"), "@/features/")).toBeGreaterThan(0);

    // **주석에 적어도 빨개진다** — 리터럴을 세서 그렇고, 이웃 검사들과 같은 성질을 일부러 둔다.
    expect(countOf(gesture, "@/features/")).toBe(0);
    expect(countOf(gesture, "../features")).toBe(0);
  });
});
