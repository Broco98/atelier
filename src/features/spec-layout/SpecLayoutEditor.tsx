import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Eye,
  File,
  Folder,
  IndentDecrease,
  IndentIncrease,
  Plus,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { showProblem } from "@/components/ui/confirm-store";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { settingsItem } from "@/features/settings/pages";
import { SPEC_ICONS, specIconOf, type SpecIconName } from "@/features/works/spec-icons";
import { layoutDirRef } from "@/features/works/refs";
import { armDrag, cancelDrag, dragStore, type DragPoint } from "@/lib/pointer-drag";
import { cn } from "@/lib/utils";
import { modeNameOf, type Mode } from "@/mode";
import {
  addEntry,
  dropEntry,
  dropPlaceAt,
  editsAt,
  entryAt,
  isFolder,
  moveEntry,
  removeEntry,
  samePath,
  setDescription,
  setIcon,
  setKind,
  setPattern,
  setTemplate,
  setTemplateBody,
  unsaved,
  within,
  type DropPlace,
  type DropTarget,
  type EntryMove,
  type EntryPath,
  type LayoutDraft,
  type TreeEdit,
} from "./draft";
import { specLayoutReadQuery, useDraftPreview, useWriteSpecLayout } from "./hooks";
import { useConfirmLeave } from "./leave";
import { contentOf, judgeOutside, savedBaseline, type BannerVerdict } from "./outside";
import { canSave } from "./preview";
import PreviewDialog from "./PreviewDialog";
import type {
  LayoutEntryJson,
  LayoutError,
  SpecLayoutRead,
  TemplateBodies,
  UnreadableSpecLayout,
} from "./types";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11 · 결정 11·20·26). 설정 한 열(620px) 안이 아니라 설정 nav
// 항목 「spec 레이아웃」의 하위 주소(`/settings/spec-layout/<id>`)에 선 **별도 화면**이다 — 트리와 고른 항목,
// 두 열이 설정 한 열에 들지 않는다. 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다.
//
// **이 화면의 주된 쓰임은 마지막 손질이다**(결정 20). 레이아웃은 대부분 에이전트가 고치고, 사람은 여기서
// 한 칸을 고친다. 그래서 머리에는 뒤로, 위치, 「LLM이 받는 텍스트」, 저장만 둔다 — id, 배지, 오류 개수, 「저장하지
// 않은 변경」, 부탁 버튼, 설명 문구, 도움말은 두지 않는다(구현 스펙 5절 「배치」).
//
// **규칙이 없다**(결정 13). 초안을 고치는 것은 `draft.ts`의 순수 함수이고, 이름 틀이 맞는지·폴더에 자식이
// 있어도 되는지는 엔진의 검증이 판정한다. 편집기는 초안이 바뀔 때마다 짧은 지연 뒤에 엔진에 묻고(미리보기,
// 티켓 14), 그 오류는 데이터로 와서(`{ path, message }`) 그 자리의 항목 제목 아래에 붉은 줄로 서며 저장을
// 잠근다. 같은 답의 글이 「LLM이 받는 텍스트」 팝업에 선다.
//
// 항목을 더하고 지우고 옮기는 것은 트리 위 한 줄과 트리 자신이다(티켓 13). 옮기는 주된 길은 **끌어다 놓기**이고
// (공용 끌기 모듈을 딛는다), 옮기기 버튼 넷과 ⌥↑ ⌥↓ ⌥← ⌥→는 키보드 길이다.
//
// **저장은 이 화면의 저장 버튼 하나다** — 설정 초안의 저장 버튼과 따로다. 누르기 전에는 아무것도 쓰지 않는다.
// 저장하지 않은 초안을 두고 떠나면 묻는다(티켓 15, `leave.ts`). 레이아웃이 밖에서 바뀌면 초안이 없을 때는 조용히
// 따라가고, 있으면 머리 아래의 배너로 한쪽을 고르게 한다(`outside.ts`).

/** 편집기 주소를 연다 — 레이아웃을 읽어, 읽을 수 있으면 편집 UI를, 없으면 까닭과 돌아가는 길을 세운다. */
function SpecLayoutEditor({ id, sidebarOpen }: { id: Mode; sidebarOpen: boolean }) {
  const read = useQuery(specLayoutReadQuery(id));
  const navigate = useNavigate();
  // 뒤로는 「spec 레이아웃」 설정 페이지다 — 편집기로 오는 문이 거기 한 곳(모드 행의 [편집])이라, 히스토리를 되감지
  // 않고 늘 그 자리로 간다. 주소로 바로 와도 같은 곳에 선다. 저장하지 않은 초안이 있으면 떠나기 전에 묻는다(티켓 15).
  const back = () => void navigate({ to: "/settings/spec-layout" });
  const data = read.data;

  // 한 번 읽었으면 그 뒤로 다시 읽히는 것은 편집 화면이 받는다 — 밖에서 깨지거나 고쳐져도 화면이 내려가지 않아야
  // 초안이 산다(티켓 15).
  if (data !== undefined) {
    return <EditorScreen id={id} read={data} sidebarOpen={sidebarOpen} onBack={back} />;
  }
  return (
    <EditorFrame id={id} sidebarOpen={sidebarOpen} onBack={back}>
      {/* 읽기 자체가 실패한 길(IPC). 레이아웃 폴더가 깨진 것은 여기가 아니라 편집 화면의 「읽지 못함」이다. */}
      {read.error !== null && (
        <div className="flex max-w-[620px] flex-col items-start gap-3 px-8 pt-2">
          <p className="text-[13.5px] leading-[1.7] text-red-600">{String(read.error)}</p>
          <button
            type="button"
            onClick={() => void read.refetch()}
            className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover"
          >
            다시 읽기
          </button>
        </div>
      )}
    </EditorFrame>
  );
}

/** 밖 변경 배너가 든 것 — 판정과, [새로 불러오기]가 받을 새로 읽은 것. */
interface Outside {
  verdict: BannerVerdict;
  fresh: SpecLayoutRead;
}

/**
 * 편집 화면 — 초안과 고른 자리, 기준본, 밖 변경 배너, 초안의 미리보기를 든다.
 *
 * **초안은 처음 읽은 것으로 짓고, 그 뒤로 다시 읽힌 것은 기준본과 견준다**(티켓 15 · 결정 22). 전역 구독이 레이아웃
 * 읽기를 다시 부르면 `read`가 바뀌어 온다 — 초안이 없으면 조용히 새것을 받고, 있으면 배너로 한쪽을 고르게 한다
 * (`judgeOutside`). 합치지는 않는다. 읽은 것이 깨졌으면 초안이 없는 동안 「읽지 못함」 화면이다.
 */
function EditorScreen({
  id,
  read,
  sidebarOpen,
  onBack,
}: {
  id: Mode;
  read: SpecLayoutRead;
  sidebarOpen: boolean;
  onBack: () => void;
}) {
  // 기준본 — 열 때 읽은 것, 밖 변경을 받거나 유지하며 새로 읽은 것, 또는 제가 저장한 것. 초안이 이것과 내용으로
  // 다르면 「저장하지 않은 것이 있다」(`unsaved`) — 저장이 열리고(`canSave`), 떠날 때 묻고, 밖 변경에 배너가 선다.
  const [baseline, setBaseline] = useState<SpecLayoutRead>(read);
  // 초안과 고른 자리는 **한 값**이다 — 트리를 고치면(티켓 13) 둘이 함께 바뀐다: 자리가 인덱스 경로라 항목이
  // 옮겨 가면 고른 자리가 따라가야 하고, 둘을 따로 두면 한 렌더 동안 고른 자리가 엉뚱한 항목을 가리킨다.
  // 그래서 모양이 트리 조작의 답(`TreeEdit`)과 같다. 읽은 것이 깨졌으면 초안이 없다(`null`) — 「읽지 못함」 화면이다.
  const [view, setView] = useState<TreeEdit | null>(() => viewOf(read, null));
  const [outside, setOutside] = useState<Outside | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 새로 읽은 것을 받는다 — 초안을 버리고 그것을 보인다. 고르던 항목이 새것에도 있으면 그대로 고른다. 깨졌으면
  // 「읽지 못함」 화면이라 미리보기 팝업도 닫는다 — 열린 채로 두면 고쳐져 편집 UI가 돌아올 때 저절로 다시 뜬다.
  // 끄던 항목이 있으면 트리(`EntryTree`)가 그 끌기를 거둔다.
  const take = (fresh: SpecLayoutRead) => {
    const next = viewOf(fresh, view?.selected ?? null);
    setBaseline(fresh);
    setView(next);
    setOutside(null);
    if (next === null) setPreviewOpen(false);
  };

  // **다시 읽힌 것을 한 번씩 판정한다.** 읽기 쿼리는 내용이 같으면 같은 객체를 주므로(구조 공유), 앞에 판정한 것과
  // 다른 객체면 밖에서 무엇이 바뀌었다. 판정은 렌더 중에 한다 — 새 읽기를 그린 첫 화면부터 그 결과가 선다.
  const [judged, setJudged] = useState(read);
  if (read !== judged) {
    setJudged(read);
    const verdict = judgeOutside(baseline, view?.draft ?? null, read);
    if (verdict === "replace" || verdict === "unreadable") take(read);
    // 밖이 기준본으로 돌아왔다 — 앞서 선 배너는 이제 낡았다.
    else if (verdict === "ignore") setOutside(null);
    else setOutside({ verdict, fresh: read });
  }

  const draft = view?.draft ?? null;
  // 초안마다 엔진에 묻는 미리보기 — 그 답의 오류가 항목 아래에 서고, 글이 팝업에 선다. 팝업을 닫은 동안에도 묻는다.
  // 답은 디스크에도 달려(초안에 본문이 없는 템플릿은 그 파일이 있는지를 본다) 레이아웃 폴더를 다시 읽은 것이 바뀌면
  // 고치지 않은 초안도 다시 묻는다 — 밖 변경 배너가 선 동안에도, 유지한 뒤에도 답이 새 디스크의 것이다.
  const { preview, reserve } = useDraftPreview(id, draft, read);
  const opener = useRef<HTMLButtonElement>(null);
  // 팝업을 닫으면 포커스를 머리의 버튼에 돌려준다 — 팝업은 body 끝에 떠 있어, 안 돌려주면 `<body>`로 떨어진다.
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    opener.current?.focus();
  }, []);
  // **제 저장** — 쓰였으면 기준본이 저장한 것이 되고, 선 배너는 걷힌다(저장이 밖의 변경을 덮었다). 그래서 제 저장이
  // 부른 다시 읽기는 판정 1번(무시)에 걸린다. 이 바꿈은 **다시 읽기가 도착하기 전에 그려져 있어야** 하므로 저장의
  // 무효화보다 먼저, 곧바로 그린다(`flushSync`) — 미루면 다시 읽힌 답이 옛 기준본과 견줘져 제 저장을 밖 변경으로 읽는다.
  const write = useWriteSpecLayout((written) =>
    flushSync(() => {
      setBaseline((before) => savedBaseline(before, written));
      setOutside(null);
    }),
  );
  const reference = contentOf(baseline);
  const enabled = draft !== null && canSave({ draft, baseline: reference, preview, saving: write.isPending });

  // **템플릿은 늘 전부 넘긴다**(구현 스펙 3절) — 읽은 본문을 그대로 싣는다. 저장은 지금 초안의 미리보기가 오류 없이
  // 도착해야 열린다. 그래도 검증이 거절할 수 있다 — 미리보기와 저장 사이에 디스크가 바뀌었을 때(템플릿 파일이
  // 사라졌다). 그 거절은 답의 `errors`로 오고 아무것도 쓰이지 않았다: 초안은 그대로 남고, 그 오류가 이 초안의 가장
  // 새 판정이 되어 그 자리에 선다(`reserve`) — 초안이나 레이아웃 폴더가 바뀌어 다시 물을 때까지다. 거절(throw)은
  // 쓰다가 실패한 것뿐이다. 답은 썼는가다 — [저장하고 나가기]는 쓰였을 때만 떠난다.
  const save = async (): Promise<boolean> => {
    if (draft === null || !enabled) return false;
    const saved = draft;
    const refused = reserve(saved);
    try {
      const answer = await write.mutateAsync({ id, ...saved });
      if (answer.errors.length === 0) return true;
      refused({ text: null, lines: [], errors: answer.errors, warnings: [] });
    } catch (e) {
      await showProblem(`저장하지 못했습니다: ${e}`);
    }
    return false;
  };

  // 저장하지 않은 초안을 두고 떠나면 묻는다 — 뒤로, 사이드바 nav, 팔레트, 설정 nav의 다른 항목, 히스토리의 뒤로·앞으로(티켓 15).
  useConfirmLeave({ unsaved: draft !== null && unsaved(draft, reference), savable: enabled, save });

  if (view === null) {
    return (
      <EditorFrame id={id} sidebarOpen={sidebarOpen} onBack={onBack}>
        {"errors" in baseline && <UnreadableLayout read={baseline} onBack={onBack} />}
      </EditorFrame>
    );
  }

  return (
    <EditorFrame
      id={id}
      sidebarOpen={sidebarOpen}
      onBack={onBack}
      actions={
        <>
          <button
            ref={opener}
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={previewOpen}
            className="inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover"
          >
            <Eye aria-hidden className="size-[15px]" strokeWidth={1.9} />
            LLM이 받는 텍스트
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!enabled}
            // 규격은 설정의 저장 버튼(`SettingsPage`의 `SaveButton`)과 같다 — 이 저장소의 주 버튼 하나다.
            className="h-8 rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08] disabled:pointer-events-none disabled:opacity-40"
          >
            {write.isPending ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      {previewOpen && (
        <PreviewDialog answer={preview?.answer ?? null} selected={view.selected} onClose={closePreview} />
      )}
      {outside !== null && (
        <OutsideBanner
          verdict={outside.verdict}
          onReload={() => take(outside.fresh)}
          // 유지는 배너를 닫고 기준본만 새것으로 바꾼다 — 그 뒤 저장하면 밖의 변경을 덮는다. 깨졌을 때 유지한 초안을
          // 저장하면 고쳐지고, 지워졌을 때 저장하면 다시 만든다.
          onKeep={() => {
            setBaseline(outside.fresh);
            setOutside(null);
          }}
        />
      )}
      <EditorColumns
        draft={view.draft}
        folder={read.folder}
        selected={view.selected}
        // 마지막으로 받은 답의 오류 — 초안을 고친 직후에는 아직 앞 초안의 것이다. 지연 뒤의 답이 그것을 바꾼다.
        errors={preview?.answer.errors ?? []}
        onSelect={(path) => setView((now) => now && { ...now, selected: path })}
        onChange={(change) => setView((now) => now && { ...now, draft: change(now.draft) })}
        // 할 수 없는 조작(`null`)은 같은 상태를 돌려준다 — 다시 그리지 않는다.
        onEdit={(edit) => setView((now) => now && (edit(now.draft) ?? now))}
      />
    </EditorFrame>
  );
}

/**
 * 읽은 것을 펼친 편집 상태 — 초안과 고른 자리. 깨졌으면 펼칠 것이 없어 `null`이다(「읽지 못함」 화면). 고르던 자리가
 * 새것에도 있으면 그대로 고르고, 없으면 첫 최상위 항목을, 항목이 없으면 머리 `spec/`(방침 문단)을 고른다.
 */
function viewOf(read: SpecLayoutRead, selected: EntryPath | null): TreeEdit | null {
  const draft = contentOf(read);
  if (draft === null) return null;
  if (selected !== null && entryAt(draft.layout, selected) !== null) return { draft, selected };
  return { draft, selected: (draft.layout.root.children ?? []).length > 0 ? [0] : [] };
}

/** 배너의 뜻 셋(구현 스펙 5절). */
const OUTSIDE_MESSAGE: Record<BannerVerdict, string> = {
  changed: "밖에서 이 레이아웃이 바뀌었어요",
  broken: "밖에서 이 레이아웃이 깨졌어요",
  removed: "밖에서 지워졌어요",
};

/**
 * 밖 변경 배너(티켓 15 · 결정 22) — 초안이 있는데 레이아웃이 밖에서 바뀌면 편집기 머리 아래에 한 줄로 선다. 한쪽을
 * 고르게 할 뿐 합치지 않는다. [새로 불러오기]는 초안을 버리고 새로 읽은 것을 보인다(깨졌으면 「읽지 못함」 화면이다).
 * [내 초안 유지]는 배너를 닫고 기준본만 새것으로 바꾼다.
 */
export function OutsideBanner({
  verdict,
  onReload,
  onKeep,
}: {
  verdict: BannerVerdict;
  onReload: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-t border-amber-600/20 bg-amber-600/10 py-2 pr-4 pl-5"
    >
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" strokeWidth={2} />
      <span className="min-w-0 flex-1 text-[13px] font-medium text-amber-700 dark:text-amber-400">
        {OUTSIDE_MESSAGE[verdict]}
      </span>
      <button
        type="button"
        onClick={onReload}
        className="h-7 shrink-0 whitespace-nowrap rounded-[9px] border border-amber-600/30 bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-state-1"
      >
        새로 불러오기
      </button>
      <button
        type="button"
        onClick={onKeep}
        className="h-7 shrink-0 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium text-amber-700 transition-colors hover:bg-amber-600/10 dark:text-amber-400"
      >
        내 초안 유지
      </button>
    </div>
  );
}

/**
 * 편집기의 틀 — 머리(뒤로 · 위치 · 동작)와 본문. 위치는 세 칸이다: `Settings / spec 레이아웃 / <모드 이름>`.
 * 가운데 칸은 설정 nav 항목 표에서 읽는다 — 머리와 nav가 각자 라벨을 들면 이름을 고치는 날 한쪽만 바뀐다.
 */
function EditorFrame({
  id,
  sidebarOpen,
  onBack,
  actions,
  children,
}: {
  id: Mode;
  sidebarOpen: boolean;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const name = modeNameOf(id);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader
          lead={
            <button
              type="button"
              onClick={onBack}
              aria-label="설정으로 돌아가기"
              className="icon-button-quiet size-7 text-muted-foreground"
            >
              <ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
            </button>
          }
          root="Settings"
          trail={[settingsItem("spec-layout").label]}
          leaf={name}
          inset={!sidebarOpen}
          actions={actions}
        />
        {/* 제목 역할은 이 줄이 진다 — 머리(`PageHeader`)는 제목 역할이 없는 글자다(설정 페이지와 같다). */}
        <h2 className="sr-only">{name} 레이아웃</h2>
        {children}
      </main>
    </div>
  );
}

/**
 * 두 열 — 왼쪽은 항목 트리(300px), 오른쪽은 고른 항목. 값을 들지 않는다: 초안과 고른 자리를 받아 그리고,
 * 고친 것은 초안을 고치는 함수로 돌려준다(마크업 테스트가 클릭을 못 건다 — `SpecLayoutSection`과 같은
 * 이유). 아이콘 팝오버가 열렸는지, 끄는 동안 어디를 겨눴는지만 그 자리가 든다.
 *
 * 고른 자리는 맨 위 항목에서부터의 인덱스 경로다. **`[]`이 트리 열의 머리 `spec/`이다** — 맨 위 항목(spec
 * 폴더 자신)은 트리의 행이 아니고(결정 26), 머리를 누르면 그 설명(방침 문단) 칸 하나만 선다.
 *
 * 필드를 고치는 것(`onChange`)과 트리를 고치는 것(`onEdit`, 티켓 13)이 갈린다 — 트리를 고치면 고른 자리도
 * 함께 바뀐다(`TreeEdit`). 둘 다 **지금 초안을 받는 함수**로 돌려준다: 끌기의 손잡이는 누른 순간의 렌더에서
 * 만들어져, 그 클로저의 초안은 놓을 때 낡았을 수 있다.
 */
export function EditorColumns({
  draft,
  folder,
  selected,
  errors,
  onSelect,
  onChange,
  onEdit,
}: {
  draft: LayoutDraft;
  /** 레이아웃 폴더 — 홈은 `~`로 줄였고 끝에 `/`가 없다. 템플릿 경로 표시가 이 아래에 선다. */
  folder: string;
  selected: EntryPath;
  errors: LayoutError[];
  onSelect: (path: EntryPath) => void;
  onChange: (change: (draft: LayoutDraft) => LayoutDraft) => void;
  onEdit: (edit: (draft: LayoutDraft) => TreeEdit | null) => void;
}) {
  const entry = selected.length === 0 ? null : entryAt(draft.layout, selected);
  // 고른 자리가 초안에 없으면(항목이 사라졌다) 머리를 고른 것으로 친다.
  const at: EntryPath = entry === null ? [] : selected;
  const errorsAt = (path: EntryPath) => errors.filter((error) => samePath(error.path, path));
  const documentErrors = errors.filter((error) => error.path === null);

  return (
    <div className="flex min-h-0 flex-1 border-t border-border">
      <section
        aria-label="항목 트리"
        className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar"
      >
        <TreeTools
          edits={editsAt(draft, at)}
          onAdd={(kind) => onEdit((current) => addEntry(current, at, kind))}
          onMove={(move) => onEdit((current) => moveEntry(current, at, move))}
          onRemove={() => onEdit((current) => removeEntry(current, at))}
        />
        <div className="px-2 pt-2 pb-0.5">
          {/* 머리 `spec/`은 항목이 아니다(결정 26) — 끌기·지우기·옮기기의 대상이 아니고, 누르면 spec 폴더
              안내(맨 위 항목의 설명) 칸 하나만 연다. 그래서 행(treeitem)이 아니라 머리의 버튼이다. */}
          <button
            type="button"
            onClick={() => onSelect([])}
            aria-pressed={at.length === 0}
            title="spec 폴더 안내"
            className={cn(
              "flex h-7 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] transition-colors",
              at.length === 0 ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
            )}
          >
            <Folder aria-hidden className="size-3 shrink-0 text-tertiary" strokeWidth={1.9} />
            <span className="font-mono text-[12px]">spec/</span>
          </button>
        </div>
        <EntryTree
          draft={draft}
          at={at}
          errors={errors}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      </section>
      <section
        aria-label="고른 항목"
        className="min-w-0 flex-1 overflow-y-auto px-10 pt-7 pb-10 scroll-quiet"
      >
        <div className="flex max-w-[640px] flex-col gap-[22px]">
          {/* 자리가 없는 오류(문서 전체의 것) — 고를 항목이 없으니 어느 항목을 골라도 선다. */}
          {documentErrors.length > 0 && <ErrorLines errors={documentErrors} />}
          {entry === null ? (
            <GuideField
              description={draft.layout.root.description ?? ""}
              errors={errorsAt([])}
              onChange={(text) => onChange((current) => setDescription(current, [], text))}
            />
          ) : (
            <EntryFields
              // 항목을 옮기면 칸이 새로 선다 — 팝오버가 앞 항목의 것으로 남지 않는다.
              key={at.join(".")}
              entry={entry}
              templates={draft.templates}
              folder={folder}
              errors={errorsAt(at)}
              onChange={(change) => onChange((current) => change(current, at))}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 트리 위 한 줄(티켓 13 · 구현 스펙 5절 「배치」) — 파일 추가, 폴더 추가, 옮기기 넷, 지우기(휴지통). 옮기는 주된
 * 길은 끌어다 놓기이고, 옮기기 넷과 그 단축키(⌥↑ ⌥↓ ⌥← ⌥→)는 키보드 길로 남긴 것이다.
 *
 * **무엇이 잠기는지는 여기서 정하지 않는다** — 조작 함수의 답(`editsAt`)을 받는다. 머리 `spec/`을 골랐으면
 * 옮기기와 지우기가 모두 잠긴다. 더하기는 늘 된다.
 */
function TreeTools({
  edits,
  onAdd,
  onMove,
  onRemove,
}: {
  edits: Record<EntryMove | "remove", boolean>;
  onAdd: (kind: "file" | "folder") => void;
  onMove: (move: EntryMove) => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="항목 편집"
      className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2.5"
    >
      {(["file", "folder"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onAdd(kind)}
          aria-label={kind === "file" ? "파일 항목 추가" : "폴더 항목 추가"}
          title={kind === "file" ? "파일 항목 추가" : "폴더 항목 추가"}
          className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[8px] border border-border bg-background pr-[9px] pl-[7px] text-[12.5px] font-medium text-foreground shadow-xs transition-colors hover:bg-state-1"
        >
          <Plus aria-hidden className="size-[13px] text-muted-foreground" strokeWidth={2.2} />
          {kind === "file" ? "파일" : "폴더"}
        </button>
      ))}
      <div
        role="group"
        aria-label="고른 항목 옮기기"
        className="ml-auto flex shrink-0 items-center gap-px rounded-[9px] bg-state-1 p-0.5"
      >
        {MOVE_TOOLS.map(({ move, label, keys, Icon }) => (
          <button
            key={move}
            type="button"
            onClick={() => onMove(move)}
            disabled={!edits[move]}
            aria-label={label}
            title={`${label} (${keys})`}
            className="flex h-6 w-[26px] items-center justify-center rounded-[7px] text-muted-foreground transition-colors quiet-hover disabled:pointer-events-none disabled:opacity-35"
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        ))}
      </div>
      {/* 휴지통은 붉고, 가리키면 더 짙은 붉은색이다(프로토타입 뒤 사용자 선택). 머리 `spec/`을 골랐으면 지울 것이
          없어 흐린 붉은색으로 잠긴다 — 잠긴 동안에는 가리켜도 바뀌지 않는다. */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!edits.remove}
        aria-label="고른 항목 지우기"
        title="지우기"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
          edits.remove ? "text-red-600 hover:bg-red-600/10 hover:text-red-700" : "text-red-600/35",
        )}
      >
        <Trash2 aria-hidden className="size-[15px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}

/** 옮기기 넷 — 줄에 선 순서이고, 단축키는 이 키들에 ⌥를 누른 것이다(`moveOfKey`). */
const MOVE_TOOLS: { move: EntryMove; label: string; keys: string; Icon: LucideIcon }[] = [
  { move: "up", label: "위로", keys: "⌥↑", Icon: ArrowUp },
  { move: "down", label: "아래로", keys: "⌥↓", Icon: ArrowDown },
  { move: "outdent", label: "내어쓰기", keys: "⌥←", Icon: IndentDecrease },
  { move: "indent", label: "들여쓰기", keys: "⌥→", Icon: IndentIncrease },
];

/**
 * 단축키의 옮기기 — ⌥만 누른 화살표다. **트리에 초점이 있을 때만 받는다**(트리의 `onKeyDown`): 설명 칸과 템플릿
 * 칸 안에서 ⌥←·⌥→는 macOS의 단어 이동이다.
 */
function moveOfKey(event: KeyboardEvent): EntryMove | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "outdent";
    case "ArrowRight":
      return "indent";
    default:
      return null;
  }
}

/**
 * 항목 트리 — 행들과 그 아래 빈 자리. **끌어다 놓기**가 옮기는 주된 길이다(티켓 13 · 구현 스펙 5절).
 *
 * 몸짓 자체(문턱 · Esc 취소 · 끝난 뒤 클릭 한 번 삼키기 · 끄는 중 body 표시)는 공용 끌기 모듈의 것이다. 이 트리가
 * 쥐는 것은 **겨눈 자리**뿐이다: 포인터 아래의 행과 그 행의 어디(위쪽·가운데·아래쪽)인지를 재어 앞·뒤·안으로
 * 가르고(`dropPlaceAt`), 놓을 수 있는지는 놓기 계산(`dropEntry`)의 답으로 본다 — 자기 자신과 자기 아래는
 * 선이 서지 않는다. 트리 아래 빈 자리는 최상위 맨 뒤다. 머리 `spec/`은 트리 밖이라 대상이 아니다.
 */
function EntryTree({
  draft,
  at,
  errors,
  onSelect,
  onEdit,
}: {
  draft: LayoutDraft;
  at: EntryPath;
  errors: LayoutError[];
  onSelect: (path: EntryPath) => void;
  onEdit: (edit: (draft: LayoutDraft) => TreeEdit | null) => void;
}) {
  const rows = rowsOf(draft.layout.root.children ?? [], []);
  const tree = useRef<HTMLDivElement>(null);
  // 끄는 동안 겨눈 자리 — 선이나 밝아진 폴더가 여기서 선다. 놓을 수 없는 자리면 `null`이다.
  const [over, setOver] = useState<DropTarget | null>(null);
  // 끌리는 항목 — 그 행과 그 아래 행들이 흐려진다. 드래그 상태는 공용 모듈이 쥐고, 여기는 읽기만 한다.
  const dragged = useStore(dragStore, (state) => (state.source?.kind === "entry" ? state.source.path : null));
  // 겨누는 자리가 읽는 **최신** 초안. 끄는 손잡이는 누른 순간의 렌더에서 만들어진다.
  const latest = useRef(draft);
  useLayoutEffect(() => {
    latest.current = draft;
  });

  // **끄는 도중 초안이 바뀌면 끌기를 거둔다** — 끌기는 놓기 전까지 초안이 아니라, 그동안 밖 변경은 트리를 조용히
  // 갈아 끼운다(판정 3번). 끌리는 항목(`from`)과 흐려진 행이 인덱스 경로라 새 트리에서는 다른 항목을 가리킨다 — 그대로
  // 두면 놓는 순간 그 자리에 새로 선 항목이 옮겨 간다. 작업 행 목록(UI개선 스펙 S8)과 같은 길이다: Esc처럼 아무것도
  // 안 부른다. 제 놓기는 여기 걸리지 않는다 — 공용 모듈이 놓은 뒤 곧바로 상태를 비워, 새 초안이 그려질 때는 끌기가 없다.
  // 문턱 전의 눌림은 거두지 않는다(작업 행 목록과 같다).
  const seenDraft = useRef(draft);
  useEffect(() => {
    if (seenDraft.current === draft) return;
    seenDraft.current = draft;
    if (dragStore.state.source?.kind === "entry") cancelDrag();
  }, [draft]);

  // 키로 옮긴 뒤 초점을 옮긴 행에 돌려준다. 행은 자리로 키를 받아, 들여쓰거나 내어쓰면 초점을 쥔 행이 사라져
  // 초점이 `<body>`로 떨어진다 — 그러면 다음 단축키를 들을 사람이 없다.
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    tree.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')?.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = moveOfKey(event);
    if (move === null) return;
    // 할 수 없는 단축키도 삼킨다 — 트리 안의 ⌥화살표는 구르기나 단어 이동이 아니다.
    event.preventDefault();
    // **되는 옮기기에만** 초점을 돌려줄 표시를 세운다. 할 수 없는 옮기기는 같은 상태를 돌려줘 다시 그려지지
    // 않으므로 표시가 걷히지 않고 남는다 — 그러면 다음에 트리가 그려질 때(설명 칸에 한 글자 적을 때) 초점이 칸에서
    // 행으로 빠져나간다. 이 렌더의 초안과 자리로 묻는다: 키를 받은 것이 이 렌더다.
    if (!editsAt(draft, at)[move]) return;
    refocus.current = true;
    onEdit((current) => moveEntry(current, at, move));
  };

  /**
   * 포인터 아래의 놓을 자리. 트리 밖이거나 놓을 수 없으면 `null`, 행 사이의 틈(1px)이나 들여쓰기 여백처럼 가리킬
   * 것이 없는 트리 안이면 `undefined`다 — 겨눈 것을 그대로 둔다(행 사이를 지날 때마다 선이 깜박이지 않게).
   *
   * 포인터 아래는 **그 순간의 문서에 묻는다**(`elementFromPoint`) — 트리가 굴러도 사각형을 다시 잴 일이 없다.
   */
  const aim = (from: EntryPath, point: DragPoint): DropTarget | null | undefined => {
    const box = tree.current;
    const hit = document.elementFromPoint(point.clientX, point.clientY);
    if (box === null || hit === null || !box.contains(hit)) return null;
    const row = hit.closest<HTMLElement>("[data-entry-path]");
    const end = hit.closest("[data-entry-end]");
    if (row === null && end === null) return undefined;
    let target: DropTarget = { place: "end" };
    if (row !== null) {
      const path = (row.dataset.entryPath ?? "").split(".").map(Number);
      const entry = entryAt(latest.current.layout, path);
      if (entry === null) return null;
      const rect = row.getBoundingClientRect();
      target = { path, place: dropPlaceAt(entry, (point.clientY - rect.top) / rect.height) };
    }
    return dropEntry(latest.current, from, target) === null ? null : target;
  };

  const pickUp = (from: EntryPath, event: ReactPointerEvent<HTMLButtonElement>) => {
    // 주 버튼만 받는다 — 보조 클릭으로 끌리면 메뉴를 열려던 손이 항목을 옮긴다.
    if (event.button !== 0) return;
    let aimed: DropTarget | null = null;
    armDrag({ kind: "entry", path: from }, { clientX: event.clientX, clientY: event.clientY }, {
      move: (point) => {
        const next = aim(from, point);
        if (next === undefined) return;
        aimed = next;
        // 같은 자리면 같은 값을 둔다 — 포인터 이동마다 새 객체를 내면 그 빈도로 트리가 다시 그려진다.
        setOver((now) => (sameTarget(now, next) ? now : next));
      },
      // 놓인 자리를 놓는 순간의 포인터로 다시 판정한다 — 틈 위에서 놓았으면 마지막으로 겨눈 자리다.
      drop: (point) => {
        const next = aim(from, point);
        const target = next === undefined ? aimed : next;
        if (target !== null) onEdit((current) => dropEntry(current, from, target));
      },
      end: () => setOver(null),
    });
  };

  return (
    <div
      ref={tree}
      role="tree"
      aria-label="레이아웃 항목"
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-1 scroll-quiet"
    >
      {rows.map(({ entry: row, path }) => (
        <TreeRow
          key={path.join(".")}
          entry={row}
          path={path}
          selected={samePath(path, at)}
          hasError={errors.some((error) => samePath(error.path, path))}
          missingTemplate={templateMissing(draft.templates, row)}
          dragged={dragged !== null && within(path, dragged)}
          drop={over !== null && "path" in over && samePath(over.path, path) ? over.place : null}
          onSelect={() => onSelect(path)}
          onPointerDown={(event) => pickUp(path, event)}
        />
      ))}
      {/* 트리 아래 빈 자리 — 최상위 맨 뒤에 놓는 곳이다. 행이 적어도 늘 조금은 선다. */}
      <div
        aria-hidden
        data-entry-end=""
        data-entry-drop={over?.place === "end" ? "end" : undefined}
        className="relative min-h-12 flex-1 shrink-0"
      >
        {over?.place === "end" && <DropLine side="top" left={rowIndent(1) - 4} />}
      </div>
    </div>
  );
}

/** 두 겨눈 자리가 같은가 — 자리와 앞·뒤·안이 같다. */
function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.place === "end" || b.place === "end") return a.place === b.place;
  return a.place === b.place && samePath(a.path, b.path);
}

/** 행의 왼쪽 여백 — 들여쓰기는 `spec` 패널 탭의 트리와 같은 걸음(14px)이다. 깊이는 최상위가 1이다. */
function rowIndent(depth: number): number {
  return 8 + (depth - 1) * 14;
}

/** 앞·뒤에 놓일 자리의 선 — 그 행의 들여쓰기에서 시작하는 굵은 선과 왼쪽 끝의 작은 고리. */
function DropLine({ side, left }: { side: "top" | "bottom"; left: number }) {
  return (
    <span
      aria-hidden
      style={{ left }}
      className={cn(
        "pointer-events-none absolute right-1.5 flex h-1.5 items-center",
        side === "top" ? "-top-[3px]" : "-bottom-[3px]",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full border-2 border-primary bg-background" />
      <span className="h-0.5 flex-1 rounded-full bg-primary" />
    </span>
  );
}

/** 트리의 행 하나를 그리는 데 드는 것 — 항목과 그 자리. 깊이 우선, 레이아웃에 적힌 순서다. */
function rowsOf(
  entries: LayoutEntryJson[],
  parent: EntryPath,
): { entry: LayoutEntryJson; path: EntryPath }[] {
  return entries.flatMap((entry, index) => {
    const path = [...parent, index];
    return [{ entry, path }, ...rowsOf(entry.children ?? [], path)];
  });
}

/** 아이콘 이름이 앱의 표에 없는가 — 손으로 적은 모르는 이름이다. 없는 아이콘은 모르는 것이 아니다. */
function unknownIcon(entry: LayoutEntryJson): boolean {
  return entry.icon !== undefined && specIconOf(entry.icon) === null;
}

/**
 * 파일 항목이 가리키는 템플릿의 본문이 본문 맵에 없는가 — 템플릿 파일이 디스크에서 사라졌다(읽기의 누락
 * 경고). 칸에 적으면 맵에 들어가 풀리고, 「없음」으로 바꿔도 풀린다. 그대로 저장하면 엔진이 그 자리의
 * 오류로 거절한다.
 */
function templateMissing(templates: TemplateBodies, entry: LayoutEntryJson): boolean {
  return entry.kind === "file" && entry.template !== undefined && bodyOf(templates, entry) === null;
}

/**
 * 트리의 행 하나. 이름은 이름 틀이고, 폴더는 끝에 `/`가 붙는다. 아이콘은 표의 것이고, 없거나 모르는
 * 이름이면 종류의 흐린 글리프다. 모르는 아이콘·템플릿 누락과 검증 오류는 행 끝에 표시가 붙는다 — 어디를
 * 골라야 하는지 트리에서 보인다.
 */
function TreeRow({
  entry,
  path,
  selected,
  hasError,
  missingTemplate,
  dragged,
  drop,
  onSelect,
  onPointerDown,
}: {
  entry: LayoutEntryJson;
  path: EntryPath;
  selected: boolean;
  hasError: boolean;
  missingTemplate: boolean;
  /** 끌리는 항목이나 그 아래다 — 흐려진다. */
  dragged: boolean;
  /** 끄는 동안 이 행을 겨눴으면 그 자리 — 앞·뒤는 선, 안은 밝아진 행이다. */
  drop: DropPlace | null;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const depth = path.length;
  const folder = isFolder(entry);
  // 경고(모르는 아이콘, 템플릿 누락)는 삼각형 하나에 모은다 — 무엇인지는 고른 항목의 열이 적는다.
  const warnings = [unknownIcon(entry) && "모르는 아이콘", missingTemplate && "템플릿 누락"].filter(
    (warning): warning is string => warning !== false,
  );
  const Known = specIconOf(entry.icon ?? null);
  const Glyph: LucideIcon = Known ?? (folder ? Folder : File);
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth}
      aria-selected={selected}
      data-entry-path={path.join(".")}
      data-entry-drop={drop ?? undefined}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        // 고른 행에 초점을 둔다 — 단축키는 트리에 초점이 있을 때만 받는데, WKWebView는 누른 버튼으로 초점을
        // 옮기지 않는다.
        event.currentTarget.focus();
        onSelect();
      }}
      style={{ paddingLeft: rowIndent(depth) }}
      className={cn(
        "relative flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[8px] pr-2 text-left text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        drop === "inside"
          ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary"
          : selected
            ? "selected-row font-medium"
            : "text-muted-foreground hover:bg-state-1",
        hasError && "text-red-600",
        dragged && "opacity-40",
      )}
    >
      <Glyph
        aria-hidden
        className={cn("size-3 shrink-0", Known ? "" : "text-tertiary opacity-70")}
        strokeWidth={1.9}
      />
      <span className="min-w-0 flex-1 truncate">
        {entry.pattern ?? ""}
        {folder ? "/" : ""}
      </span>
      {warnings.length > 0 && (
        <>
          <TriangleAlert
            aria-hidden
            className="size-3 shrink-0 text-amber-700 dark:text-amber-400"
            strokeWidth={2}
          />
          <span className="sr-only">{warnings.join(", ")}</span>
        </>
      )}
      {hasError && (
        <>
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-red-600" />
          <span className="sr-only">검증 오류</span>
        </>
      )}
      {(drop === "before" || drop === "after") && (
        <DropLine side={drop === "before" ? "top" : "bottom"} left={rowIndent(depth) - 4} />
      )}
    </button>
  );
}

/** 검증 오류의 붉은 줄들 — 엔진이 준 글 그대로다. */
function ErrorLines({ errors, inset = false }: { errors: LayoutError[]; inset?: boolean }) {
  return (
    <>
      {errors.map((error, index) => (
        <p
          key={index}
          className={cn("text-[12.5px] leading-[1.6] text-red-600", inset && "pl-[46px]")}
        >
          {error.message}
        </p>
      ))}
    </>
  );
}

// 칸의 규격 — 설정 화면의 입력 칸과 같은 가족이다.
const TEXTAREA =
  "w-full resize-y rounded-[9px] border border-border-strong bg-background px-2.5 py-2 text-[13px] leading-[1.6] outline-none focus:border-primary";

/**
 * 머리 `spec/`을 골랐을 때의 칸 하나 — 맨 위 항목의 설명, 안내문 맨 위의 방침 문단이다(결정 26). 맨 위
 * 항목의 오류(자리 `[]`)는 칸 위에 선다.
 */
function GuideField({
  description,
  errors,
  onChange,
}: {
  description: string;
  errors: LayoutError[];
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] text-tertiary">
        spec 폴더 안내
      </label>
      <ErrorLines errors={errors} />
      <textarea
        id={id}
        rows={9}
        value={description}
        onChange={(event) => onChange(event.target.value)}
        className={TEXTAREA}
      />
    </div>
  );
}

/**
 * 고른 항목의 칸들. **제목이 곧 이름 틀 칸이다** — 눌러서 고친다. 제목 옆에 아이콘 칸(팝오버)과 종류
 * (파일|폴더), 제목 아래에 그 자리의 검증 오류와 모르는 아이콘 경고, 그 아래에 설명 칸이다. 파일 항목에는
 * 그 아래에 템플릿 칸이 더해진다(티켓 12).
 */
function EntryFields({
  entry,
  templates,
  folder,
  errors,
  onChange,
}: {
  entry: LayoutEntryJson;
  templates: TemplateBodies;
  folder: string;
  errors: LayoutError[];
  onChange: (change: (draft: LayoutDraft, path: EntryPath) => LayoutDraft) => void;
}) {
  const descriptionId = useId();
  const kind = isFolder(entry) ? "folder" : "file";
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <IconPicker
            icon={entry.icon ?? null}
            onPick={(icon) => onChange((draft, path) => setIcon(draft, path, icon))}
          />
          <input
            aria-label="이름 틀"
            value={entry.pattern ?? ""}
            onChange={(event) => {
              const pattern = event.target.value;
              onChange((draft, path) => setPattern(draft, path, pattern));
            }}
            spellCheck={false}
            // 제목처럼 보이다가 가리키면 칸의 테두리가 선다 — 눌러서 고치는 제목이다.
            className={cn(
              "h-9 min-w-0 flex-1 rounded-[9px] border bg-transparent px-2 text-[18px] font-semibold outline-none transition-colors focus:border-primary",
              errors.length > 0 ? "border-red-500" : "border-transparent hover:border-border-strong",
            )}
          />
          <div
            role="radiogroup"
            aria-label="종류"
            className="flex shrink-0 gap-0.5 rounded-[9px] bg-state-1 p-0.5"
          >
            {(["file", "folder"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => onChange((draft, path) => setKind(draft, path, option))}
                className={cn(
                  "h-[26px] rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors",
                  kind === option ? "segment-on text-foreground" : "text-tertiary hover:text-foreground",
                )}
              >
                {option === "file" ? "파일" : "폴더"}
              </button>
            ))}
          </div>
        </div>
        <ErrorLines errors={errors} inset />
        {unknownIcon(entry) && (
          <p className="flex items-center gap-1.5 pl-[46px] text-[12.5px] leading-[1.6] text-amber-700 dark:text-amber-400">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            <span>
              모르는 아이콘 <code className="text-[12px]">{entry.icon}</code> — 앱이 그리지 않아요
            </span>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionId} className="text-[12.5px] text-tertiary">
          설명
        </label>
        <textarea
          id={descriptionId}
          rows={3}
          value={entry.description ?? ""}
          onChange={(event) => {
            const text = event.target.value;
            onChange((draft, path) => setDescription(draft, path, text));
          }}
          className={TEXTAREA}
        />
      </div>
      {kind === "file" && (
        <TemplateField
          template={entry.template ?? null}
          body={bodyOf(templates, entry)}
          folder={folder}
          onToggle={(on) => onChange((draft, path) => setTemplate(draft, path, on))}
          onBody={(text) => onChange((draft, path) => setTemplateBody(draft, path, text))}
        />
      )}
    </>
  );
}

/**
 * 파일 항목의 템플릿 칸(티켓 12 · 구현 스펙 5절 「배치」) — 「템플릿」 없음|있음. 있음이면 12줄 높이의 본문
 * 칸(세로로 늘인다)이 서고, 템플릿 경로는 그 칸의 오른쪽 위에 작게 적는다. **경로는 사람이 적지 않는다** —
 * 켤 때 편집기가 짓고(`setTemplate`), 여기는 보이기만 한다. 폴더 항목과 머리 `spec/`에는 이 칸이 없다.
 *
 * 템플릿 파일이 디스크에서 사라진 항목은 「있음」 그대로 빈 본문 칸과 경고가 선다(`templateMissing`). 칸에
 * 적거나 「없음」으로 바꾸면 풀린다.
 */
function TemplateField({
  template,
  body,
  folder,
  onToggle,
  onBody,
}: {
  template: string | null;
  body: string | null;
  folder: string;
  onToggle: (on: boolean) => void;
  onBody: (text: string) => void;
}) {
  const on = template !== null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="text-[12.5px] text-tertiary">
          템플릿
        </span>
        <div
          role="radiogroup"
          aria-label="템플릿"
          className="flex shrink-0 gap-0.5 rounded-[9px] bg-state-1 p-0.5"
        >
          {[false, true].map((option) => (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={on === option}
              onClick={() => onToggle(option)}
              className={cn(
                "h-6 rounded-[7px] px-[9px] text-[12px] font-medium transition-colors",
                on === option ? "segment-on text-foreground" : "text-tertiary hover:text-foreground",
              )}
            >
              {option ? "있음" : "없음"}
            </button>
          ))}
        </div>
        {on && (
          <span
            title={`${folder}/${template}`}
            className="ml-auto min-w-0 truncate font-mono text-[11px] text-tertiary"
          >
            {folder}/{template}
          </span>
        )}
      </div>
      {on && body === null && (
        <p className="flex items-center gap-1.5 text-[12.5px] leading-[1.6] text-amber-700 dark:text-amber-400">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
          <span>레이아웃 폴더에 이 템플릿 파일이 없어요</span>
        </p>
      )}
      {on && (
        <textarea
          aria-label="템플릿 본문"
          rows={12}
          value={body ?? ""}
          onChange={(event) => onBody(event.target.value)}
          spellCheck={false}
          className={cn(TEXTAREA, "font-mono text-[12.5px]")}
        />
      )}
    </div>
  );
}

/** 항목이 가리키는 템플릿의 본문. 템플릿이 없거나 본문 맵에 그 경로가 없으면(누락) `null`이다. */
function bodyOf(templates: TemplateBodies, entry: LayoutEntryJson): string | null {
  const template = entry.template;
  return template !== undefined && Object.prototype.hasOwnProperty.call(templates, template)
    ? templates[template]
    : null;
}

// 팝오버의 칸 — 「아이콘 없음」과 표의 이름들, 표에 적힌 순서다(`SPEC_ICONS`의 머리말).
const ICON_CHOICES: (SpecIconName | null)[] = [null, ...(Object.keys(SPEC_ICONS) as SpecIconName[])];

/**
 * 제목 옆의 아이콘 칸. 누르면 팝오버에서 앱의 아이콘 표(`SPEC_ICONS`)로 고른다. 칸은 지금 아이콘을
 * 그린다 — 없으면 흐린 「없음」, 모르는 이름이면 경고다.
 *
 * 키보드는 설정의 ⋯ 메뉴(`RevertMenu`)와 같다 — 열리면 고른 칸에 포커스가 가고, Esc는 닫기만 하며 포커스를
 * 칸으로 돌려준다(팝오버가 body 끝에 떠 있어 안 돌려주면 포커스가 `<body>`로 떨어진다).
 */
function IconPicker({ icon, onPick }: { icon: string | null; onPick: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const Current = specIconOf(icon);
  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label="아이콘 바꾸기"
        aria-expanded={open}
        title={icon ?? "아이콘 없음"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
          open ? "border-primary bg-primary/10" : "border-border bg-background quiet-hover",
        )}
      >
        {Current ? (
          <Current aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={1.9} />
        ) : icon !== null ? (
          <TriangleAlert
            aria-hidden
            className="size-[18px] text-amber-700 dark:text-amber-400"
            strokeWidth={1.9}
          />
        ) : (
          <Ban aria-hidden className="size-[18px] text-tertiary opacity-60" strokeWidth={1.9} />
        )}
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={268}
          onClose={() => setOpen(false)}
          // 지금 고른 칸에 포커스가 간다 — 모르는 이름이라 고른 칸이 없으면 첫 칸(「아이콘 없음」)이다.
          onPlaced={(card) =>
            (
              card.querySelector<HTMLElement>('[aria-checked="true"]') ??
              card.querySelector<HTMLElement>('[role="radio"]')
            )?.focus()
          }
        >
          <div
            role="radiogroup"
            aria-label="아이콘"
            onKeyDown={onKeyDown}
            className="grid grid-cols-7 gap-0.5 p-1.5"
          >
            {ICON_CHOICES.map((choice) => {
              const Glyph = choice === null ? Ban : SPEC_ICONS[choice];
              const checked = choice === icon;
              const name = choice ?? "아이콘 없음";
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={name}
                  title={name}
                  onClick={() => {
                    onPick(choice);
                    close();
                  }}
                  className={cn(
                    "flex h-[34px] items-center justify-center rounded-[8px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                    checked ? "toggle-on" : "text-muted-foreground quiet-hover",
                  )}
                >
                  <Glyph aria-hidden className="size-4" strokeWidth={1.9} />
                </button>
              );
            })}
          </div>
        </PopoverPortal>
      )}
    </>
  );
}

/**
 * 읽지 못하는 레이아웃(티켓 11) — **편집 UI를 세우지 않는다.** 까닭(엔진이 준 오류 전부)과 설정으로
 * 돌아가는 길만 보인다. 고치는 길은 설정의 모드 행에 있다: 에이전트에게 부탁, 손으로 고치기, 되돌리기.
 * 어느 쪽이든 감시가 따라온다.
 */
export function UnreadableLayout({
  read,
  onBack,
}: {
  read: UnreadableSpecLayout;
  onBack: () => void;
}) {
  return (
    <div className="flex max-w-[620px] flex-col items-start gap-3 px-8 pt-2">
      <div className="flex items-start gap-2">
        <TriangleAlert
          aria-hidden
          className="mt-[3px] size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
          strokeWidth={2}
        />
        <div className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-[1.6]">
          <span className="text-amber-700 dark:text-amber-400">
            {layoutDirRef(read.folder)} 레이아웃을 읽지 못해 편집할 수 없어요
          </span>
          {/* 까닭은 엔진의 글 그대로다 — 자리는 엔진이 적는 모양(`root.children[1]`)으로 앞에 붙인다. */}
          {read.errors.map((error, index) => (
            <span key={index} className="break-words text-tertiary">
              {error.path === null ? error.message : `${placeOf(error.path)}: ${error.message}`}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover"
      >
        설정으로 돌아가기
      </button>
    </div>
  );
}

/** 오류의 자리를 엔진이 적는 모양으로 — `[1, 0]` → `root.children[1].children[0]`. */
function placeOf(path: number[]): string {
  return ["root", ...path.map((index) => `children[${index}]`)].join(".");
}

export default SpecLayoutEditor;
