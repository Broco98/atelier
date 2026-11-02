import { createLucideIcon } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * spec 칸의 아이콘 — 둥근 문서 한 장(restart 02a-14 · 스토리 81 · 시안 Shell 「spec 아이콘」의 적용안 `ic-docs` — 위 짧은 줄, 둥근 모서리
 * 3.5의 몸, 글줄 둘). lucide에 같은 모양이 없어 시안의 24칸 그림을 그대로 옮겼다. 선 굵기는 앱 기본(`LucideProvider` — 16에서 1.5)을
 * 받는다 — 시안 그림은 24칸 2이지만 앱의 아이콘 선은 한 자리에서 정한다(`icon-stroke.ts`, DS 묶음도 2.25다).
 */
export const SpecGlyph = createLucideIcon("spec-docs", [
  ["path", { d: "M8 3.5h8", key: "top" }],
  ["rect", { x: "4", y: "7.5", width: "16", height: "13", rx: "3.5", key: "sheet" }],
  ["path", { d: "M8.5 12.25h7", key: "line-1" }],
  ["path", { d: "M8.5 15.75h4", key: "line-2" }],
]);

/**
 * 레일 카드의 박자(시안 `.ra-rail` · Motion 「레일이 들고 난다」) — 폭과 왼쪽 틈은 spec 패널과 같은 500ms spring이라(`PANEL_MOTION`) 본문
 * 폭이 한 박자로 옮겨 가 튀지 않는다. 옅음은 `duration-panel`(220) 기본 곡선이다. **접힐 때만** 보임이 폭이 다 걷힌 뒤(500ms) 꺼진다 —
 * 서는 쪽은 보임이 곧바로 켜져야 자라는 동안 보인다. 클래스는 글자 그대로 적는다 — Tailwind가 소스의 글자를 읽는다(`panel-layout`의
 * `FOLD_BEATS`와 같은 까닭). 동작 줄이기면 곧바로다(시안 `.ra-rail { transition: none }`).
 */
const RAIL_BEAT = {
  shown:
    "transition-[width,margin-left,opacity] duration-[var(--duration-panel-open),var(--duration-panel-open),var(--duration-panel)] ease-[var(--ease-spring),var(--ease-spring),var(--ease-default)]",
  hidden:
    "transition-[width,margin-left,opacity,visibility] duration-[var(--duration-panel-open),var(--duration-panel-open),var(--duration-panel),0s] ease-[var(--ease-spring),var(--ease-spring),var(--ease-default),linear] delay-[0s,0s,0s,var(--duration-panel-open)]",
} as const;

/**
 * 레일이 받는 것 — 서는가 · 패널이 열렸나 · 칸을 누름 · 가리키는 패널.
 */
export interface RailProps {
  /** 작업공간이 서 있나 — 아니면 폭 0으로 접힌다(아래 머리말). */
  shown: boolean;
  /** spec 패널이 열렸나 — 칸의 켜짐이다. */
  open: boolean;
  /** 칸을 눌렀다 — spec 패널을 여닫는다(오른쪽 자리의 `toggle spec` — 패널 토글 · ⌘Enter와 같은 일이다). */
  onPick: () => void;
  /** 칸이 여닫는 패널의 id(`aria-controls`). */
  controls: string;
}

/**
 * 레일(restart 02a-14 · 스토리 80 · 81 · 82 · 시안 Shell 「레일」 · Main `.ra-rail` · Motion 「레일이 들고 난다」) — 카드 자리 오른쪽 끝의
 * 세로 카드다. **작업공간의 도구다** — 칸은 `spec` 하나(둥근 문서 아이콘)이고 누르면 spec 패널이 열리고 다시 누르면 닫힌다. 패널이 닫혀도
 * 레일은 남는다 — 닫힌 패널을 다시 여는 길이 여기다.
 *
 * **작업공간에서만 선다.** 앱 셸의 작업공간 도구 자리가 화면이 바뀌어도 이 카드를 그대로 두고(`WorkTools`), 작업공간이 서면 폭 0 → 32로
 * 자라고 떠나면 spec 패널과 함께 접힌다. 접힌 동안은 보이지도 눌리지도 포커스되지도 않는다(`inert` · 보임은 폭이 다 걷힌 뒤 꺼진다).
 * 한때 칸이 `spec` · `files` 둘이었고(git-integration 결정 29) 칸이 둘 이상일 때만 섰다(codex-ds 결정 25) — files 칸이 걷혀(파일은 넓힌
 * 카드의 Project 트리에서 연다, restart 02a-12) 칸은 하나다.
 *
 * **레일 카드가 곧 칸 묶음이다**(시안 `.ra-rail` — `role="group"`). 둥글기는 `radius-rail`(6)이고 면 · 링은 다른 카드와 같다(`surface` ·
 * `shadow-hairline`). 폭은 DS 줄 폭 `size-prail`(32)이고 안쪽 2 안에 28 칸이 선다. 본문 카드 · spec 패널 카드와는 왼쪽 틈 8(`ml-2`)로 갈린다.
 * 이름은 「레일」이다 — 패널(`작업공간 패널`)과 다르다(같으면 「작업공간 패널」로 집는 자리가 둘이 된다).
 *
 * **칸은 탭도 라디오도 아니다** — `aria-pressed` 버튼이다. 켜짐은 「패널이 열렸다」이고 다시 누르면 꺼진다. Tab 정류장임을 `tabIndex`로
 * 명시한다(WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다, `@/lib/roving` 머리말). 켜짐 면은 칸 뒤에 따로 깔린 면(`data-rail-on` —
 * 시안 `.ra-rail-ind`, `tool-rail-on`)이 옅음으로 들고 나고, 켜진 칸은 제 면 없이 글리프만 `fg`로 진해진다 — hover해도 그대로다. 꺼진 칸은
 * `fg-tertiary`이고 hover에 `fill-soft` 면과 `fg`다.
 *
 * **`aside`도 `nav`도 아니다**(시안 Shell 「규칙」). `aside`는 사이드바와 오른쪽 패널뿐이고 `nav`는 사이드바 버튼을 집는 고리다. 패널
 * 토글은 레일이 아니라 머리 줄 오른쪽 끝에 선다(`PanelToggle`).
 */
function Rail({ shown, open, onPick, controls }: RailProps) {
  return (
    <div
      role="group"
      aria-label="레일"
      data-show={shown}
      inert={!shown}
      className={cn(
        "relative flex shrink-0 flex-col items-center overflow-hidden rounded-rail bg-surface py-0.5 motion-reduce:transition-none",
        shown
          ? cn("ml-2 w-(--size-prail) p-0.5 opacity-100 shadow-hairline", RAIL_BEAT.shown)
          : cn("pointer-events-none invisible ml-0 w-0 px-0 opacity-0 shadow-none", RAIL_BEAT.hidden),
      )}
    >
      <span
        aria-hidden
        data-rail-on={open}
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 size-7 rounded-ctl bg-tool-rail-on transition-opacity motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <Hint
        text="spec"
        announce="name"
        type="button"
        onClick={onPick}
        aria-pressed={open}
        aria-controls={controls}
        tabIndex={0}
        className={cn(
          "relative mb-1 flex size-7 shrink-0 items-center justify-center rounded-ctl transition-colors focus-ring",
          open ? "bg-transparent text-fg" : "text-fg-tertiary hover:bg-fill-soft hover:text-fg",
        )}
      >
        <SpecGlyph className="size-4" />
      </Hint>
    </div>
  );
}

export default Rail;
