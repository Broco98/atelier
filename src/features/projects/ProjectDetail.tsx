import { useRef, useState } from "react";
import { CircleAlert, Folder, GitFork, GitMerge, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorks } from "@/features/works/hooks";
import { formatCreated, StatusIcon } from "@/features/works/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

/**
 * 제자리 편집 자리 둘(제목 · git 정보가 없을 때의 기준 브랜치)의 도움말. 둘은 이미 `<button>`이라 `title` 예외
 * (S29 — 버튼이 아닌 자리)가 아니다 — 앱 툴팁이다. 이름은 보이는 값이고, 누르면 편집이 열린다는 이 말은 이름보다
 * 더 말하는 하는 일이라 설명(`aria-description`)으로도 남는다(S28).
 */
const EDIT_HELP = "클릭해서 편집";

interface ProjectDetailProps {
  project: ProjectView;
  // null = 선택 변경 없이 Works 화면으로 이동
  onOpenWork: (slug: string | null) => void;
}

function ProjectDetail({ project, onOpenWork }: ProjectDetailProps) {
  return (
    // 상세 카드의 몸(DS `.at-card-body` · `.at-read`) — 좌우 · 아래는 카드 안 여백(`--card-pad`)이고, 글은 그 안에서 읽는 폭
    // (`--measure-read`) 가운데에 선다(ui-refresh 결정 12). 여백을 폭 상자 밖에 두어 글 폭이 여백을 뺀 값으로 줄지 않는다.
    <div className="px-(--card-pad) pb-(--card-pad)">
      <div className="mx-auto flex w-full max-w-(--measure-read) flex-col">
        {/* 경로를 못 찾은 프로젝트의 빨간 띠 — 경고 부품(Alert)의 모양이다. 글자는 그대로다. */}
        {project.missing && (
          <Alert variant="destructive" className="mt-[18px]">
            <CircleAlert />
            <AlertTitle>경로를 찾을 수 없어요.</AlertTitle>
            <AlertDescription>
              폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나
              직접 제거하세요.
            </AlertDescription>
          </Alert>
        )}

        <h1 className="mb-5 mt-[18px]">
          <TitleEditor key={project.slug} project={project} />
        </h1>
        {/* 속성(DS `.at-props`) — 이름 열 112 · 줄 28 · 줄 사이 4. 값은 고정폭 `text-code`다. */}
        <dl className="flex flex-col gap-1">
          <PropertyRow icon={<Folder className="size-3.5 text-fg-tertiary" />} label="경로">
            <span className={cn("truncate", project.missing && "text-danger line-through")}>
              {project.path}
            </span>
          </PropertyRow>
          {project.git?.remoteSlug && (
            <PropertyRow icon={<GitMerge className="size-3.5 text-fg-tertiary" />} label="원격">
              <span className="truncate">{project.git.remoteSlug}</span>
            </PropertyRow>
          )}
          <PropertyRow icon={<GitFork className="size-3.5 text-fg-tertiary" />} label="baseBranch">
            {/* 칩(셀렉트 칩 · 인라인 편집기)의 글자를 위 줄의 값들과 같은 세로선에 세운다 — 칩의 좌우 안쪽(7px)만큼 당긴다.
                칩의 모양은 부품 그대로이고, 이것은 그 칩을 이 열에 앉히는 자리 맞춤이다. */}
            <div className="-ml-[7px] flex min-w-0">
              <BaseBranchControl key={project.slug} project={project} />
            </div>
          </PropertyRow>
        </dl>

        <DescriptionEditor key={project.slug} project={project} />

        <WorksSection projectSlug={project.slug} onOpenWork={onOpenWork} />
      </div>
    </div>
  );
}

/**
 * 카드 안 소제목(DS `.at-subhead`) — 이름(`text-chat-meta` · 600) 뒤에 곁글(`text-xs` · `fg-secondary`)이 한 줄에 선다.
 * 위 28 · 아래 10이 구획 사이의 리듬이다. `end`는 오른쪽 끝의 조작이다.
 */
function Subhead({ title, note, end }: { title: string; note: string; end?: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-baseline gap-2">
      <h2 className="text-chat-meta font-semibold">{title}</h2>
      <span className="text-xs text-fg-secondary">{note}</span>
      {end}
    </div>
  );
}

/** 카드 안 묶음(ui-refresh 결정 16) — 옅은 면 · 큰 반경 · 테두리 없음. 행 사이에도 선이 없다. */
const GROUP = "rounded-2xl bg-surface-under";

// 이 프로젝트에서 시작된 작업 목록 (목업 S2의 Works 란)
function WorksSection({
  projectSlug,
  onOpenWork,
}: {
  projectSlug: string;
  onOpenWork: (slug: string | null) => void;
}) {
  const { data: works = [] } = useWorks();
  const related = works.filter((w) => w.projects.includes(projectSlug));

  return (
    <div className="flex flex-col">
      <Subhead
        title="Works"
        note="이 프로젝트에서 시작된 작업"
        end={
          <button
            type="button"
            onClick={() => onOpenWork(null)}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-tertiary transition-colors quiet-hover"
          >
            Works에서 모두 보기
            <ChevronRight className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />
          </button>
        }
      />
      {/* 묶음 안쪽 6 · 행 40 · 모서리 10(DS `.at-group` · `.at-group-row`). 빈 묶음도 같은 면 안에서 행 하나 높이의 글이다. */}
      <div className={cn(GROUP, "flex flex-col p-1.5")}>
        {related.length === 0 ? (
          <div className="flex min-h-10 items-center px-3 text-chat-meta text-fg-tertiary">
            이 프로젝트로 시작된 작업이 아직 없어요.
          </div>
        ) : (
          related.map((work) => {
            const worktree = work.worktrees.find((t) => t.project === projectSlug);
            return (
              <button
                key={work.slug}
                type="button"
                onClick={() => onOpenWork(work.slug)}
                // 옅은 면 위의 행이라 hover는 `fill-hover`다(ui-refresh 결정 16, DS `.at-group-row:hover`) — 흰 카드 위 목록
                // 행의 `fill-soft`보다 한 단 위이고, info 맨 위 묶음 행과 같은 값이다.
                className="flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-3 text-left transition-colors hover:bg-fill-hover"
              >
                <StatusIcon status={work.status} />
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    work.status === "done" && "text-fg-secondary",
                  )}
                >
                  {work.title}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  {worktree?.exists && (
                    <span className="flex items-center gap-[5px] font-mono text-xs text-fg-secondary">
                      <GitFork className="size-3" />
                      {work.branch}
                    </span>
                  )}
                  <span className="text-xs text-fg-tertiary tabular-nums">{formatCreated(work.createdAt)}</span>
                  <ChevronRight className="size-3.5" />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// 표시 이름 인라인 편집 — slug는 바뀌지 않는다 (스펙 #3)
//
// 작업 이름 바꾸기 창(works/WorkRenameDialog.tsx)이 같은 입력 규칙을 쓴다 — Enter 확정, Escape 취소,
// 공백·동일 값 미저장, 두 번 커밋되는 것을 막는 finished 가드. 여기 로직을 고치면 그쪽도 같이 봐야 한다.
// **갈리는 것 하나**: 여기서는 blur가 확정이지만 그 창에서는 바깥 누르기가 취소다(판 3 P7) — 창 밖을 누른
// 것은 「그만두겠다」로 읽힌다. 이 인라인 편집기는 그대로 둔다(결정 8은 작업 이름 바꾸기에 한한다).
function TitleEditor({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== project.name) {
      updateProject.mutate({ slug: project.slug, patch: { name: value } });
    }
  };

  if (!editing) {
    return (
      <Hint
        text={EDIT_HELP}
        announce="description"
        type="button"
        onClick={() => {
          finished.current = false;
          setDraft(project.name);
          setEditing(true);
        }}
        className="-mx-2 -my-1 max-w-full truncate rounded-lg px-2 py-1 text-left text-heading-lg transition-colors hover:bg-fill-hover"
      >
        {project.name}
      </Hint>
    );
  }
  return (
    <Input
      variant="inline-title"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center">
      <dt className="flex w-28 shrink-0 items-center gap-2 text-chat-meta text-fg-secondary">
        {icon}
        {label}
      </dt>
      {/* 값의 색은 `fg-secondary`다 — 기준 브랜치 줄의 셀렉트 칩(부품의 글자색)과 한 열에서 갈리지 않게. */}
      <dd className="flex min-w-0 flex-1 items-center font-mono text-code text-fg-secondary">{children}</dd>
    </div>
  );
}

function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const branches = project.git?.localBranches ?? [];

  if (branches.length === 0) {
    return <InlineBranchEditor key={project.slug} project={project} />;
  }

  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];

  // **목록에서 고른다**(스토리 67·68). 방향키 · 글자 치기 · Esc 닫기와 트리거로 포커스 돌려주기는 부품(Select)이
  // 한다. 지금 값은 `listbox`의 선택됨으로 읽히고, 체크는 보이는 쪽의 말일 뿐이다. 카드는 트리거 아래로 뜬다
  // (부품의 기본 — 트리거 맞춤을 껐다, S32). 트리거는 판 03의 셀렉트 칩 그대로다 — 여기서 모양을 덮지 않는다.
  return (
    <Select
      value={project.baseBranch}
      onValueChange={(branch) => {
        // **값이 바뀔 때만 저장한다**(지금 규칙). 지금 값을 다시 고른 것은 닫기만 한다.
        if (branch !== null && branch !== project.baseBranch) {
          updateProject.mutate({ slug: project.slug, patch: { baseBranch: branch } });
        }
      }}
    >
      {/* 이름은 「기준 브랜치」다 — 여는 버튼이 `combobox`가 되어 글자(지금 값)가 이름이 되지 못한다. 없는
          프로젝트의 입력칸과 같은 이름이다(S37). 두 칸은 한 프로젝트에 하나만 선다.
          도움말 「브랜치 목록에서 변경」은 툴팁이다. 옛 `title`이 이름 다음에 읽어 주던 하는 일이라 설명
          (`aria-description`)으로도 남는다(S28 — `combobox`는 목록이 열린다는 것까지만 말하고, 고르면 이 값이
          바뀐다는 것은 말하지 않는다). */}
      <Hint
        text="브랜치 목록에서 변경"
        announce="description"
        render={<SelectTrigger aria-label="기준 브랜치" />}
      >
        <SelectValue className="font-mono" />
      </Hint>
      <SelectContent
        header={
          <div className="flex h-8 items-center justify-between border-b px-3">
            <span className="text-chat-meta font-semibold text-fg-secondary">브랜치</span>
            <span className="text-xs text-fg-tertiary">{options.length}개</span>
          </div>
        }
        footer={
          <div className="border-t px-3 py-2 text-xs text-fg-tertiary">
            baseBranch 설정만 바꿔요 — checkout은 하지 않아요
          </div>
        }
      >
        {options.map((branch) => (
          <SelectItem key={branch} value={branch}>
            <span className="font-mono text-fg-secondary">{branch}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// git 브랜치 정보가 없을 때 — 클릭해서 직접 편집
function InlineBranchEditor({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.baseBranch);
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== project.baseBranch) {
      updateProject.mutate({ slug: project.slug, patch: { baseBranch: value } });
    }
  };

  if (!editing) {
    return (
      <Hint
        text={EDIT_HELP}
        announce="description"
        type="button"
        onClick={() => {
          finished.current = false;
          setDraft(project.baseBranch);
          setEditing(true);
        }}
        // 목록이 서는 프로젝트의 셀렉트 칩(`SelectTrigger`)과 같은 모양이다 — 28px · 모서리 10 · 좌우 7 · 조용한 hover. 값은
        // 옆 줄들과 같은 고정폭 `text-code`다.
        className="flex h-7 items-center rounded-lg px-[7px] font-mono text-code text-fg-secondary transition-colors quiet-hover"
      >
        {project.baseBranch}
      </Hint>
    );
  }
  return (
    <Input
      variant="inline-chip"
      className="w-[150px]"
      autoFocus
      // 이름표가 없던 칸이다(S37) — 옆 줄의 「baseBranch」 글자는 이 칸과 묶여 있지 않다. 목록이 서는 프로젝트의
      // 여는 버튼과 같은 이름이다.
      aria-label="기준 브랜치"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

function DescriptionEditor({ project }: { project: ProjectView }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.description);
  const updateProject = useUpdateProject();
  // 키보드로 편집을 끝낸 뒤 언마운트 blur가 한 번 더 들어와도 무시하기 위한 가드
  const finished = useRef(false);

  const startEditing = () => {
    finished.current = false;
    setDraft(project.description);
    setEditing(true);
  };

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (commit && draft !== project.description) {
      updateProject.mutate({ slug: project.slug, patch: { description: draft } });
    } else if (!commit) {
      setDraft(project.description);
    }
  };

  return (
    <div className="flex flex-col">
      {/* 「클릭해서 편집」은 지금 글 그대로다(판 06 문구 표 P1). */}
      <Subhead title="설명" note="클릭해서 편집" />
      {editing ? (
        // 고치는 동안의 칸 — 설명 상자와 같은 자리 · 같은 반경(16) · 같은 글자다. 테두리 1px만큼 안쪽을 덜어 글자가
        // 상자일 때의 자리에 그대로 선다. 포커스는 판 03 입력칸의 것(테두리 `accent` + 3px 옅은 링)이다.
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) finish(true);
            if (e.key === "Escape") finish(false);
          }}
          rows={3}
          placeholder="이 프로젝트가 무엇인지, 왜 등록했는지 적어 주세요"
          className="min-h-12 resize-y rounded-2xl border border-border-heavy bg-surface px-[15px] py-[13px] text-sm outline-none placeholder:text-fg-tertiary focus:border-(--accent) focus:ring-3 focus:ring-(--accent)/20"
        />
      ) : (
        // 설명 상자 — 옅은 면 묶음(ui-refresh 결정 16, DS `.at-group.pad`)에 안쪽 14 · 16이다. 누르면 그 자리가 칸이 된다.
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            GROUP,
            "px-4 py-3.5 text-left text-sm transition-colors hover:bg-fill-hover",
            !project.description && "italic text-fg-tertiary",
          )}
        >
          {project.description || "아직 설명이 없어요. 이 프로젝트가 무엇인지 적어 주세요."}
        </button>
      )}
    </div>
  );
}

export default ProjectDetail;
