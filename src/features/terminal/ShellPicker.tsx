import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ShellPlace } from "./shell-registry";

/**
 * `+`가 「어디에 띄울까」를 묻는 메뉴(UI개선 결정 18 · 결정 24).
 *
 * **입구가 옮겨 다니는 동안 메뉴는 하나였다.** `+`가 선 자리가 세 번 갈렸다 — 가로 탭 줄의
 * 아이콘, 사이드바 가지와 셸 0개인 본문의 글자 있는 행, 그리고 다시 **탭 줄의 아이콘
 * 하나**(`ShellTabs` — 결정 7·19). 규격이 아주 달라(폭 없는 아이콘 대 글자 있는 행)
 * **열리는 것만** 여기 모아 둔 것이 그 왕복을 그대로 견뎠다.
 *
 * 판 3(#262)에서 메뉴 부품(`DropdownMenu`, Base UI Menu) 위에 다시 섰다. 줄 옮기기(↓/↑가 끝에서
 * 돈다 · Home/End · 글자 치기), Esc 닫기와 `+`로 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9)은
 * 부품이 한다. 여기 남은 것은 부품이 안 하는 둘이다 — **첫 줄 켜기**(S10)와 **Tab**.
 *
 * 셸도 xterm도 여기 없다 — 부르는 쪽과 같은 성질이라 DOM 없는 기본 환경에서 그대로 검사된다.
 */
function ShellPicker({
  trigger,
  locked,
  projects,
  defaultHint,
  onPick,
}: {
  /**
   * 메뉴를 여는 버튼(`+`). 부르는 쪽이 모양과 이름을 든 채로 넘기고, 여기서는 그것이 메뉴를 열게만
   * 한다 — 묻지 않는 `+`(프로젝트가 하나 이하)와 같은 버튼이 두 갈래로 갈리지 않게.
   */
  trigger: ReactElement;
  /**
   * 참이면 **여는 것만 막는다**(셸 상한). 버튼은 `aria-disabled`로 부르는 쪽이 이미 잠갔다 —
   * 트리거에 `disabled`를 주면 네이티브 `disabled`가 되어 잠긴 이유(`title`)가 안 뜬다.
   */
  locked: boolean;
  /** 이 Work의 프로젝트들. 부르는 쪽이 둘 이상일 때만 이 메뉴를 세운다. */
  projects: string[];
  /** 「모든 프로젝트」 옆에 옅게 보일 경로(`placeHint`). `null`이면 안 보인다. */
  defaultHint: string | null;
  /** 고른 자리. 메뉴는 고르면 스스로 닫힌다 — 닫힌 것(Esc·Tab·바깥)은 부르는 쪽이 알 일이 없다. */
  onPick: (place: ShellPlace) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);

  // **어떻게 열었든 맨 윗줄(「모든 프로젝트」)이 켜진 채 선다**(UI개선 결정 18, S10) — `+` → Enter
  // 한 번이 ⌘T와 같다(#222). Base UI는 키로 열 때만 첫 줄을 켜고, 마우스로 열면 카드 자신이 포커스를
  // 받는다(그것을 바꾸는 prop이 없다). 메뉴에서는 포커스가 곧 켜짐이라 첫 줄에 포커스를 준다.
  //
  // **열린 다음 프레임이다.** 열림 애니메이션이 끝난 뒤(`onOpenChangeComplete`)에 주면 그 100ms 사이의
  // `+` → Enter가 켜진 줄 없이 헛돈다. 부품이 카드에 주는 첫 포커스와는 겨루지 않는다 — 그쪽은 포커스가
  // 이미 카드 안으로 옮겨 갔으면 물러선다(FloatingFocusManager의 `shouldFocus`).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => firstRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        // 잠겼으면 여는 것만 막는다 — 누르기·Enter·↓ 어느 길로 와도 여기를 지난다.
        if (next && locked) {
          details.cancel();
          return;
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger ref={triggerRef} render={trigger} />
      <DropdownMenuContent
        // **Tab은 닫기만 하고 `+`로 돌아온다**(스토리 55, 지금 규칙). 부품의 기본은 Tab을 `+` **다음**
        // 자리로 보낸다 — 메뉴가 body 끝에 떠 있어서 사라지는 카드 안에서 다음 자리를 찾는 셈이라, 키보드가
        // 탭 줄을 건너뛴다. 그래서 이 메뉴만 Tab의 기본 동작을 막고 닫은 뒤 `+`에 포커스를 준다.
        // Shift+Tab도 같다(부품도 그 갈래는 `+`로 돌려준다).
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <DropdownMenuItem
          ref={firstRef}
          // 글자 치기가 맞춰 볼 이름 — 옅은 경로까지 이름에 섞이지 않게 적어 둔다.
          label="모든 프로젝트"
          onClick={() => onPick({ kind: "default" })}
        >
          <span className="min-w-0 truncate font-medium">모든 프로젝트</span>
          {/* **보이는 글자로만 둔다** — 항목의 접근성 이름에 경로가 섞이면 이름에 폴더 이름이
              붙고, 어휘가 거부한 낱말이 이름으로 읽힌다(CONTEXT.md). 글자는 부르는 쪽이 자리에서
              읽어 준다 — 여기에 그 이름을 적지 않는다(`placeHint`). */}
          {defaultHint && (
            <span aria-hidden className="ml-auto shrink-0 text-[11.5px] text-tertiary">
              {defaultHint}
            </span>
          )}
        </DropdownMenuItem>
        {projects.map((project) => (
          <DropdownMenuItem key={project} onClick={() => onPick({ kind: "project", project })}>
            <span className="min-w-0 flex-1 truncate font-medium">{project}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ShellPicker;
