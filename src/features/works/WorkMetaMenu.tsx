import { useEffect, useRef, useState } from "react";
import { Copy, Folder, GitBranch, Info, PanelTop } from "lucide-react";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useProjects } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import { relativeToWorkDir } from "./WorkInfo";
import { workDirRef, worktreeDirRef } from "./refs";
import type { WorkView } from "./types";

/**
 * 프로젝트들이 **한 base를 공유할 때만** 그 이름을 돌려준다.
 *
 * 브랜치 줄의 꼬리는 한 칸뿐인데 base는 프로젝트마다 다를 수 있다. 아무 값이나 하나
 * 골라 적으면 그 줄이 거짓을 말한다 — 프로젝트별 base를 제대로 보여주는 자리는 정보
 * 탭이고, 여기는 "한 줄로 말할 수 있을 때만 말한다".
 *
 * 목록이 아직 안 왔을 때와 등록이 사라진 프로젝트가 섞였을 때도 null이다. 셋을 같은
 * 값으로 묶어도 되는 것은 결과가 같기 때문이다 — 꼬리를 그리지 않는다.
 */
export function sharedBase(projects: ProjectView[] | undefined, slugs: string[]): string | null {
  if (!projects || slugs.length === 0) return null;
  const bases = slugs.map((slug) => projects.find((p) => p.slug === slug)?.baseBranch);
  const [first] = bases;
  if (first === undefined) return null;
  return bases.every((b) => b === first) ? first : null;
}

/**
 * ⓘ 팝오버의 본문 — 에이전트에게 작업을 넘길 때 가장 자주 집는 값 셋이다.
 *
 * **순수 표현이다.** 조회는 감싸는 메뉴가 한다 (WorkInfo와 같은 계약). 그래야 이 자리를
 * 프로바이더 없이 정적 마크업으로 볼 수 있다.
 *
 * 정보 탭을 대신하지 않는다 — 전체 메타(slug · 생성일 · 프로젝트별 base · 판/문서 수)는
 * 계속 그쪽에 있다. 여기 있는 것은 "한 클릭에 복사하고 싶은 것"만이다.
 */
export function WorkMetaRows({
  work,
  base,
  onCopy,
}: {
  work: WorkView;
  // 브랜치 줄의 꼬리에 적을 base. 한 줄로 말할 수 없으면 null이다 (위 sharedBase).
  base: string | null;
  onCopy: (text: string) => void;
}) {
  return (
    <>
      {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다.
          빈 줄로 남기면 누를 수는 있는데 아무것도 복사되지 않는 줄이 된다. */}
      {work.branch !== null && (
        <MetaRow
          glyph={<GitBranch className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
          value={work.branch}
          tail={base ? <span className="shrink-0 text-[11px] text-tertiary">{base}</span> : undefined}
          onCopy={onCopy}
        />
      )}
      <MetaRow
        glyph={<Folder className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
        value={workDirRef(work.slug)}
        onCopy={onCopy}
      />
      {/* **작업 폴더 기준으로 접는다.** 두 경로는 `~/.atelier/works/<slug>/`를 통째로
          공유해서, 288px 안에서 꼬리를 자르면 두 줄의 보이는 글자가 완전히 같아진다 —
          그 줄을 구분해 주는 유일한 부분만 잘려 나간다. 기준 행이 바로 위에 있으니
          여기를 그것에 상대로 적을 수 있다 (정보 탭과 같은 계약). */}
      {work.worktrees.map((worktree) => (
        <MetaRow
          key={worktree.project}
          glyph={<PanelTop className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
          value={worktreeDirRef(worktree.path)}
          relativeTo={workDirRef(work.slug)}
          onCopy={onCopy}
        />
      ))}
    </>
  );
}

// 줄 하나 — 행 전체가 복사 버튼이고 hover 시 복사 아이콘이 뜬다.
//
// **전체 값을 받아 꼬리를 여기서 만든다** (정보 탭의 PathRow와 같은 계약). 접힌 값을
// 받고 전체 값을 따로 받는 모양이었는데, 그러면 둘이 갈릴 수 있는 자리가 호출부마다
// 생긴다 — 한 줄을 빠뜨려도 타입은 통과하고, 화면은 멀쩡한데 클립보드로 나가는 것만
// 조용히 잘린다. 여기서 접으면 **나가는 값은 언제나 받은 값 그대로**라 갈릴 수가 없다.
//
// 다만 아래 onCopy(value) 한 줄에는 테스트가 없다 — 정적 마크업에 핸들러가 보이지 않아
// shown으로 바꿔도 207개가 전부 초록이다(실제로 변형해 확인했다). 없앤 것은 그물이 아니라
// **호출부마다 있던 구멍**이고, 남은 구멍은 이 한 줄 하나다.
function MetaRow({
  glyph,
  value,
  relativeTo,
  tail,
  onCopy,
}: {
  glyph: React.ReactNode;
  // 클립보드로 나가는 값. 화면에는 relativeTo만큼 접혀 보인다.
  value: string;
  // 접어서 보일 기준. **기준 행 자신은 받지 않는다** — 자기에 대해 접으면 빈 문자열이 된다.
  relativeTo?: string;
  // 없으면 복사 글리프가 온다. base처럼 늘 보여야 하는 꼬리가 있는 줄만 넘긴다.
  tail?: React.ReactNode;
  onCopy: (text: string) => void;
}) {
  const shown = relativeTo ? relativeToWorkDir(value, relativeTo) : value;
  return (
    <button
      type="button"
      title="복사"
      onClick={() => onCopy(value)}
      className="group flex h-[30px] items-center gap-[9px] rounded-[8px] px-2 text-left text-[13px] transition-colors hover:bg-state-1"
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{shown}</span>
      {tail ?? (
        <Copy
          className="size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
          strokeWidth={1.8}
        />
      )}
    </button>
  );
}

/**
 * 제목 옆 ⓘ — 자주 집는 값 셋을 한 클릭 거리에 둔다.
 *
 * 브레드크럼에 사는 이유는 이것이 **작업 그 자체의 신원**이기 때문이다: 오른쪽 패널이
 * 닫혀 있어도, 어느 탭을 보고 있어도 같은 자리에 있다. 패널 안에 두면 "지금 무엇을
 * 보고 있는가"에 딸린 값이 되어 버린다.
 */
function WorkMetaMenu({ work }: { work: WorkView }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { data: projects } = useProjects();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="작업 메타"
        aria-expanded={open}
        title="메타"
        className="icon-button-quiet text-tertiary"
      >
        {/* 글리프는 셸 nav(사이드바 토글·뒤로·앞으로)와 같은 16px이다 — 이 버튼들은 그것들과
            **한 줄에 나란히 선다.** 상자(24px)는 icon-button이 이미 맞춰 두었는데 글리프만
            작으면 같은 행에서 이쪽만 물러나 보인다. */}
        <Info className="size-4" strokeWidth={1.8} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={288}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-0.5 p-1.5"
        >
          {/* 누르면 닫는다 — 복사가 끝났다는 신호가 팝오버가 사라지는 것이다.
              토스트는 본문(SpecViewer)에 사는데 헤더는 그 바깥이라 여기서 띄울 수 없다. */}
          <WorkMetaRows
            work={work}
            base={sharedBase(projects, work.projects)}
            onCopy={(text) => {
              navigator.clipboard.writeText(text);
              setOpen(false);
            }}
          />
        </PopoverPortal>
      )}
    </span>
  );
}

export default WorkMetaMenu;
