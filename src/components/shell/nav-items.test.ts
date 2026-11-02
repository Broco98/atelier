import { describe, expect, it } from "vitest";
import { navItems } from "./nav-items";

// 사이드바 위 칸의 다섯(restart 02a-3 · 스토리 86 · 시안 Main의 `nav[aria-label="가는 곳"]`) — 차례와 이름, 가는 곳을 잰다. 같은 배열을 ⌘K의
// 「가는 곳」과 화면 머리 줄의 이름이 읽는다(`destinations.ts` · `Frame`의 `HeadSlot`).

describe("위 칸의 다섯", () => {
  it("Services · Projects · Terminal · Processes · Archive 차례로 서고 저마다 제 화면으로 간다", () => {
    expect(navItems.map(({ label, to }) => [label, to])).toEqual([
      ["Services", "/services"],
      ["Projects", "/projects"],
      ["Terminal", "/terminal"],
      ["Processes", "/processes"],
      ["Archive", "/archive"],
    ]);
  });

  // 켜짐 판정은 `to` 접두사다(`AppShell`) — 다른 항목의 주소가 `/services`로 시작하거나 그 반대면 두 항목이 함께 켜진다.
  it("항목의 주소는 서로의 앞부분이 아니다", () => {
    for (const one of navItems) {
      for (const other of navItems) {
        if (one !== other) expect(`${other.to}/`.startsWith(`${one.to}/`), `${one.to} · ${other.to}`).toBe(false);
      }
    }
  });
});
