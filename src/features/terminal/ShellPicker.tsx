import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
 * **작업공간 화면에서는 「새 탭」 메뉴다**(restart 02a-8 · 구현 스펙 「02a」 — +와 ⌘T 메뉴 맨 위에 「새 채팅」). `onNewChat`을 주면 맨 윗줄이 「새 채팅」이고
 * 그 아래에 셸 줄이 선다 — 프로젝트가 하나 이하면 「새 셸」 한 줄, 둘 이상이면 「새 셸」 머리 아래 「모든 프로젝트」와 프로젝트 줄이다. `+` → Enter
 * 한 번이 ⌘T와 같다는 규칙(#222)이 그대로라 ⌘T는 「새 채팅」이다. 이 메뉴는 셸 상한에도 열린다 — 새 채팅은 상한과 무관하고, 셸 줄만 꺼지고
 * 머리가 잠긴 이유를 말한다.
 *
 * 셸도 xterm도 여기 없다 — 부르는 쪽과 같은 성질이라 DOM 없는 기본 환경에서 그대로 검사된다.
 */
function ShellPicker({
  trigger,
  locked,
  notice = null,
  projects,
  defaultHint,
  onPick,
  onNewChat,
}: {
  /**
   * 메뉴를 여는 버튼(`+`). 부르는 쪽이 모양과 이름을 든 채로 넘기고, 여기서는 그것이 메뉴를 열게만
   * 한다 — 묻지 않는 `+`(프로젝트가 하나 이하)와 같은 버튼이 두 갈래로 갈리지 않게.
   */
  trigger: ReactElement;
  /**
   * 참이면 **여는 것만 막는다**(셸 상한). 버튼은 `aria-disabled`로 부르는 쪽이 이미 잠갔다 —
   * 트리거에 `disabled`를 주면 네이티브 `disabled`가 되어 잠긴 이유(툴팁)가 안 뜬다(S23).
   */
  locked: boolean;
  /** 잠긴 이유(셸 상한의 문장) — 「새 탭」 메뉴(`onNewChat`)에서 셸 줄 머리에 선다. 잠기지 않았으면 `null`이다. */
  notice?: string | null;
  /** 이 Work의 프로젝트들. 「새 탭」 메뉴가 아니면 부르는 쪽이 둘 이상일 때만 이 메뉴를 세운다. */
  projects: string[];
  /** 「모든 프로젝트」 옆에 옅게 보일 경로(`placeHint`). `null`이면 안 보인다. */
  defaultHint: string | null;
  /** 고른 자리. 메뉴는 고르면 스스로 닫힌다 — 닫힌 것(Esc·Tab·바깥)은 부르는 쪽이 알 일이 없다. */
  onPick: (place: ShellPlace) => void;
  /** 「새 채팅」 — 주면 「새 탭」 메뉴다(작업공간 화면). 맨 윗줄이 이것이고 셸 상한에도 열린다. */
  onNewChat?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // 셸 줄이 「모든 프로젝트」와 프로젝트 줄로 갈리는가 — 둘 이상일 때만이다. 「새 탭」 메뉴에서 하나 이하면 「새 셸」 한 줄이다.
  const asks = projects.length > 1;
  // 셸을 못 여는 동안(상한) — 「새 탭」 메뉴는 열리고 셸 줄만 꺼진다. 셸 메뉴는 여는 것을 막는다(아래 `onOpenChange`).
  const shellsOff = onNewChat !== undefined && locked;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);

  // **어떻게 열었든 맨 윗줄(「모든 프로젝트」)이 켜진 채 선다**(UI개선 결정 18, S10) — `+` → Enter
  // 한 번이 ⌘T와 같다(#222). Base UI는 키로 열 때만 첫 줄을 켜고, 마우스로 열면 카드 자신이 포커스를
  // 받는다(그것을 바꾸는 prop이 없다). 메뉴에서는 포커스가 곧 켜짐이라 첫 줄에 포커스를 준다.
  //
  // **열린 다음 프레임이다.** 열림 애니메이션이 끝난 뒤(`onOpenChangeComplete`)에 주면 그 사이(30ms 지연 +
  // `duration-dropdown` — `dropdown-menu.tsx`의 `MenuCard`)의 `+` → Enter가 켜진 줄 없이 헛돈다. 부품이 카드에 주는 첫 포커스와는 겨루지 않는다 — 그쪽은 포커스가
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
        // 잠겼으면 여는 것만 막는다 — 누르기·Enter·↓ 어느 길로 와도 여기를 지난다. 「새 탭」 메뉴는 막지 않는다 — 새 채팅은 상한과 무관하다.
        if (next && locked && onNewChat === undefined) {
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
        {/* 「새 탭」 메뉴의 맨 윗줄 — 「새 채팅」(restart 02a-8). ⌘T가 이 줄이다(`+` → Enter 한 번이 ⌘T와 같다, #222). */}
        {onNewChat && (
          <>
            <DropdownMenuItem ref={firstRef} label="새 채팅" shortcut="newTab" onClick={onNewChat}>
              <span className="min-w-0 truncate">새 채팅</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          {/* 셸 줄의 머리 — 「새 탭」 메뉴에서 셸 줄이 여럿이거나 꺼졌을 때만 선다. 꺼졌으면 머리가 잠긴 이유다. */}
          {onNewChat && (asks || shellsOff) && <DropdownMenuLabel>{shellsOff && notice ? notice : "새 셸"}</DropdownMenuLabel>}
          <DropdownMenuItem
            ref={onNewChat ? undefined : firstRef}
            disabled={shellsOff}
            // 글자 치기가 맞춰 볼 이름 — 옅은 경로까지 이름에 섞이지 않게 적어 둔다.
            label={asks || !onNewChat ? "모든 프로젝트" : "새 셸"}
            onClick={() => onPick({ kind: "default" })}
          >
            <span className="min-w-0 truncate">{asks || !onNewChat ? "모든 프로젝트" : "새 셸"}</span>
            {/* **보이는 글자로만 둔다** — 항목의 접근성 이름에 경로가 섞이면 이름에 폴더 이름이
                붙고, 어휘가 거부한 낱말이 이름으로 읽힌다(CONTEXT.md). 글자는 부르는 쪽이 자리에서
                읽어 준다 — 여기에 그 이름을 적지 않는다(`placeHint`). */}
            {defaultHint && (
              <span aria-hidden className="ml-auto shrink-0 text-xs text-fg-tertiary">
                {defaultHint}
              </span>
            )}
          </DropdownMenuItem>
          {asks &&
            projects.map((project) => (
              <DropdownMenuItem key={project} disabled={shellsOff} onClick={() => onPick({ kind: "project", project })}>
                <span className="min-w-0 flex-1 truncate">{project}</span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ShellPicker;
