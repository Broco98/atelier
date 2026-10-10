// **아이콘 선은 여기 한 자리에서 정한다**(codex-ds 결정 27 · 스펙 S3). Codex 규격은 16px에서 1.5px 선이고, 모양은 lucide 그대로다.
//
// 값은 lucide의 24칸(viewBox) 단위라 아이콘 크기에 비례한다 — 16px에서 1.5px, 12px에서 1.125px, 17px에서 1.59px.
// DS가 함께 적은 「`strokeWidth={1.5}` + `absoluteStrokeWidth`」는 `size` prop이 16일 때만 이 값과 같다: lucide의
// `absoluteStrokeWidth`는 굵기에 `24 / size`를 곱하는데, 이 앱은 크기를 클래스(`size-4` · 부품의 `[&_svg]:size-4` ·
// `menu-row`의 15px)로 주고 `size` prop을 쓰지 않는다 — 그 둘을 쓰면 16px 아이콘이 1.0px로 그려진다.
// DS 자신의 아이콘 묶음(`bundle.css`의 `.ic-*`)도 24칸 2.25로 그린다.
//
// 앱의 lucide 기본값은 `main.tsx`의 `LucideProvider`가 `ICON_STROKE`로 준다. 호출부는 굵기를 고르지 않는다 —
// 다르게 주는 것은 DS가 따로 정한 아래 두 값뿐이고, 그 밖의 굵기는 `src/icon-stroke.test.ts`가 막는다.

/** 기본 — 16px에서 1.5px. 호출부가 아무것도 안 주면 이것이다. */
export const ICON_STROKE = 2.25;

/** 12px 이하의 셰브런 · × · +에 DS가 따로 주는 값(24칸 2.4)이다. ✓도 같다 — DS 묶음의 `.ic-check`가 2.4다. */
export const SMALL_GLYPH_STROKE = 2.4;

/** 상태 아이콘(`StatusIcon`, DS `ic-st-*`) — lucide가 아닌 14칸 svg라 그 칸의 단위로 2다. */
export const STATUS_ICON_STROKE = 2;
