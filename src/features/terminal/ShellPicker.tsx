import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { PopoverPortal } from "@/components/ui/popover-portal";
import type { ShellPlace } from "./shell-registry";

/**
 * `+`가 「어디에 띄울까」를 묻는 메뉴(UI개선 결정 18 · 결정 24).
 *
 * **입구가 옮겨 다니는 동안 메뉴는 하나였다.** `+`가 선 자리가 세 번 갈렸다 — 가로 탭 줄의
 * 아이콘, 사이드바 가지와 셸 0개인 본문의 글자 있는 행, 그리고 다시 **탭 줄의 아이콘
 * 하나**(`ShellTabs` — 결정 7·19). 규격이 아주 달라(폭 없는 아이콘 대 글자 있는 행)
 * **열리는 것만** 여기 모아 둔 것이 그 왕복을 그대로 견뎠다.
 *
 * 셸도 xterm도 여기 없다 — 부르는 쪽과 같은 성질이라 DOM 없는 기본 환경에서 그대로 검사된다.
 */
function ShellPicker({
  anchorRef,
  projects,
  defaultHint,
  onPick,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** 이 Work의 프로젝트들. 부르는 쪽이 둘 이상일 때만 이 메뉴를 세운다. */
  projects: string[];
  /** 「모든 프로젝트」 옆에 옅게 보일 경로(`placeHint`). `null`이면 안 보인다. */
  defaultHint: string | null;
  /**
   * 골랐으면 그 자리, 바깥을 눌렀으면 `null`. **두 경우 다 메뉴는 닫힌다** — 닫기를
   * 따로 받지 않는 것은 부르는 쪽이 한쪽만 잊는 길을 없애기 위해서다.
   */
  onPick: (place: ShellPlace | null) => void;
}) {
  // 키보드는 **이 메뉴가 듣는다**(UI개선 스펙 §7) — 포커스가 메뉴 안에 있는 동안만 오므로 창 전체의
  // 단축키(⌘T·⌘1~9)와 겨루지 않는다. 항목은 DOM 순서가 곧 화면 순서다.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (step: number) => items[(at + step + items.length) % items.length]?.focus();
    switch (event.key) {
      // 끝에서 반대쪽 끝으로 돈다 — 안 돌면 마지막 프로젝트까지 ↓를 여럿 눌러야 한다.
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        // 포커스가 항목 밖이면 맨 아랫줄로 간다 — ↓가 맨 윗줄로 가는 것과 짝이다.
        if (at === -1) items[items.length - 1]?.focus();
        else move(-1);
        break;
      // Esc와 Tab은 **닫기만** 한다 — 바깥 클릭과 같은 `null`이다(Tab이 닫는 것은 메뉴 버튼의
      // 관례다). 둘 다 포커스를 `+`로 돌려준다: 메뉴가 body 끝에 떠 있어서, 안 돌려주면 포커스든
      // 항목이 사라지며 `<body>`로 떨어져 키보드가 길을 잃는다. Tab의 기본 동작은 아래에서 막는다 —
      // 막지 않으면 사라지는 카드 안에서 다음 자리를 찾아 어디로 갈지 정해지지 않는다.
      case "Escape":
      case "Tab":
        onPick(null);
        anchorRef.current?.focus();
        break;
      // Enter는 따로 안 받는다 — 항목이 `<button>`이라 브라우저가 클릭으로 바꾼다.
      default:
        return;
    }
    // 이 메뉴가 먹은 키는 위로 안 올린다 — 창 리스너(끌기 취소의 Esc 등)가 한 번 더 받지 않게.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <PopoverPortal
      anchorRef={anchorRef}
      // 왼쪽 맞춤이다. 기본값과 같지만 적어 둔다 — 두 입구 모두 자기 줄의 **왼쪽 끝**에
      // 서서, 오른쪽 맞춤이면 메뉴가 사이드바나 창 밖으로 뻗는다(실물에서 확인했다).
      align="left"
      width={190}
      onClose={() => onPick(null)}
      // 맨 윗줄(「모든 프로젝트」)이 **선택된 채** 열린다(UI개선 결정 18) — Enter 한 번이 ⌘T와 같다.
      // 자기 이펙트에서 주지 않는 이유는 팝오버의 그 콜백 주석이다(숨은 한 프레임).
      onPlaced={(card) => card.querySelector<HTMLElement>('[role="menuitem"]')?.focus()}
    >
      <div role="menu" onKeyDown={onKeyDown} className="flex flex-col gap-px p-[5px]">
        <Item onClick={() => onPick({ kind: "default" })}>
          <span className="min-w-0 truncate text-[12.5px] font-medium">모든 프로젝트</span>
          {/* **보이는 글자로만 둔다** — 항목의 접근성 이름에 경로가 섞이면 이름에 폴더 이름이
              붙고, 어휘가 거부한 낱말이 이름으로 읽힌다(CONTEXT.md). 글자는 부르는 쪽이 자리에서
              읽어 준다 — 여기에 그 이름을 적지 않는다(`placeHint`). */}
          {defaultHint && (
            <span aria-hidden className="ml-auto shrink-0 pl-2 text-[11.5px] text-tertiary">
              {defaultHint}
            </span>
          )}
        </Item>
        {projects.map((project) => (
          <Item key={project} onClick={() => onPick({ kind: "project", project })}>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{project}</span>
          </Item>
        ))}
      </div>
    </PopoverPortal>
  );
}

function Item({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      // 항목 사이는 화살표로 옮긴다 — Tab 순서에는 안 선다(한 번의 Tab이 메뉴를 닫는다).
      tabIndex={-1}
      onClick={onClick}
      // **포커스도 호버와 같은 바탕이다**(UI개선 결정 18 「맨 윗줄이 선택된 채」). 마우스로 연 메뉴에 준
      // 스크립트 포커스는 `:focus-visible`에 안 걸려 윤곽이 안 그려진다 — 그래서 `focus:`다.
      className="flex h-8 w-full items-center rounded-[9px] px-[9px] text-left outline-none transition-colors hover:bg-state-2 focus:bg-state-2"
    >
      {children}
    </button>
  );
}

export default ShellPicker;
