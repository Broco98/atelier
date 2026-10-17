import { useRef, useState } from "react";
import { CircleAlert, GitFork, ChevronRight } from "lucide-react";
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
 * 제자리 편집 자리(git 정보가 없을 때의 기준 브랜치)의 도움말. 이미 `<button>`이라 `title` 예외(S29 — 버튼이 아닌 자리)가
 * 아니다 — 앱 툴팁이다. 이름은 보이는 값이고, 누르면 편집이 열린다는 이 말은 이름보다 더 말하는 하는 일이라
 * 설명(`aria-description`)으로도 남는다(S28). 프로젝트 이름은 여기서 고치지 않는다 — 머리 카드의 이름과 목록 행이 그 자리에서
 * 고친다(codex-ds 스펙 S12 · §9).
 */
const EDIT_HELP = "클릭해서 편집";

interface ProjectDetailProps {
  project: ProjectView;
  // null = 선택 변경 없이 Works 화면으로 이동
  onOpenWork: (slug: string | null) => void;
}

function ProjectDetail({ project, onOpenWork }: ProjectDetailProps) {
  return (
    // 상세 칸의 몸(DS `.at-thread` · `SettingsGroup`의 틀) — 글 폭(`size-thread` 48rem) 가운데에 서고 위 24 · 아래 40이다. 옆의 글
    // 거터 20은 이 상자 밖(구르는 쪽 — `ProjectsPage`의 상세 칸)이 든다 — 글자가 서는 폭이 48rem 그대로라 설정 틀(`SettingsBody`) ·
    // 문서 글(`SpecViewer`의 `bodyColumn`)과 같은 나눔이다(DS `size-thread` 「문서 · 설정 글 폭 상한」). 구획 사이는 28이다(DS
    // `.at-set`). 칸이 글 폭 + 거터 둘보다 좁으면 칸 끝에서 20 들어와 선다.
    <div className="mx-auto flex w-full max-w-(--size-thread) flex-col gap-7 pt-6 pb-10">
      {/* 경로를 못 찾은 프로젝트의 빨간 띠 — 경고 부품(Alert)의 모양이다. 글자는 그대로다. */}
      {project.missing && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>경로를 찾을 수 없어요.</AlertTitle>
          <AlertDescription>
            폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나
            직접 제거하세요.
          </AlertDescription>
        </Alert>
      )}

      {/* 속성 — DS `List`(흰 묶음 · 0.5px 고리 · 행 44 · 행 사이 0.5px 선). 이름 열 96이고 값은 고정폭 `text-code`다. */}
      <dl className={LIST}>
        <PropertyRow label="경로">
          <span className={cn("truncate", project.missing && "text-danger line-through")}>
            {project.path}
          </span>
        </PropertyRow>
        {project.git?.remoteSlug && (
          <PropertyRow label="원격">
            <span className="truncate">{project.git.remoteSlug}</span>
          </PropertyRow>
        )}
        <PropertyRow label="baseBranch">
          {/* 칩(셀렉트 칩 · 인라인 편집기)의 글자를 위 줄의 값들과 같은 세로선에 세운다 — 칩의 좌우 안쪽(7px)만큼 당긴다.
              칩의 모양은 부품 그대로이고, 이것은 그 칩을 이 열에 앉히는 자리 맞춤이다. */}
          <div className="-ml-1.75 flex min-w-0">
            <BaseBranchControl key={project.slug} project={project} />
          </div>
        </PropertyRow>
      </dl>

      <DescriptionEditor key={project.slug} project={project} />

      <WorksSection projectSlug={project.slug} onOpenWork={onOpenWork} />
    </div>
  );
}

/**
 * 구획 제목(DS `.at-set-sec > h2`) — 이름(`text-sm` · 600, 왼쪽 2) 뒤에 곁글(`text-xs` · `fg-secondary`)이 한 줄에 선다. 묶음과는
 * 10 떨어진다(`Section`). `end`는 오른쪽 끝의 조작이다.
 */
function Subhead({ title, note, end }: { title: string; note: string; end?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 pl-0.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-fg-secondary">{note}</span>
      {end}
    </div>
  );
}

/** 구획(DS `.at-set-sec`) — 구획 제목과 그 묶음이 10 사이로 선다. 구획 사이(28)는 상세 칸의 몸이 든다. */
function Section({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col gap-2.5">{children}</section>;
}

/**
 * 흰 목록 묶음(DS `List` · `.at-list` — `SettingsGroup`의 묶음과 같은 얼굴) — 흰 면 · `radius-xl` · 0.5px `border-heavy` 고리. 넘침을
 * 숨기지 않는다 — 행의 포커스 링(테두리 바깥 4px)이 묶음 끝에서 잘린다. 그래서 행의 hover 면은 첫 행 · 끝 행이 묶음의 모서리를 제
 * 모서리로 든다(`LIST_ROW`).
 */
const LIST = "flex flex-col rounded-xl bg-surface ring-[0.5px] ring-border-heavy";

/**
 * 묶음의 행(DS `.at-li`) — 44 이상 · 안쪽 8 14 · 사이 10 · `text-sm`. 둘째 행부터 윗변에 0.5px `border-heavy` 선이 선다 — 테두리가
 * 아니라 면으로 칠한다(0.5px 테두리는 엔진마다 굵기가 갈린다).
 */
const LIST_ROW =
  "relative flex min-h-11 min-w-0 items-center gap-2.5 px-3.5 py-2 text-sm first:rounded-t-xl last:rounded-b-xl not-first:before:absolute not-first:before:inset-x-0 not-first:before:top-0 not-first:before:h-[0.5px] not-first:before:bg-border-heavy";

// 이 프로젝트에서 시작된 작업 목록 (목업 S2의 Works 란) — 작업 전부에서 이 프로젝트에 걸친 것만 거른다.
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
    <Section>
      <Subhead
        title="Works"
        note="이 프로젝트에서 시작된 작업"
        end={
          <button
            type="button"
            onClick={() => onOpenWork(null)}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-tertiary transition-colors quiet-hover focus-ring"
          >
            Works에서 모두 보기
            <ChevronRight className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />
          </button>
        }
      />
      {/* 흰 목록 묶음(DS `List`). 빈 묶음도 같은 면 안에서 행 하나 높이의 글이다. */}
      <div className={LIST}>
        {related.length === 0 ? (
          <div className={cn(LIST_ROW, "text-chat-meta text-fg-tertiary")}>이 프로젝트로 시작된 작업이 아직 없어요.</div>
        ) : (
          related.map((work) => {
            const worktree = work.worktrees.find((t) => t.project === projectSlug);
            return (
              <button
                key={work.slug}
                type="button"
                onClick={() => onOpenWork(work.slug)}
                // 흰 묶음 위의 행이라 hover는 `fill-soft`다(DS `.at-li:hover`).
                className={cn(LIST_ROW, "w-full text-left transition-colors hover:bg-fill-soft focus-ring")}
              >
                <StatusIcon status={work.status} />
                <span
                  className={cn(
                    "min-w-0 truncate",
                    work.status === "done" && "text-fg-secondary",
                  )}
                >
                  {work.title}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  {worktree?.exists && (
                    <span className="flex items-center gap-1.25 font-mono text-xs text-fg-secondary">
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
    </Section>
  );
}

/** 속성 한 줄 — 흰 묶음의 행(`LIST_ROW` · DS `.at-li`)에 이름(96 · `chat-meta`)과 값이 선다. */
function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={LIST_ROW}>
      <dt className="w-24 shrink-0 text-chat-meta text-fg-secondary">{label}</dt>
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
        className="flex h-7 items-center rounded-lg px-1.75 font-mono text-code text-fg-secondary transition-colors quiet-hover focus-ring"
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
    <Section>
      {/* 「클릭해서 편집」은 지금 글 그대로다(판 06 문구 표 P1). */}
      <Subhead title="설명" note="클릭해서 편집" />
      {editing ? (
        // 고치는 동안의 칸 — 설명 상자와 같은 자리 · 같은 반경(12) · 같은 글자다. 상자의 고리는 폭을 안 먹는 0.5px이고 이 칸의
        // 테두리는 1px이라, 그만큼 안쪽을 덜어 글자가 상자일 때의 자리에 그대로 선다. 포커스는 앱의 한 링(`focus-ring`)이다.
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
          className="min-h-12 resize-y rounded-xl border border-border-heavy bg-surface px-3.75 py-2.75 text-sm outline-none placeholder:text-fg-tertiary focus-ring"
        />
      ) : (
        // 설명 상자 — 흰 묶음(DS `SettingsGroup`의 `.at-set-group` — 흰 면 · `radius-xl` · 0.5px 고리)에 안쪽 12 · 16이다. 흰 면 위라
        // hover는 `fill-soft`다. 누르면 그 자리가 칸이 된다.
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            LIST,
            "px-4 py-3 text-left text-sm transition-colors hover:bg-fill-soft focus-ring",
            !project.description && "italic text-fg-tertiary",
          )}
        >
          {project.description || "아직 설명이 없어요. 이 프로젝트가 무엇인지 적어 주세요."}
        </button>
      )}
    </Section>
  );
}

export default ProjectDetail;
