import { useEffect, useRef, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Check,
  ChevronDown,
  Folder,
  List,
  LoaderCircle,
  MoreHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/shell/PageHeader";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useProjects } from "@/features/projects/hooks";
import SpecViewer from "./SpecViewer";
import {
  useArchiveWork,
  useRemoveWork,
  useSetWorkStatus,
  useSetWorkTitle,
  useWorks,
} from "./hooks";
import { STATUS_META } from "./status";
import type { WorkStatus, WorkView } from "./types";

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서와 그것을 옮기는 길. 둘 다 주소가 정본이라 여기서 소유하지 않는다.
  // `push`는 히스토리 항목을 만들지 여부다 — 트리는 만들지 않고 문서 링크는 만든다.
  currentFile: string | null;
  onSelectFile: (path: string, push: boolean) => void;
  onOpenProject: (slug: string) => void;
}

function WorksPage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelectFile,
  onOpenProject,
}: WorksPageProps) {
  const { data: works = [] } = useWorks();
  // 앱을 처음 켠 사람이 가장 먼저 보는 화면이 여기다. 프로젝트가 하나도 없으면
  // "새 작업을 시켜라"는 안내를 그대로 따라 해도 실패한다 — 그때는 등록으로 유도한다.
  //
  // isPending을 함께 보는 이유: 이 화면이 앱의 첫 화면이 되면서 프로젝트 목록을 처음 읽는
  // 자리도 여기가 됐다. 길이만 보면 "아직 안 왔다"를 "하나도 없다"로 읽어, 이미 등록해 둔
  // 사람에게 매 실행마다 등록하라는 안내가 한 프레임 스친다.
  const { data: projects = [], isPending: projectsPending } = useProjects();
  const needsProject = !projectsPending && works.length === 0 && projects.length === 0;

  // 생애주기 조작은 ⋯ 메뉴가 부르지만 **상태는 여기서 소유한다** — 진행 표시가 메뉴 하나가
  // 아니라 본문 전체를 덮기 때문이다. 메뉴 안에 두면 그 표시를 메뉴 크기 안에서만 할 수 있다.
  const archive = useArchiveWork();
  const remove = useRemoveWork();
  const running = archive.isPending
    ? { verb: "아카이빙", detail: "워크트리를 정리하고 있어요" }
    : remove.isPending
      ? { verb: "삭제", detail: "워크트리와 스펙 문서를 지우고 있어요" }
      : null;
  // 목업 2026-07-19 개정: [소스]·작업 패널 토글은 브레드크럼 소유
  const [showSource, setShowSource] = useState(false);
  const [workPanelOpen, setWorkPanelOpen] = useState(true);

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널이 물려받는다.
  // 입력 중에는 무시.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      setWorkPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // "기본 선택은 초안을 건너뛴다"는 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Works"
          leaf={selected && <TitleEditor key={selected.slug} work={selected} />}
          // 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 본문이 창 왼쪽 끝에 붙는다
          inset={!sidebarOpen}
          meta={
            selected && (
              <span className="ml-1.5 flex shrink-0 items-center gap-2">
                <StatusMenu work={selected} />
                <span className="flex gap-1.5">
                  {selected.projects.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onOpenProject(p)}
                      title="프로젝트 상세로 이동"
                      className="rounded-[7px] bg-accent px-2 py-[3px] text-[12px] text-muted-foreground transition-colors hover:bg-inset hover:text-foreground"
                    >
                      {p}
                    </button>
                  ))}
                </span>
                <WorkMenu work={selected} archive={archive} remove={remove} />
              </span>
            )
          }
          actions={
            <>
              {selected && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSource((v) => !v)}
                    className={cn(
                      "h-6 rounded-[8px] px-[9px] text-[12.5px] transition-colors",
                      showSource
                        ? "toggle-on"
                        : "text-tertiary hover:bg-state-2 hover:text-foreground",
                    )}
                  >
                    소스
                  </button>
                  {/* 이 화면의 유일한 접이식이다 — 본문 확대 단축키(⌘Enter)도 여기로 온다 */}
                  <button
                    type="button"
                    onClick={() => setWorkPanelOpen((v) => !v)}
                    aria-label="작업 패널 토글"
                    aria-expanded={workPanelOpen}
                    title={workPanelOpen ? "작업 패널 접기" : "작업 패널 펼치기"}
                    className={cn(
                      "icon-button transition-colors",
                      workPanelOpen
                        ? "toggle-on"
                        : "text-tertiary hover:bg-state-2 hover:text-foreground",
                    )}
                  >
                    <List className="size-3.5" strokeWidth={2} />
                  </button>
                </span>
              )}
            </>
          }
        />
        {selected ? (
          <SpecViewer
            key={selected.slug}
            work={selected}
            showSource={showSource}
            panelOpen={workPanelOpen}
            sidebarOpen={sidebarOpen}
            file={currentFile}
            onSelectFile={onSelectFile}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-10">
            <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
              <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
                {needsProject ? (
                  <Folder className="size-5" strokeWidth={1.6} />
                ) : (
                  <Zap className="size-5" strokeWidth={1.6} />
                )}
              </div>
              <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
                {needsProject ? "먼저 프로젝트를 등록해요" : "아직 작업이 없어요"}
              </span>
              <span className="text-[14px] leading-[1.65] text-tertiary">
                {needsProject
                  ? "작업은 등록된 프로젝트 위에서 시작돼요. Projects에서 폴더를 고르거나, 에이전트에게 맡겨도 돼요."
                  : "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요."}
              </span>
              {/* 실제로 통하는 경로만 안내한다 — CLI에는 등록·시작 명령이 없고, 에이전트가
                  atelier_add_project / atelier_start_work를 부른다.
                  아래 문구는 그대로 붙여 넣는 것이다. */}
              <code className="mt-3 select-all rounded-[10px] border bg-inset px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
                {needsProject ? "atelier에 이 폴더 등록해줘" : 'atelier로 "새 작업" 시작해줘'}
              </code>
            </div>
          </div>
        )}

        {running && <LifecycleOverlay verb={running.verb} detail={running.detail} />}
      </main>
    </div>
  );
}

// 되돌릴 수 없는 조작이 도는 동안 본문을 덮는다.
//
// 워크트리 제거는 폴더 크기에 비례해 수 초가 걸린다(실측 8.9GB). 그동안 화면이 아무 말도
// 하지 않으면 **버튼이 안 눌린 것처럼 보이고**, 사이드바에는 그 작업이 아직 그대로 있어
// 더 그렇다. 덮는 것 자체도 목적이다 — 진행 중에 같은 작업을 다시 겨누지 못하게 한다.
//
// 헤더까지 덮는다. ⋯ 버튼이 거기 있고, 그것을 다시 누르는 것이 막아야 할 바로 그 동작이다.
// 사이드바는 덮지 않는다 — 이 조작은 본문이 보여주는 작업 하나에만 걸린다.
function LifecycleOverlay({ verb, detail }: { verb: string; detail: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-2">
        <LoaderCircle className="size-6 animate-spin text-primary" strokeWidth={2} />
        <span className="mt-1 text-[15px] font-semibold tracking-[-0.01em]">{verb} 중…</span>
        <span className="text-[13px] text-tertiary">{detail}</span>
      </div>
    </div>
  );
}

// 브레드크럼 말단 제목 인라인 편집 — slug는 바뀌지 않는다 (ProjectDetail의 TitleEditor와 같은 계약).
// 감싸는 PageHeader의 leaf span이 truncate/overflow:hidden이라 두 상태 모두 max-w-full로 스스로 줄어든다.
//
// ProjectDetail 쪽과 달리 **음수 마진을 쓰지 않는다.** 그쪽 부모는 평범한 h1이지만 여기 부모는
// 잘라내므로, 왼쪽으로 삐져나온 만큼이 그대로 클립된다 — outline-none이라 유일한 포커스 표시인
// 입력의 왼쪽 테두리가 사라진다. 대신 패딩만 쓰고 두 상태의 좌측 정렬을 서로 맞춘다.
function TitleEditor({ work }: { work: WorkView }) {
  const setTitle = useSetWorkTitle();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(work.title);
  // blur와 Enter가 함께 들어와 두 번 커밋되는 것을 막는다
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    // 재조회가 돌아오기 전에 편집 모드를 먼저 끝낸다 — draft가 새 값과 싸우지 않게
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== work.title) {
      setTitle.mutate({ slug: work.slug, title: value });
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="클릭해서 편집"
        onClick={() => {
          finished.current = false;
          setDraft(work.title);
          setEditing(true);
        }}
        className="max-w-full truncate rounded-[7px] px-1.5 py-0.5 text-left transition-colors hover:bg-state-2"
      >
        {work.title}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="w-full min-w-0 rounded-[7px] border border-primary bg-background px-1.5 py-0.5 text-[14px] font-medium outline-none"
    />
  );
}

// 브레드크럼 상태 배지 + 변경 드롭다운
function StatusMenu({ work }: { work: WorkView }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const setStatus = useSetWorkStatus();
  const meta = STATUS_META[work.status];

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
        title="상태 변경"
        className={cn(
          "flex h-[22px] items-center gap-1 rounded-[7px] px-2 text-[12px] font-medium transition-[filter] hover:brightness-95",
          meta.badgeClass,
        )}
      >
        {meta.label}
        <ChevronDown className="size-2.5" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {(Object.keys(STATUS_META) as WorkStatus[]).map((status) => {
              const option = STATUS_META[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (status !== work.status) {
                      setStatus.mutate({ slug: work.slug, status });
                    }
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
                >
                  <span className={cn("size-[7px] shrink-0 rounded-full", option.dotClass)} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {option.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-tertiary">{option.desc}</span>
                  {status === work.status && (
                    <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                  )}
                </button>
              );
            })}
        </PopoverPortal>
      )}
    </span>
  );
}

// 생애주기 조작 — 뷰 토글이 모인 우측 actions가 아니라 StatusMenu 옆에 산다.
// 둘 다 되돌릴 수 없어서 네이티브 확인을 거치고, 거절 사유(커밋 안 된 변경 등)는
// 코어가 파일 단위로 말해주므로 그대로 보여준다.
//
// 성공 뒤에 선택을 옮기지 않는다 — 목록 무효화로 이 작업이 사라지면 -works-view.tsx의
// 정규화(`exists`가 false가 되는 경로)가 주소까지 함께 옮긴다. 여기서 또 옮기면 같은 일을
// 두 곳이 하게 되고, 그쪽이 "사라진 작업" 일반을 이미 담당한다.
function WorkMenu({
  work,
  archive,
  remove,
}: {
  work: WorkView;
  // 상태를 위에서 받는다 — 진행 표시가 본문 전체를 덮으므로 소유자가 WorksPage다
  archive: ReturnType<typeof useArchiveWork>;
  remove: ReturnType<typeof useRemoveWork>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const busy = archive.isPending || remove.isPending;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 다른 작업으로 옮겨가면 닫는다. ⌘1~9와 목록 클릭은 이 컴포넌트를 다시 마운트하지 않으므로,
  // 열어 둔 채 전환하면 메뉴가 살아남아 **화면에 보이는 것과 다른 작업**을 겨눈다.
  useEffect(() => setOpen(false), [work.slug]);

  // 진행 중에는 다시 부르지 않는다. 두 번째 호출은 이미 옮겨진 작업을 찾지 못해 실패하는데,
  // 성공한 아카이빙 위에 "아카이빙하지 못했습니다" 창이 뜨는 것이 그 결과다.
  const run = async (
    verb: string,
    detail: string,
    call: () => Promise<unknown>,
  ) => {
    setOpen(false);
    if (busy) return;
    const ok = await confirm(detail, { title: `'${work.title}' ${verb}`, kind: "warning" });
    if (!ok) return;
    try {
      await call();
    } catch (e) {
      await message(`${verb}하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  // 문구는 실제로 남는 것과 사라지는 것을 **둘 다** 말한다. 아카이빙 쪽만 "보존"을 말하면
  // 대비로 인해 삭제가 커밋까지 지우는 것처럼 읽히고(브랜치는 양쪽 다 남는다), 워크트리
  // 제거가 gitignore된 파일(.env·로컬 DB·빌드 산출물)까지 가져간다는 사실은 **양쪽 다**
  // 적는다. 그 파일들은 dirty 검사에 잡히지 않으므로 이 문구가 유일한 경고이고, 둘 다
  // 같은 worktree_remove를 탄다 — 삭제 쪽은 스펙까지 지우니 더 잃는다.
  const handleArchive = () =>
    run(
      "아카이빙",
      "스펙과 기록은 남고 워크트리 폴더가 정리돼요. 브랜치와 커밋은 그대로예요.\n" +
        "다만 git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)은 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => archive.mutateAsync(work.slug),
    );

  const handleRemove = () =>
    run(
      "삭제",
      "워크트리 폴더와 스펙 문서가 모두 지워져요. 브랜치와 커밋은 남지만 기록은 안 남아요 —\n" +
        "남길 것이 있다면 아카이빙을 쓰세요.\n" +
        "git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)도 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => remove.mutateAsync(work.slug),
    );

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="작업 메뉴"
        aria-expanded={open}
        aria-busy={busy}
        title={busy ? "처리 중이에요" : "작업 메뉴"}
        className={cn(
          "flex h-[22px] items-center rounded-[7px] px-1.5 transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          open ? "bg-accent text-foreground" : "text-tertiary hover:bg-accent hover:text-foreground",
        )}
      >
        {/* 진행 표시는 여기가 아니라 본문을 덮는 LifecycleOverlay가 한다 — 14px 글리프의
            깜빡임은 워크트리 제거가 도는 수 초 동안 "눌리긴 했나"에 답하지 못했다.
            disabled는 그대로 둔다: 오버레이가 뜨기 전 한 프레임을 막는 것도 이 속성이다. */}
        <MoreHorizontal className="size-3.5" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          <button
            type="button"
            onClick={handleArchive}
            className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
          >
            <Archive className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">아카이빙</span>
          </button>
          <span className="my-[3px] h-px bg-border" />
          <button
            type="button"
            onClick={handleRemove}
            className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">삭제</span>
          </button>
        </PopoverPortal>
      )}
    </span>
  );
}

export default WorksPage;
