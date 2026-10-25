import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextMenu } from "@/components/ui/context-menu";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { SummaryToggle, ThreadMenu, ThreadMenuItems, WorkCrumb } from "./ThreadHead";

// Thread 화면의 머리 줄(02 구현 스펙 §6 · S13 · S15 · 캔버스 v35 Screen-Live 머리 줄) — 왼쪽에 (이은 Work면 「폴더 · Work 이름 ›」) ·
// Thread 이름, 오른쪽에 「…」 · 요약 고정 토글이 선다. 조각은 훅을 부르지 않아 정적 마크업으로 잰다. 재는 것은 역할 · 접근성 이름 ·
// 눌림(`aria-pressed`)과 메뉴의 항목이다. 자리 · 색(14/500 · #898a8b · 켜진 면 #ebebec)은 시안 비교와 L3가 본다.

const none = () => {};

/** 열린 메뉴 Root 안에 선 항목 줄 — 카드는 포털이라 정적 마크업에 없고, Root 안에서는 항목 줄이 그려진다(`context-menu.test.tsx`). */
const inDropdown = (rename: (() => void) | null) =>
  renderToStaticMarkup(
    <DropdownMenu open>
      <ThreadMenuItems rename={rename} />
    </DropdownMenu>,
  );
const inContext = (rename: (() => void) | null) =>
  renderToStaticMarkup(
    <ContextMenu open>
      <ThreadMenuItems rename={rename} />
    </ContextMenu>,
  );
/** 부품이 짓는 id는 Root마다 다르다 — 줄을 견줄 때는 뺀다. */
const withoutIds = (markup: string) => markup.replace(/ id="base-ui-[^"]*"/g, "");
const items = (markup: string) =>
  [...markup.matchAll(/<div[^>]*role="menuitem"[^>]*>(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("Thread 메뉴(S15)", () => {
  // 사이드바 Thread 줄에는 지금 대상 메뉴가 없고, Thread에 할 수 있는 일은 이름 바꾸기 하나다(결정 「06 · Thread 대상 메뉴」). 정의는
  // 한 곳이라 ⋯ 카드와 우클릭 카드가 같은 줄을 편다 — 다음 판에 줄에 달면 항목이 저절로 같다.
  it("항목은 「이름 바꾸기」(F2) 하나이고, ⋯ 메뉴와 우클릭 메뉴에서 같은 줄이다", () => {
    const markup = inDropdown(none);
    expect(items(markup)).toEqual(["이름 바꾸기F2"]);
    expect(markup).toContain('aria-keyshortcuts="F2"');
    expect(withoutIds(inContext(none))).toBe(withoutIds(markup));
  });

  // 머리 줄 오른쪽 「…」(28 · #898a8b)가 이 메뉴를 연다 — 글리프뿐인 단추라 이름은 툴팁 글자다.
  it("머리 줄의 「…」는 메뉴를 여는 「Thread 메뉴」 단추다", () => {
    const markup = renderToStaticMarkup(<ThreadMenu rename={none} />);
    expect(markup).toMatch(/^<button[^>]*aria-label="Thread 메뉴"/);
    expect(markup).toMatch(/^<button[^>]*aria-haspopup="menu"/);
  });

  // 읽기만 된 Thread(v1 티켓 38)는 이름을 바꾸지 못한다 — 지금 못 하는 칸은 숨기지 않고 흐리다(work 메뉴와 같은 규칙).
  it("이름을 바꿀 수 없는 Thread에서는 「이름 바꾸기」가 꺼져 있다", () => {
    expect(inDropdown(null)).toMatch(/role="menuitem"[^>]*aria-disabled="true"/);
    expect(inDropdown(none)).not.toContain("aria-disabled");
  });
});

describe("요약 고정 토글", () => {
  // 시안 Screen-Live의 머리 줄 오른쪽 끝 토글(`aria-label="요약 고정"`). 이름은 할 일이고 켬/끔은 `aria-pressed`가 말한다 — 눌러도 이름이
  // 바뀌지 않는다. 이 판의 06에서는 지금 Work 카드를 여닫는다(요약 카드로 바꾸는 것은 07).
  it("이름은 「요약 고정」 하나이고, 열림을 aria-pressed로 말한다", () => {
    const on = renderToStaticMarkup(<SummaryToggle open onToggle={none} />);
    const off = renderToStaticMarkup(<SummaryToggle open={false} onToggle={none} />);
    expect(on).toMatch(/^<button[^>]*aria-label="요약 고정"[^>]*aria-pressed="true"/);
    expect(off).toMatch(/^<button[^>]*aria-label="요약 고정"[^>]*aria-pressed="false"/);
  });
});

describe("머리 줄의 Work 이름(S13)", () => {
  // Work에 이은 Thread는 이름 앞에 흐린 「폴더 · Work 이름 ›」이 선다. Work 이름이 누르는 자리이고(누르면 카드가 열린다 — 옛 Work 알약의
  // 일), 「›」는 그림이라 이름에 들지 않는다. 이름은 할 일과 Work 이름을 함께 말한다(옛 알약과 같은 이름).
  it("Work 이름이 「Work 열기: …」 단추로 서고, 그 뒤에 숨은 「›」가 선다", () => {
    const markup = renderToStaticMarkup(<WorkCrumb title="환불 API 버그 수정" onOpen={none} />);
    expect(markup).toMatch(/^<button[^>]*aria-label="Work 열기: 환불 API 버그 수정"[^>]*>.*환불 API 버그 수정.*<\/button><span aria-hidden="true"[^>]*>›<\/span>$/);
  });
});
