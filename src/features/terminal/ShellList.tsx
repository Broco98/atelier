import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import {
  activeIdOf,
  atCap,
  shellCapNotice,
  shellRowName,
  shellRowStatus,
  shellsOf,
} from "./shell-registry";
import type { ShellsState } from "./shell-registry";

interface ShellListProps {
  /**
   * **앱 전체 상태다 — 이 목록의 것만 걸러서 받지 않는다.** 걸러 받으면 `atCap`이 이
   * 목록의 길이를 세게 되고, 상한 8이 화면마다 8이 된다(결정 30). 그리는 것만 `owner`로
   * 좁힌다. 가로 탭 줄(`ShellTabs`)과 같은 계약이다.
   */
  state: ShellsState;
  /** 이 목록이 그리는 화면. 패널은 Work 화면에만 있으므로 여기 `null`은 오지 않는다. */
  owner: string;
  /** 이 Work의 프로젝트들. 둘 이상이면 `+`가 어디에 띄울지 물어본다(결정 24). */
  projects: string[];
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onOpen: (project: string | null) => void;
}

// 작업 패널의 `shell` 탭 — 셸을 고르는 세로 목록이다(결정 42). 가로 탭 줄에서 옮겨 오면서
// **한 행이 두 줄이 됐다**(결정 45): 첫 줄은 `프로젝트 · 타이틀`(결정 46), 둘째 줄은 지금
// 상태 — 도는 셸은 어디서 떴는지, 끝난 셸은 어떻게 끝났는지.
//
// **셸도 xterm도 여기 없다** — 상태와 콜백만 받는 그림이라 DOM 없는 기본 환경에서
// renderToStaticMarkup으로 그대로 검사된다(ShellList.test.tsx). terminal-store를 import하면
// 그 성질이 사라진다: `@xterm/*`와 그 CSS가 따라 들어온다. 구독은 화면(WorksPage)이 한다.
//
// 모양은 새로 들이지 않는다. 행 하나는 이 패널의 spec 트리가 이미 푼 것과 같은 문제라
// (SpecTree.tsx의 파일 행) 그 구조를 그대로 따른다 — 배경을 가진 바깥 상자 + 형제 버튼 둘,
// 선택은 `selected-row`, 비선택 hover는 `hover:bg-state-1`. 같은 패널 안에 서는 두 목록이
// 다른 어휘를 쓰면 한쪽이 다른 종류의 것으로 읽힌다.
function ShellList({ state, owner, projects, onSelect, onClose, onOpen }: ShellListProps) {
  // 상한은 **앱 전체**, 그리는 것은 **이 화면**이다. 두 값이 같은 상태에서 다른 범위로
  // 나오는 것이 결정 30의 전부다.
  const full = atCap(state);
  const shells = shellsOf(state, owner);
  const activeId = activeIdOf(state, owner);

  // 프로젝트가 여럿인 Work에서만 `+`가 묻는다. 앵커가 그 행이라 여기 산다.
  const asks = projects.length > 1;
  const plusRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  return (
    // 세로 스크롤은 여기까지 — 탭 바는 패널 카드에 고정되어 항상 보인다. 규격은 spec 탭의
    // 스크롤 상자(SpecSection)와 같은 값이다: 탭을 오갈 때 내용이 좌우로 밀리면 안 된다.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      {/* 셸 0개인 화면이 실재한다 — 정상 종료한 셸이 목록에서 스스로 빠지기 때문이다
          (결정 48). 마지막 칸이 `exit`으로 사라진 자리에서는 새 셸이 저절로 뜨지 않으므로
          (`×`에서 물려받은 성질) 여기가 그때 보이는 전부다. 문구는 이 패널의 다른 빈 상태
          (「아직 spec 파일이 없어요」)와 같은 어투다 — 아래 `+` 행이 「여기서 만든다」를 잇는다. */}
      {shells.length === 0 && (
        <span className="px-2 py-1.5 text-[12.5px] text-tertiary">아직 셸이 없어요</span>
      )}

      {shells.map((shell) => {
        const active = shell.id === activeId;
        const name = shellRowName(shell);

        return (
          // 배경(선택·hover)은 이 바깥 상자가 갖는다. **가로 여백을 하나도 갖지 않는다** —
          // 바깥이 가진 padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무
          // 일이 없는 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것). 남는 것은
          // 오른쪽 끝 pr-1뿐이고, 그건 `×`를 행 가장자리에서 띄우는 값이라 어느 버튼에도
          // 넣을 수 없다 — spec 트리의 파일 행과 같은 자리다.
          //
          // hover는 **꺼진 가지 안에만** 둔다. selected-row가 자기 hover를 품으므로 함께
          // 얹으면 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고).
          <div
            key={shell.id}
            className={cn(
              "flex items-center rounded-[8px] pr-1 transition-colors",
              active ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
            )}
          >
            {/* 행을 누르면 그 셸이 켜지고 **본문이 terminal로 넘어간다**(결정 50) — 저쪽
                두 가지를 이 버튼이 함께 부르는 것이 아니라, 무엇을 할지는 화면이 정하고
                여기는 「이 행이 눌렸다」만 말한다. 트리에서 문서를 누르면 본문이 spec으로
                돌아가는 것과 같은 규칙이다.

                두 줄이라 items-center가 아니라 세로 flex다. 세로 여백을 이 버튼이 품는 것은
                바깥 상자가 여백을 갖지 않기 위해서다(위 주석). */}
            <button
              type="button"
              onClick={() => onSelect(shell.id)}
              className="flex min-w-0 flex-1 flex-col gap-px py-1.5 pl-2 pr-1.5 text-left"
            >
              <span className="w-full truncate text-[12.5px]">{name}</span>
              {/* 둘째 줄. 색을 직접 선언하므로 켜진 행의 selected-row 글자색에 안 덮인다 —
                  이 줄은 이름보다 한 단 뒤로 물러나 있어야 두 줄이 한 행으로 읽힌다. */}
              <span className="w-full truncate text-[11.5px] font-normal text-tertiary">
                {shellRowStatus(shell)}
              </span>
            </button>
            {/* 이름 버튼의 **형제**다. 중첩 button은 HTML에서 허용되지 않고, span role="button"
                으로 흉내내면 Tab으로 도달할 수 없다(SpecTree.test.tsx가 같은 것을 지킨다).
                셸을 죽이는 길은 여전히 이 `×` 하나다(결정 22) — 탭 줄이 걷히면서 Work 화면의
                그 길이 이리로 통째로 옮겨 왔다. */}
            <button
              type="button"
              aria-label={`${name} 닫기`}
              title="셸 닫기"
              onClick={() => onClose(shell.id)}
              className="icon-button-quiet shrink-0 text-tertiary"
            >
              <X className="size-3" strokeWidth={1.8} />
            </button>
          </div>
        );
      })}

      {/* `+`가 **행**이 되면서 잠긴 이유를 `title`(hover) 뒤에 숨길 필요가 없어졌다 —
          그 자리에 문장을 그냥 쓴다(결정 47). 가로 탭 줄이 hover에 숨겼던 것은 칸 하나에
          글자를 넣을 폭이 없어서였다.

          그래도 이 저장소의 잠근 버튼 관용구(disabled + pointer-events-none)를 쓰지 않는다:
          문장이 보이는 이상 잠금은 클릭만 막으면 되고, disabled는 이 행을 접근성 트리에서
          「누를 수 없는 것」으로 접어 문장까지 함께 흐리게 만든다. aria-disabled + 클릭 무시다. */}
      <button
        ref={plusRef}
        type="button"
        aria-label="셸 열기"
        aria-disabled={full || undefined}
        // 프로젝트를 묻는 `+`는 여는 버튼이 아니라 메뉴를 여는 버튼이다 — 눌렀는데 셸이
        // 안 뜨는 것이 정상인 유일한 경우라, 그 사실이 속성에 드러나야 한다.
        aria-haspopup={asks ? "menu" : undefined}
        aria-expanded={asks ? picking : undefined}
        onClick={() => {
          if (full) return;
          if (asks) setPicking((open) => !open);
          else onOpen(null);
        }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-[8px] pl-2 pr-1.5 text-left text-[12.5px] transition-colors",
          full ? "text-tertiary" : "text-muted-foreground hover:bg-state-1",
        )}
      >
        <Plus className="size-3 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{full ? shellCapNotice(state) : "새 셸"}</span>
      </button>

      {picking && (
        <PopoverPortal
          anchorRef={plusRef}
          // 왼쪽 맞춤이다 — 이 행이 패널 왼쪽 끝에 붙어 있어 오른쪽 맞춤이면 메뉴가 창
          // 밖으로 뻗는다(가로 탭 줄이 같은 이유로 같은 값을 쓴다).
          align="left"
          width={190}
          onClose={() => setPicking(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {projects.map((project) => (
            <button
              key={project}
              type="button"
              onClick={() => {
                setPicking(false);
                onOpen(project);
              }}
              className="flex h-8 w-full items-center rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{project}</span>
            </button>
          ))}
        </PopoverPortal>
      )}
    </div>
  );
}

export default ShellList;
