// Agent 얼굴의 값(v1 티켓 14 · 구현 스펙 §6 S36 · 캔버스 Sidebar 보드 「아바타」) — 눈 두 개가 있는 단순한 도형이다. 모양으로 먼저
// 가르고 색은 그다음이다. 이 파일은 모양 · 색 **이름**만 정하는 순수 함수이고, 그림은 `AgentFace.tsx`가 그린다.
//
// - **Agent 파일의 `avatar`가 먼저다**(S36 「파일이 Identity를 담는다」). 모양은 캔버스의 다섯(둥근 사각형 · 원 · 삼각형 · 세로 알약 ·
//   물방울), 색은 DS `chat-accent-*` 열 가지의 이름이다. 모르는 이름은 적지 않은 것과 같다 — 그 칸만 handle에서 정한다. Agent 파일은
//   남이 만든 것을 가져올 수도 있어 `hexagon` · `violet` 같은 글자로 그 Agent를 못 부르게 하지 않는다(깨진 까닭이 아니다, v1 티켓 03).
// - **적지 않았으면 handle에서 정한다** — 같은 handle은 어느 화면 · 어느 Thread에서든 같은 얼굴이다. 정할 때는 둥근 사각형(Host의
//   것)과 `orange`를 쓰지 않는다. DS의 라이트 `chat-accent-orange`는 붉은색(#ab1616)이라 「빨강은 실패와 diff만」(README 맞대 보기)과
//   부딪힌다. 파일에 적으면 둘 다 그대로 따른다.
// - **Host는 늘 무채색 둥근 사각형이다** — `avatar`를 적어도 바뀌지 않는다(S36). 색 `null`이 무채색이다.

/** 얼굴 모양 — 캔버스 「아바타」 보드의 다섯. `square`는 Host의 둥근 사각형이다. */
export type FaceShape = "square" | "circle" | "triangle" | "pill" | "drop";

/** 얼굴 색 — DS `chat-accent-*`의 이름(`index.css`). */
export type FaceColor =
  | "blue"
  | "green"
  | "yellow"
  | "pink"
  | "orange"
  | "purple"
  | "slate"
  | "lime"
  | "cyan"
  | "magenta";

/** Agent 파일의 `avatar`(`atelier_core::Avatar`) — 적힌 글자 그대로다. */
export interface Avatar {
  shape: string | null;
  color: string | null;
}

export interface Face {
  shape: FaceShape;
  /** `null`이면 무채색(Host) — 면은 글자색, 눈은 바탕색이라 테마를 따라 뒤집힌다. */
  color: FaceColor | null;
}

const SHAPES: readonly FaceShape[] = ["square", "circle", "triangle", "pill", "drop"];
const COLORS: readonly FaceColor[] = ["blue", "green", "yellow", "pink", "orange", "purple", "slate", "lime", "cyan", "magenta"];

/** handle에서 고르는 모양 · 색 — Host의 모양과 붉은 `orange`를 뺐다(머리말). */
const DERIVED_SHAPES: readonly FaceShape[] = ["circle", "triangle", "pill", "drop"];
const DERIVED_COLORS: readonly FaceColor[] = COLORS.filter((color) => color !== "orange");

const HOST = "host";

const known = <T extends string>(names: readonly T[], value: string | null | undefined): T | null =>
  names.find((name) => name === value?.trim().toLowerCase()) ?? null;

/** 그 Agent의 얼굴 — `avatar`에 아는 이름이 있으면 그것, 없는 칸은 handle에서 정한다. Host는 늘 무채색 둥근 사각형이다. */
export function faceOf(handle: string, avatar: Avatar | null | undefined): Face {
  if (handle === HOST) return { shape: "square", color: null };
  const hash = fnv1a(handle);
  return {
    shape: known(SHAPES, avatar?.shape) ?? DERIVED_SHAPES[hash % DERIVED_SHAPES.length],
    color: known(COLORS, avatar?.color) ?? DERIVED_COLORS[Math.floor(hash / DERIVED_SHAPES.length) % DERIVED_COLORS.length],
  };
}

/** 32비트 FNV-1a — 짧은 handle에서도 모양 · 색이 고루 갈린다. 판이 바뀌어도 같은 값이어야 해서 손으로 둔다. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
