import { cn } from "@/lib/utils";
import { SignalNote, type CallingNote } from "@/components/shell/shell-signal";
import type { ProjectView } from "@/features/projects/types";
import { formatCreated, STATUS_BADGE, STATUS_META } from "./status";
import type { WorkView } from "./types";

/** 카드의 프로젝트 줄 하나 — 프로젝트마다 base와 「변경 있음」이다(codex-ds 결정 25). */
export interface ProjectLine {
  project: string;
  /** 등록된 프로젝트의 base 브랜치. 등록이 없거나 base가 비었으면 `null`이고, 그 줄은 이름만 선다. */
  base: string | null;
  /** 그 워크트리에 커밋 안 된 변경이 있다(work 목록의 값). */
  dirty: boolean;
}

/**
 * work의 워크트리마다 프로젝트 줄 하나. **워크트리 목록만 돈다** — 코어가 워크트리를 프로젝트에서 1:1로 만들어 개수도 순서도
 * 같고, 각 항목이 이름과 변경을 든다. base는 프로젝트 목록에서 찾는다.
 *
 * **`??`가 아니라 `||`다.** 코어가 빈 `base_branch`를 막지 않아(`atelier_edit_project`에 검증이 없다) `""`가 올 수 있다 — 그것도
 * 「말할 base가 없다」로 접어, 뒤에 아무것도 없는 화살표가 서지 않게 한다.
 */
export function projectLines(work: WorkView, projects: ProjectView[]): ProjectLine[] {
  return work.worktrees.map((worktree) => ({
    project: worktree.project,
    base: projects.find((project) => project.slug === worktree.project)?.baseBranch || null,
    dirty: worktree.dirty,
  }));
}

// 사이드바 행에 마우스를 올리면 뜨는 정보 카드. **제 파일로 선 조각이다** — 이 카드는 hover로만
// 마운트돼서 목록을 그려서는 닿을 수 없다. 조각으로 서 있으면 정적 마크업으로 직접 그릴 수 있다 —
// **그래서 훅을 부르지 않는다**(목록이 `WorkSectionList`를 따로 내보낸 것과 같은 계약이다).
// 프로바이더 없이 그려지는 이 자리가 카드의 그물이다(WorkCard.test.tsx).

// 정보 전용이다 — 누를 수 있는 것을 넣지 않는다. 클릭 대상이 생기면 마우스가 행에서 카드로
// 건너가는 경로(safe triangle)를 살려둬야 하고, 열림 상태의 소유가 행에서 카드로 넘어간다.
//
// 알려진 한계: 키보드로는 이 카드에 닿을 수 없다. 키보드로 작업을 고르는 경로(팔레트)에서는
// 이 정보가 보이지 않는다. 감수한다. 그 가운데 **셸의 마지막 말**만은 키보드에도 닿는다 — 같은
// 값이 행 버튼의 접근성 설명으로도 붙는다(`sidebar-active-band` 결정 14, `WorkSectionList`의 행).
export function WorkCard({
  work,
  note,
  projects,
}: {
  work: WorkView;
  /**
   * 부르는 셸이 한 말(결정 14). **값으로 받는다** — 이 카드는 훅을 안 부르는 조각이라 스스로
   * 고르지 못하고, 고르는 자리는 사이드바 하나다(레인·메타·설명과 같은 셸). 없으면 `null`이고
   * 그때 말 칸이 통째로 없다(S6).
   */
  note: CallingNote | null;
  /**
   * 프로젝트 줄(`projectLines`). 이것도 **값으로 받는다** — 카드를 여는 자리가 프로젝트 목록을 읽는다(codex-ds 스펙 S15).
   * 아직 못 읽었으면 `null`이고, 그동안 「프로젝트」 칸은 work 목록에서 아는 이름들을 한 줄로 잇는다.
   */
  projects: ProjectLine[] | null;
}) {
  const meta = STATUS_META[work.status];
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-chat-meta font-medium">{work.title}</span>
      <span className="flex items-center gap-2">
        <span className={cn(STATUS_BADGE, meta.badgeClass)}>{meta.label}</span>
        <span className="text-xs text-fg-tertiary">{formatCreated(work.createdAt)}</span>
      </span>
      {/* **상태 배지 줄 아래, 필드 표 위**다(결정 14). 배지는 work의 상태이고 이 칸은 그 work에서
          지금 나를 부르는 셸의 말이라, 둘이 붙어 서야 「무엇이 · 왜」가 한 번에 읽힌다. 필드 표는
          선 아래의 안 변하는 사실이다. */}
      {note && <SignalNote {...note} />}
      {/* 표 위의 선은 0.5px `border-heavy` 한 줄이다(DS `.at-peek .fields`). 테두리가 아니라 면으로 칠한다 — 0.5px 테두리는
          엔진마다 굵기가 갈린다(문서의 가름선 · 메뉴 구분선과 같다). 표의 윗변에 겹쳐 그려 높이를 먹지 않는다. */}
      <div
        data-card-fields=""
        className="relative flex flex-col gap-1 pt-2.5 text-xs before:absolute before:inset-x-0 before:top-0 before:h-[0.5px] before:bg-border-heavy"
      >
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다. */}
        <CardField label="브랜치" muted={work.branch === null} mono={work.branch !== null}>
          {work.branch ?? "프로젝트가 붙으면 정해져요"}
        </CardField>
        {/* 프로젝트 줄은 프로젝트마다 하나이고, 「프로젝트」 이름은 첫 줄에만 선다(DS `HoverCard`). */}
        {projects && projects.length > 0 ? (
          projects.map((line, at) => (
            <ProjectField key={line.project} label={at === 0 ? "프로젝트" : ""} line={line} />
          ))
        ) : (
          <CardField label="프로젝트" muted={work.projects.length === 0}>
            {work.projects.length === 0 ? "아직 없어요" : work.projects.join(", ")}
          </CardField>
        )}
        <CardField label="spec">{`${work.specFiles.length}개`}</CardField>
      </div>
    </div>
  );
}

// 필드 표의 이름 칸 — 46px 열이라 값 칸이 줄마다 같은 세로선에 선다(DS `.at-peek .f .k`).
const FIELD_LABEL = "w-[46px] shrink-0 text-fg-tertiary";

// 프로젝트 한 줄 — 이름 · `← base` · 「변경 있음」(DS `HoverCard` — `.at-peek .f .b` · `.chg`). 변경이 없으면 「변경 없음」이라 적지
// 않고 비운다(한때 info 칸이 하던 그대로다). 이름과 base는 고정폭이 아니다 — 브랜치 칸만 고정폭이다(DS).
function ProjectField({ label, line }: { label: string; line: ProjectLine }) {
  return (
    <span data-project-line={line.project} className="flex min-w-0 items-baseline gap-2">
      <span className={FIELD_LABEL}>{label}</span>
      <span className="min-w-0 truncate text-fg-secondary">
        {line.project}
        {line.base !== null && <span className="text-fg-tertiary">{` ← ${line.base}`}</span>}
      </span>
      {line.dirty && (
        <span className="ml-auto flex shrink-0 items-center gap-1.25 self-center text-fg-secondary">
          <span data-change-dot="" aria-hidden className="size-1.25 rounded-full bg-dot-created" />
          변경 있음
        </span>
      )}
    </span>
  );
}

function CardField({
  label,
  muted = false,
  mono = false,
  children,
}: {
  label: string;
  muted?: boolean;
  mono?: boolean;
  children: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={FIELD_LABEL}>{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          muted ? "text-fg-tertiary" : "text-fg-secondary",
          mono && "font-mono",
        )}
      >
        {children}
      </span>
    </span>
  );
}
