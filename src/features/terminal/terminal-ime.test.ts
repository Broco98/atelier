import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { IME_KEYCODE, imeBlur, imeInput, imeKeyDown } from "./terminal-ime";

// 이 판에서 유일하게 **웹뷰가 준 실제 이벤트**로 세운 검사다. 아래 대본은 지어낸 것이 아니라
// 2026-08-23에 진짜 WKWebView에 두벌식을 프로그램으로 쳐 넣어 받은 로그를 그대로 옮긴 것이다
// (`docs/ime-probe.md`). 그러니 이 파일이 초록인 동안은 「안녕」이 셸에 온전히 닿는다.
//
// 붙이는 쪽(capture 단계·집에 건다)은 Node에서 못 돈다 — 그 자리는 아래 자리 검사가 본다.

/**
 * 이벤트 대본을 다리에 통과시켜 **셸에 닿은 것**을 잇는다. `[inputType, data]`, 또는 keyCode.
 *
 * 다리가 보내는 것만 세면 안 된다 — 삼키지 않은 `insertText`는 **xterm이 보낸다.** 그 몫까지
 * 세야 「사용자가 친 것이 셸에 무엇으로 닿는가」가 된다. 하네스에서 잰 `→PTY` 합계가 바로
 * 이 값이었다. (keydown이 만드는 `\r` 따위는 xterm의 키 경로라 여기서 안 센다.)
 */
type Step = readonly [string, string | null] | Key;
interface Key {
  keydown: string;
  code: number;
}

/** 평범한 키 하나. 이름은 판정에 안 쓰이므로 비워 둔다. */
const key = (code: number): Key => ({ keydown: "", code });
/** 수식키. **이름으로 갈린다** — keyCode가 아니다. */
const mod = (name: string): Key => ({ keydown: name, code: 0 });

function replay(script: readonly Step[]): { sent: string; swallowed: number } {
  let held = "";
  let sent = "";
  let swallowed = 0;
  for (const step of script) {
    if ("keydown" in step) {
      const out = imeKeyDown(held, step.keydown, step.code);
      held = out.held;
      sent += out.send;
      continue;
    }
    const out = imeInput(held, step[0], step[1]);
    held = out.held;
    sent += out.send;
    if (out.swallow) swallowed += 1;
    else if (step[0] === "insertText") sent += step[1] ?? "";
  }
  return { sent, swallowed };
}

const ins = (data: string) => ["insertText", data] as const;
const rep = (data: string) => ["insertReplacementText", data] as const;

describe("실측 대본 — 두벌식 「안녕」", () => {
  // d k s s u d + space. 마지막 `insertReplacementText "안"`은 값이 안 바뀌는 헛것인데
  // 웹뷰가 실제로 보내므로 대본에도 그대로 둔다 — 그것까지 무해해야 한다.
  const 안녕 = [
    ins("ㅇ"), rep("아"), rep("안"), rep("안"),
    ins("ㄴ"), rep("녀"), rep("녕"), rep("녕"),
  ] as const;

  it("낱자가 아니라 완성 음절이 나간다", () => {
    expect(replay([...안녕, ins(" ")]).sent).toBe("안녕 ");
  });

  it("Enter로 끝내도 앞 음절이 먼저 나간다", () => {
    // Enter는 `insertText`로 안 온다 — keydown 13이다. 그 자리에서 흘려보내지 않으면
    // 「녕」이 개행 뒤에 도착하거나 아예 사라진다. 개행 자체는 xterm의 키 경로 몫이라
    // 여기 안 나온다 — 하네스에서는 `안녕` 뒤에 `\r`이 붙어 나갔다.
    expect(replay([...안녕, key(13)]).sent).toBe("안녕");
  });

  it("조합 중 백스페이스는 꼬리를 줄인다 — 지우는 신호가 따로 오지 않는다", () => {
    // 실측: 백스페이스도 `insertReplacementText`로 오고 데이터가 한 겹 벗겨진다.
    expect(replay([...안녕, rep("녀"), rep("ㄴ"), key(13)]).sent).toBe("안ㄴ");
  });

  it("붙드는 동안에는 한 글자도 새지 않는다", () => {
    expect(replay(안녕.slice(0, 3)).sent).toBe("");
  });
});

describe("실측 대본 — Shift가 음절 한가운데 들어올 때", () => {
  // **이 판에서 가장 크게 뚫려 있던 자리다.** 두벌식에서 `ㄲㄸㅃㅆㅉ`·`ㅒㅖ`는 Shift로 치는데
  // 그 Shift keydown이 아직 미완인 앞 음절을 흘려보내고, 곧이어 오는 replacement가 같은
  // 음절을 다시 채워 **두 번 나갔다.** 실측에서 「했다」가 `해했다`로 갔다.
  it("「했다」가 한 번만 나간다", () => {
    // ㅎ · ㅐ · Shift+ㅅ · ㄷ · ㅏ · Enter
    const 했다 = [
      ins("ㅎ"), rep("해"), mod("Shift"), rep("했"),
      ins("ㄷ"), rep("다"), key(13),
    ] as const;
    expect(replay(했다).sent).toBe("했다");
  });

  it("조합 중 ⌘도 앞 음절을 뱉지 않는다", () => {
    // 상류의 가드에는 `Meta`가 없다. 이 앱은 그 터미널에 ⌘T·⌘W를 걸어 두어 조합 중에
    // 실제로 눌리고, 안 막으면 실측에서 `해해`가 나갔다.
    expect(replay([ins("ㅎ"), rep("해"), mod("Meta"), key(84)]).sent).toBe("해");
  });
});

describe("초점이 떠날 때", () => {
  it("붙들고 있던 글자를 흘려보낸다 — 안 그러면 조용히 사라진다", () => {
    expect(imeBlur("녕")).toEqual({ send: "녕", held: "" });
    expect(imeBlur("")).toEqual({ send: "", held: "" });
  });
});

describe("영문은 예전 그대로", () => {
  it("한 타에 한 자씩, 붙들지 않는다", () => {
    // 여기서 붙들면 `ls`가 `s`를 칠 때까지 `l`이 안 보인다. 그 회귀를 막는 자리다.
    const script = [ins("h"), ins("i"), key(13)];
    expect(replay(script).sent).toBe("hi");
    expect(replay(script).swallowed).toBe(0);
  });

  it("xterm에게 넘긴다 — 삼키는 것은 한글 경로뿐", () => {
    expect(imeInput("", "insertText", "h").swallow).toBe(false);
    expect(imeInput("", "insertText", "ㅇ").swallow).toBe(true);
    expect(imeInput("", "insertReplacementText", "안").swallow).toBe(true);
  });
});

describe("keydown", () => {
  it("IME가 물고 있는 키는 조합을 안 끊는다", () => {
    // 한글 타자도 조합 중 백스페이스도 전부 229로 온다(실측). 여기서 흘려보내면
    // 방금 붙든 낱자를 곧바로 뱉어 고치기 전과 같아진다.
    expect(imeKeyDown("녕", "ㅇ", IME_KEYCODE)).toEqual({ send: "", held: "녕" });
  });

  it("수식키도 조합을 안 끊는다 — 누르는 것만으로는 아무 데이터도 안 만든다", () => {
    for (const name of ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]) {
      expect(imeKeyDown("해", name, 16), `${name}이 조합을 끊었다`).toEqual({
        send: "",
        held: "해",
      });
    }
  });

  it("그 밖의 키는 조합의 끝이다", () => {
    expect(imeKeyDown("녕", "Enter", 13)).toEqual({ send: "녕", held: "" });
    expect(imeKeyDown("녕", "Escape", 27)).toEqual({ send: "녕", held: "" });
    expect(imeKeyDown("", "Enter", 13)).toEqual({ send: "", held: "" });
  });
});

describe("한글 대역", () => {
  it("낱자·완성 음절 둘 다 붙든다", () => {
    expect(imeInput("", "insertText", "ㅇ").held).toBe("ㅇ"); // 호환 자모 U+3147
    expect(imeInput("", "insertText", "안").held).toBe("안"); // 완성 음절 U+C548
  });

  it("한글이 아니면 안 붙든다", () => {
    for (const ch of ["a", " ", "1", "가나다".slice(0, 0) || "!", "あ", "中"]) {
      expect(imeInput("", "insertText", ch).held, `${ch}를 붙들었다`).toBe("");
    }
  });
});

// ── 자리 검사 ─────────────────────────────────────────────────────────────────
// 아래 둘은 값이 아니라 **자리**를 본다. 뒤집혀도 위 검사는 전부 초록이고, 터지는 것은
// 실물에서 한글을 칠 때뿐이다. 주석만 두면 뚫린다는 것을 이 저장소가 이미 겪었다.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(root + rel, "utf8");

describe("붙이는 자리", () => {
  it("집에 capture로 건다 — 입력칸에 걸면 xterm보다 늦다", () => {
    // 호출이 여러 줄이라 `);`로 자르면 안쪽 괄호에 먼저 걸린다. 호출 **사이**로 자른다.
    const src = read("src/features/terminal/terminal-ime.ts");
    const chunks = src.split("wrapper.addEventListener(").slice(1);
    const guarded = chunks.filter((chunk) => /^\s*"(input|keydown)"/.test(chunk));
    expect(guarded.length, "input·keydown을 거는 자리를 못 찾았다").toBe(2);
    for (const chunk of guarded) {
      expect(chunk.slice(0, chunk.indexOf("\n  );")), "capture(true)가 아니다").toMatch(
        /\n\s*true,/,
      );
    }
  });

  it("셸을 만들 때 걸린다", () => {
    const store = read("src/features/terminal/terminal-store.ts");
    const create = store.match(/function createInstance\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(create, "createInstance를 못 찾았다").not.toBe("");
    // 줄바꿈이 어디에 오든 첫 인자가 집이어야 한다 — 입력칸에 걸면 xterm보다 늦다.
    expect(create).toMatch(/attachIme\(\s*wrapper\b/);
  });

  it("숨은 입력칸의 크기 바닥이 0이 아니다", () => {
    // **이것이 원인의 절반이었다.** 쓰이는 크기가 0이면 WKWebView가 조합을 매 타자 끊는다.
    const rule = read("src/index.css").match(
      /\.xterm textarea\.xterm-helper-textarea\s*\{[^}]*\}/,
    )?.[0];
    expect(rule, "override 규칙이 index.css에 없다").toBeTruthy();
    expect(rule).toMatch(/min-width:\s*[1-9]/);
    expect(rule).toMatch(/min-height:\s*[1-9]/);
    // **`width`로 적으면 진다.** xterm이 커서가 움직일 때마다 인라인 `width`를 덮어쓰고
    // (`_syncTextArea`), 커서가 넓은 글자 뒤칸에 서면 그 값이 `0px`이다(실측).
    // 바닥(`min-*`)은 인라인과 싸우지 않고 이긴다.
    expect(rule, "`width`/`height`로 적으면 xterm의 인라인에 진다").not.toMatch(
      /(^|[^-])\bwidth:/,
    );
  });

  it("상류가 아직 0으로 두고 있다 — 고쳤으면 우리 override를 지울 때다", () => {
    const vendor = read("node_modules/@xterm/xterm/css/xterm.css");
    const rule = vendor.match(/\.xterm \.xterm-helper-textarea\s*\{[^}]*\}/)?.[0];
    expect(rule, "상류 규칙을 못 찾았다 — 선택자가 바뀌었으면 우리 override도 다시 봐야 한다")
      .toBeTruthy();
    expect(rule, "상류가 크기를 0에서 옮겼다. 이 판의 override와 그 근거 주석을 다시 볼 것")
      .toMatch(/width:\s*0/);
  });
});
