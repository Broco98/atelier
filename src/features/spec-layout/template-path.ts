// 템플릿 파일의 이름 짓기(spec 레이아웃 티켓 12 · 구현 스펙 5절 「템플릿 파일은 `layout.json`과 같은 폴더에
// 둔다」 · 결정 6).
//
// **경로는 사람이 적지 않는다** — 편집기가 템플릿을 켤 때 한 번 정한다(`draft.ts`의 `setTemplate`). 이름
// 틀을 나중에 고쳐도 따라가지 않고, 끄고 다시 켜면 그때의 이름 틀로 다시 정한다. 손으로 고친
// `layout.json`이 폴더 안의 다른 경로를 가리키면 그 경로를 그대로 쓴다 — 이름을 짓는 것은 경로가 없을
// 때뿐이다.
//
// 이 파일은 이름만 짓는다. 경로가 폴더 안인지, `layout.json` 자신이 아닌지는 저장이 엔진의 검증으로
// 판정한다(결정 13) — 여기서 피하는 것은 그 검증에 걸리지 않는 이름을 **처음부터** 고르기 위해서다.

/** 템플릿과 같은 폴더에 사는 레이아웃 파일. 이 이름은 템플릿이 쓰지 않는다. */
const LAYOUT_FILE = "layout.json";

/** 남는 이름이 없을 때(막 더한 빈 이름 틀) 짓는 이름. */
const UNNAMED = "template.md";

/**
 * 이름 틀과 이미 쓰인 경로들로 새 템플릿의 경로를 정한다. 경로는 레이아웃 폴더 기준이고, 늘 그 폴더
 * 바로 아래의 파일 하나다.
 *
 * - 고정 이름은 그 이름이다(`decisions.md` → `decisions.md`).
 * - 이름 틀은 자리 표시자의 중괄호를 걷는다(`adr-{n}-{name}.md` → `adr-n-name.md`).
 * - 이름 틀에 잘못 든 `/`(또는 `\`)는 마지막 조각만 남긴다(`a/b.md` → `b.md`, `../x.md` → `x.md`) — 경로는
 *   켤 때 한 번 정해져 이름 틀을 고쳐도 따라가지 않으니, 여기서 걸러야 템플릿이 하위 폴더에 서거나 저장이
 *   늘 거절하는 절대 경로가 되지 않는다.
 * - 앞의 점은 뗀다 — 엔진은 점으로 시작하는 파일을 보지 않아(원자적 쓰기의 임시 파일 자리다) 그런
 *   템플릿은 늘 「없는 템플릿」이 된다. 남는 이름이 없으면 `template.md`다.
 * - 쓰인 경로나 `layout.json`과 겹치면 확장자 앞에 `-2`, `-3`…을 붙인다. **겹침은 대소문자를 가리지
 *   않는다** — macOS의 기본 파일 시스템에서 `Decisions.md`와 `decisions.md`는 같은 파일이다. 유니코드
 *   정규형(NFC·NFD)만 다른 이름도 같은 파일이라 맞춰 견준다.
 */
export function templatePathFor(pattern: string, taken: readonly string[]): string {
  const last = pattern.split(/[\\/]/).pop() ?? "";
  const name = last.replace(/\{(n|name)\}/g, "$1").replace(/^\.+/, "") || UNNAMED;
  const used = new Set([LAYOUT_FILE, ...taken].map(folded));
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (let number = 2; used.has(folded(candidate)); number++) {
    candidate = `${stem}-${number}${extension}`;
  }
  return candidate;
}

/**
 * 파일 시스템이 같은 파일로 보는 이름끼리 같아지게 접는다 — 엔진이 `layout.json`을 가리는 것과 같은
 * 접기다(대문자로 올렸다가 소문자로 내린다: `ſ`처럼 소문자로만 내리면 놓치는 글자가 있다).
 */
function folded(path: string): string {
  return path.normalize("NFC").toUpperCase().toLowerCase();
}
