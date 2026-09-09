/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 이웃한 tauri-commands.test.ts의 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// `CONTEXT.md`는 **말의 정본**이다 — 코드가 아니라 그 문서가 앱의 낱말을 정한다. 그래서
// 화면이 바뀌면 그 문서가 **거짓말을 하는 상태**가 될 수 있고, 그 거짓말은 아무 층에도
// 안 걸린다: 타입도 테스트도 산문을 안 읽는다. 판 04가 사이드바에서 펼침을 걷어내면서
// 「가지」·「잎」이 가리킬 것이 화면에서 없어졌고 그 자리에 「탭」이 섰다(결정 6·16).
//
// **낱말을 통째로 세지 않는다** — 「네 가지」처럼 이 문서와 무관한 쓰임이 그 그물에 걸린다.
// 보는 것은 **항목 이름**과 **표기 절**이다: 사전에 그 말이 등재돼 있는가, 그리고 표기
// 규칙이 지금 화면의 것을 예로 드는가.
const doc = readFileSync(fileURLToPath(new URL("../CONTEXT.md", import.meta.url)), "utf8");

// 항목은 굵은 낱말 + 콜론 한 줄이다 — `**셸**:`. 본문은 다음 항목 전까지다.
//
// 끝을 `$`가 아니라 `(?![\s\S])`로 적는다. `m` 플래그가 붙어 있어(`^`가 줄머리를 봐야 한다)
// `$`는 **줄마다** 맞고, 게으른 본문이 그 첫 줄에서 멈춰 버렸다 — 본문을 읽는 아래 검사가
// 항목의 첫 문장만 보고 있었다는 뜻이라, 거짓이 된 문장을 둘째 줄로 옮기기만 하면 그물을
// 빠져나갔다. 이 조각은 문서의 진짜 끝에서만 맞는다.
const entries = [
  ...doc.matchAll(/^\*\*(.+?)\*\*:\n([\s\S]*?)(?=\n\*\*|\n## |(?![\s\S]))/gm),
].map((m) => ({
  name: m[1],
  body: m[2],
}));
const names = entries.map((one) => one.name);
const bodyOf = (name: string) => entries.find((one) => one.name === name)?.body ?? "";
// 표기 절 — 라벨의 대소문자와 문장의 언어를 정하는 자리다. 「없다」를 세는 검사가 이 슬라이스를
// 본다: 늙은 예시는 절 어디에 남아 있어도 늙은 것이다.
const notation = doc.slice(doc.indexOf("## 표기"));
// 대문자 예시가 실제로 사는 **한 항목**의 본문. 「있다」를 세는 검사는 절 전체가 아니라 여기를
// 봐야 한다 — 슬라이스로 보면 이웃한 「문장은 한국어」가 같은 낱말들을 들고 있어서, 대문자
// 예시에서 두 세계가 통째로 빠져도 초록이 된다(그렇게 새는 것을 실제로 보고 좁혔다).
const uppercase = bodyOf("고르는 것의 라벨은 소문자 영어");

// 항목이 _피할 말_로 등재한 낱말들. 「모드」의 `공간`처럼 **사전이 거부한 말**이 여기 모인다.
const avoided = [...doc.matchAll(/^_피할 말_: (.+)$/gm)].flatMap((m) =>
  m[1].split(",").map((one) => one.trim()),
);
// 그중 **자기 항목을 가진 말은 뺀다.** 「터미널」은 「셸」 항목의 _피할 말_이면서 자기도
// 등재된 화면의 이름이라(그래서 `aria-label="터미널 글꼴"`이 옳다), _피할 말_은 「그 항목을
// 이 말로 부르지 마라」는 뜻이지 「이 말을 쓰지 마라」가 아니다. 남는 것 — 어느 항목도 아닌
// 채 거부만 된 말 — 만 화면에 뜨면 안 되는 낱말이다.
const refused = avoided.filter((word) => !names.includes(word));

const src = fileURLToPath(new URL(".", import.meta.url));
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
// **한 줄짜리 `aria-label="…"` 리터럴만 본다.** 사용자에게 가는 문자열 전부를 훑으려면
// 소스를 반쯤 파싱해야 하고, 그런 검사는 파서가 새는 날 조용히 통과한다(`scroll-overlay`가
// 같은 이유로 한 줄 리터럴에 머문다). 접근성 이름으로 좁히면 파싱이 필요 없고, 이 사고가
// 실제로 난 자리가 정확히 거기다 — 컨트롤을 **뭐라고 부르는가**가 사전이 정하는 것이다.
const ariaLabels = sourceFiles(src).flatMap((path) =>
  [...readFileSync(path, "utf8").matchAll(/aria-label="([^"\n]*)"/g)].map((m) => m[1]),
);

describe("말의 사전", () => {
  // **이 한 줄이 위 정규식의 그물이다.** 문서의 모양이 바뀌어 파서가 새면 항목이 0개가
  // 되는데, 그러면 아래 「없다」 검사들이 전부 저절로 초록이 된다 — 없어야 할 것이 없는
  // 게 아니라 아무것도 안 읽은 것이다.
  it("사전이 실제로 읽힌다", () => {
    // **아래에서 본문을 읽는 항목은 여기 이름이 있어야 한다.** `bodyOf`가 없는 항목에
    // 빈 문자열을 주므로, 「터미널」이 이름을 바꾸면 그 항목의 `not.toContain` 단언이
    // 읽은 것 없이 초록이 된다 — 그물이 한 칸 새는 자리가 정확히 거기다.
    expect(names).toEqual(
      expect.arrayContaining([
        "셸",
        "명령",
        "열",
        "분할",
        "터미널",
        "모드",
        "고르는 것의 라벨은 소문자 영어",
      ]),
    );
  });

  it("「탭」이 등재돼 있다", () => {
    // 결정 16. 탭은 **화면 위의 자리**이고 셸은 **프로세스**다 — 세는 말은 「셸 8개」이지
    // 「탭 8개」가 아니라, 그 구분이 사전에 있어야 새 문구가 그것을 딛는다.
    expect(names).toContain("탭");
  });

  it("「모드」·「Room」이 등재돼 있다", () => {
    // #183이 세계를 화면에 세웠다 — 사이드바 최상단 세그먼트가 「지금 어느 세계인가」를 말하고
    // 상주 목록이 그 세계의 것을 든다. 그 축과 저쪽 세계의 항목에 이름이 없으면, 다음 사람이
    // 「작업」으로 Room을 부르거나 「공간」으로 모드를 불러 두 어휘가 조용히 섞인다.
    expect(names).toContain("모드");
    expect(names).toContain("Room");
  });

  it("「모드」가 두 세계를 다 든다", () => {
    // 값이 **둘뿐**인 것이 이 말의 전부다(결정 5) — 레지스트리가 아니라 축이다. 한쪽 이름만
    // 남으면 사전이 「모드」를 Maison 하나를 켜고 끄는 스위치처럼 말하게 되고, 그러면
    // `/settings`처럼 **어느 쪽도 아닌** 주소가 설명되지 않는다.
    expect(bodyOf("모드")).toContain("Atelier");
    expect(bodyOf("모드")).toContain("Maison");
  });

  // **사전이 거부한 말이 화면으로 새지 않는다.** 이 검사가 없던 동안 세그먼트의 접근성 이름이
  // `aria-label="공간 선택"`이었다 — 같은 변경이 「공간」을 _피할 말_로 등재하면서 그 낱말을
  // 스크린 리더로 말하고 있었고, 사전만 읽는 검사도 소스만 읽는 검사도 그것을 못 봤다.
  //
  // **양쪽이 다 fail-closed여야 한다**: 문서에서 아무것도 못 읽거나 소스에서 이름을 하나도
  // 못 찾으면, 「걸린 게 없다」가 「깨끗하다」로 읽힌다. 그래서 둘 다 아는 값 하나로 못박는다.
  it("_피할 말_이 접근성 이름에 안 뜬다", () => {
    expect(refused).toContain("공간");
    expect(ariaLabels).toContain("사이드바 토글");
    for (const word of refused) {
      expect(ariaLabels.filter((label) => label.includes(word))).toEqual([]);
    }
  });

  it("「가지」·「잎」이 없다", () => {
    // 결정 6이 사이드바에서 펼침을 통째로 걷었다. 가리킬 것이 화면에 없는 말을 사전에
    // 남겨 두면, 다음 사람이 그 말로 지금 화면을 설명하려다 없는 구조를 상상하게 된다.
    expect(names).not.toContain("가지");
    expect(names).not.toContain("잎");
  });

  it("「터미널」이 사이드바를 가리키지 않는다", () => {
    // 「화면. 사이드바의 가지 하나」가 거짓이 됐다 — 터미널은 이제 화면 하나다.
    expect(bodyOf("터미널")).not.toContain("사이드바");
  });
});

describe("표기 절은 지금 화면의 것을 예로 든다", () => {
  it("고르는 자리로 탭 줄을 든다", () => {
    // 소문자 라벨이 서는 자리가 사이드바에서 탭 줄로 옮겨 갔다(결정 7·8).
    expect(notation).toContain("탭 줄");
  });

  it("대문자 층이 세계의 이름과 `Rooms`를 든다", () => {
    // 세그먼트의 두 낱말과 Maison 상주 목록의 머리는 nav 항목과 **같은 층**이라 대문자다
    // (US 59). 예시가 Atelier의 것만 들면 「대소문자가 층을 가른다」가 두 세계 중 한쪽에서만
    // 확인되고, 그 절은 반만 맞는 말이 된다 — main nav부터가 세계마다 다르다(결정 6·17).
    expect(uppercase).toContain("`Atelier`");
    expect(uppercase).toContain("`Maison`");
    expect(uppercase).toContain("`Rooms`");
  });

  it("사이드바 가지를 예로 들지 않는다", () => {
    expect(notation).not.toContain("가지");
  });

  it("소문자 `terminal`을 고르는 것으로 들지 않는다", () => {
    // 그 라벨은 사이드바 가지의 머리행이었고 그 행이 사라졌다. 남은 소문자 가족은
    // 탭 줄의 `spec`과 패널 탭의 `spec`·`info`다 — 예시가 늙으면 「대소문자가 층을
    // 가른다」는 규칙 자체가 화면에서 확인되지 않는다.
    expect(notation).not.toContain("`terminal`");
  });
});
