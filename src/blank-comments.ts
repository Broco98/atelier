// **소스 지킴 검사가 주석을 빼고 읽는 길** — 글자 단계(`type-scale.test.ts`) · 아이콘 선(`icon-stroke.test.ts`) · 상태 면
// (`state-scale.test.ts`) · 색 지킴(`color-guard.test.ts`)이 함께 쓴다.
// 주석은 옛 값을 기록으로 남기는 자리라(부품 머리말 「앱 규격으로 고친 자리」), 그 글자를 어긴 자리로 세면 안 된다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다.

// 주석을 같은 길이의 공백으로 지운다 — 줄 번호가 그대로 남아 실패 메시지가 자리를 댈 수 있다.
// 문자열과 템플릿 안의 `//`(주소)를 주석으로 읽지 않으려고 따옴표를 따라간다. 정규식 리터럴은
// 앞 글자로 가른다(나눗셈은 이름 · 닫는 괄호 · 숫자 뒤에 온다).
export function blankComments(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // 열린 템플릿마다 그 `${` 안의 중괄호 깊이
  const templates: number[] = [];
  let i = 0;
  let last = "";
  const skipString = (quote: string) => {
    for (i++; i < source.length && source[i] !== quote && source[i] !== "\n"; i++) {
      if (source[i] === "\\") i++;
    }
    i++;
  };
  const skipTemplate = () => {
    for (i++; i < source.length; i++) {
      if (source[i] === "\\") i++;
      else if (source[i] === "`") return void i++;
      else if (source[i] === "$" && source[i + 1] === "{") {
        templates.push(0);
        return void (i += 2);
      }
    }
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      skipString(c);
      last = c;
    } else if (c === "`") {
      skipTemplate();
      last = c;
    } else if (c === "{" && templates.length > 0) {
      templates[templates.length - 1]++;
      i++;
      last = c;
    } else if (c === "}" && templates.length > 0 && templates[templates.length - 1] === 0) {
      templates.pop();
      skipTemplate();
      last = "`";
    } else if (c === "}" && templates.length > 0) {
      templates[templates.length - 1]--;
      i++;
      last = c;
    } else if (c === "/" && (last === "" || "(,=:[!&|?{};".includes(last))) {
      // 정규식 리터럴 — 문자 집합 `[…]` 안의 `/`는 끝이 아니다
      let inClass = false;
      for (i++; i < source.length && source[i] !== "\n"; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) break;
      }
      i++;
      last = "/";
    } else {
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out.join("");
}

// CSS의 주석(`/* … */`)도 같은 길이의 공백으로 지운다.
export function blankCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}
