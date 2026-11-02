import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlainFrame, PlainHead } from "./PlainFrame";

// Thread · 첫 화면의 틀(02 구현 스펙 §3 · restart 02a-2) — 틀은 앱 셸 하나다(머리 줄 · 카드 자리). 이 화면들은 머리 줄에 놓을 것(이름 ·
// 할 일)과 본문 카드에 놓을 것(본문)만 건넨다. seam은 그린 꼴(markup)이다: 제자리에 서는 것은 본문 하나이고 머리는 셸의 머리 줄로 간다(그 길은
// `ShellHead.test.tsx` — 셸 밖이면 머리가 아무 데도 안 선다).
const render = (title?: { name: string }) =>
  renderToStaticMarkup(
    <PlainFrame title={title} label="채팅">
      <p>본문</p>
    </PlainFrame>,
  );

describe("Thread 화면의 틀", () => {
  it("제자리에는 본문 하나만 서고, 이름은 셸의 머리 줄로 간다", () => {
    const html = render({ name: "환불 API 버그 고쳐줘" });
    expect(html).toMatch(/^<main aria-label="채팅"[^>]*><p>본문<\/p><\/main>$/);
    expect(html).not.toContain("<header");
    expect(html).not.toContain("환불 API 버그 고쳐줘");
  });

  // restart 02a-2 — 흰 판 한 장이 걷히고 본문이 제 카드로 뜬다(시안 `.ra-card` — 면 surface · 둥글기 8 · 0.5 링). 공용 틀의 본문 카드와 한
  // 벌이다(`Frame`의 `Card`). 머리 줄 아래 선은 없다 — 카드의 위끝이 경계다.
  it("본문은 면 surface · 둥글기 radius-card · 0.5 링의 카드다", () => {
    const main = render({ name: "채팅" }).match(/^<main [^>]*class="([^"]*)"/)?.[1].split(" ") ?? [];
    expect(main).toEqual(expect.arrayContaining(["bg-surface", "rounded-card", "shadow-hairline", "overflow-hidden"]));
    expect(main.filter((one) => one.startsWith("border-"))).toEqual([]);
  });

  // **본문은 제 글 폭을 카드 밖에 알리지 않는다**(03 구현 스펙 §3) — 사이드바가 카드의 형제라, 카드 자리는 본문의 min-content를 바닥으로 들고
  // 사이드바와 자리를 나눈다(`AppShell`의 카드 자리 `min-w-min`). 긴 코드 줄 · 주소가 그 바닥을 부풀리면 사이드바가 좁아지고 카드가 창 밖으로
  // 밀린다. 그래서 본문 상자가 제 내용 폭을 격리한다 — 그려지는 폭은 카드 자리가 늘여 준다(공용 틀 화면들은 탭 줄의 바닥만 알린다 —
  // `TAB_ROW_COLUMN`).
  it("본문은 제 내용 폭을 카드 자리의 바닥으로 알리지 않는다", () => {
    expect(render({ name: "채팅" })).toMatch(/^<main [^>]*class="[^"]*\bcontain-inline-size\b/);
  });
});

describe("머리 줄에 보내는 것", () => {
  // Codex 머리 줄(02 §6 · 시안 `.tb-c` · `.tb-r`) — 왼쪽에 (이은 Work면 흐린 「폴더 · 작업공간 이름 ›」 뒤에) 이름이, 오른쪽 끝에 할 일이 선다.
  // 그릇은 셸의 화면 자리이고(포털 — `ShellHead.test.tsx`), 여기서는 보내는 차례를 잰다.
  it("이름 앞(lead) → 이름 → 오른쪽 끝(end) 차례다", () => {
    const html = renderToStaticMarkup(
      <PlainHead lead={<button type="button">작업공간 열기</button>} title={{ name: "구현" }} end={<button type="button">요약 고정</button>} />,
    );
    const at = ["작업공간 열기", "구현", "요약 고정"].map((text) => html.indexOf(text));
    expect(at.every((one) => one > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});
