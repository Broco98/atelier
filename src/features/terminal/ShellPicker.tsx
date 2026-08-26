import type { RefObject } from "react";
import { PopoverPortal } from "@/components/ui/popover-portal";

/**
 * `+`가 「어디에 띄울까」를 묻는 메뉴(결정 24).
 *
 * **입구가 여럿이어도 메뉴는 하나다.** 지금 `+ 새 셸` 행이 서는 자리는 사이드바 가지와
 * 셸 0개인 터미널 본문 둘인데(결정 71·102), 둘 다 `ShellList`의 같은 행이라 규격이 갈릴
 * 자리가 없다. 한때는 가로 탭 줄의 아이콘 `+`가 세 번째 입구였고 규격이 아주 달라
 * (폭 없는 아이콘 하나 vs 글자 있는 행) **열리는 것만** 여기 모았다 — 그 줄은 걷혔지만
 * 이유는 그대로다: 입구가 다시 늘어도 메뉴가 갈리지 않는다.
 *
 * 셸도 xterm도 여기 없다 — 부르는 쪽과 같은 성질이라 DOM 없는 기본 환경에서 그대로 검사된다.
 */
function ShellPicker({
  anchorRef,
  projects,
  onPick,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** 이 Work의 프로젝트들. 부르는 쪽이 둘 이상일 때만 이 메뉴를 세운다. */
  projects: string[];
  /**
   * 골랐으면 그 프로젝트, 바깥을 눌렀으면 `null`. **두 경우 다 메뉴는 닫힌다** — 닫기를
   * 따로 받지 않는 것은 부르는 쪽이 한쪽만 잊는 길을 없애기 위해서다.
   */
  onPick: (project: string | null) => void;
}) {
  return (
    <PopoverPortal
      anchorRef={anchorRef}
      // 왼쪽 맞춤이다. 기본값과 같지만 적어 둔다 — 두 입구 모두 자기 줄의 **왼쪽 끝**에
      // 서서, 오른쪽 맞춤이면 메뉴가 사이드바나 창 밖으로 뻗는다(실물에서 확인했다).
      align="left"
      width={190}
      onClose={() => onPick(null)}
      className="flex flex-col gap-px p-[5px]"
    >
      {projects.map((project) => (
        <button
          key={project}
          type="button"
          onClick={() => onPick(project)}
          className="flex h-8 w-full items-center rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{project}</span>
        </button>
      ))}
    </PopoverPortal>
  );
}

export default ShellPicker;
