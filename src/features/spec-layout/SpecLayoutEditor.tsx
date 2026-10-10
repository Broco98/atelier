import {
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
import { Card, CardHead, Frame } from "@/components/shell/Frame";
import { WORK_PANEL_WIDTH } from "@/components/shell/panel-layout";
import { Button } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import { Crumbs } from "@/components/ui/crumbs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentGroup, SegmentGroupItem } from "@/components/ui/segment-group";
import { textareaLook } from "@/components/ui/textarea-look";
import { Hint } from "@/components/ui/tooltip";
import { settingsItem } from "@/features/settings/pages";
import { SettingsBody, SettingsGroup, SettingsRow, SettingsSection } from "@/features/settings/SettingsGroup";
import { SPEC_ICONS, specIconOf, type SpecIconName } from "@/features/works/spec-icons";
import { layoutDirRef } from "@/features/works/refs";
import { armDrag, cancelPress, dragStore, type DragPoint } from "@/lib/pointer-drag";
import { cn } from "@/lib/utils";
import {
  addEntry,
  contentOf,
  dropEntry,
  dropPlaceAt,
  editsAt,
  entryAt,
  followSelection,
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
import { judgeOutside, savedBaseline, type BannerVerdict } from "./outside";
import { canSave } from "./preview";
import PreviewDialog from "./PreviewDialog";
import {
  LAYOUT_NAME,
  type LayoutEntryJson,
  type LayoutError,
  type SpecLayoutRead,
  type TemplateBodies,
  type UnreadableSpecLayout,
} from "./types";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11 · 결정 11·20·26). 설정 한 열(설정 틀의 본문) 안이 아니라 설정 nav
// 항목 「spec 레이아웃」의 하위 주소(`/settings/spec-layout/edit`)에 선 **별도 화면**이다 — 고른 항목의 폼과 항목 트리,
// 카드 둘이 선다. 폼은 왼쪽 본문 카드에 설정 틀(`SettingsGroup.tsx`)로, 트리는 그 오른쪽 카드에 선다 — 작업 화면의 spec 패널과
// 같은 쪽 · 같은 폭이다(판 06 티켓 07). 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다.
//
// **이 화면의 주된 쓰임은 마지막 손질이다**(결정 20). 레이아웃은 대부분 에이전트가 고치고, 사람은 여기서
// 한 칸을 고친다. 그래서 머리에는 뒤로, 위치, 「LLM이 받는 텍스트」, 저장만 둔다 — 배지, 오류 개수, 「저장하지
// 않은 변경」, 부탁 버튼, 설명 문구, 도움말은 두지 않는다(구현 스펙 5절 「배치」).
//
// **규칙이 없다**(결정 13). 초안을 고치는 것은 `draft.ts`의 순수 함수이고, 이름 틀이 맞는지·폴더에 자식이
// 있어도 되는지는 엔진의 검증이 판정한다. 편집기는 초안이 바뀔 때마다 짧은 지연 뒤에 엔진에 묻고(미리보기,
// 티켓 14), 그 오류는 데이터로 와서(`{ path, message }`) 그 자리의 항목 제목 아래에 붉은 줄로 서며 저장을
// 잠근다. 같은 답의 글이 「LLM이 받는 텍스트」 팝업에 선다.
//
// 항목을 더하고 지우고 옮기는 것은 트리 카드의 머리 한 줄과 트리 자신이다(티켓 13). 옮기는 주된 길은 **끌어다 놓기**이고
// (공용 끌기 모듈을 딛는다), 옮기기 버튼 넷과 ⌥↑ ⌥↓ ⌥← ⌥→는 키보드 길이다.
//
// **저장은 이 화면의 `save` 하나다** — 머리의 [저장]과 떠날 때 창의 [저장하고 나가기]가 부른다. 설정 초안의 저장
// 버튼과 따로이고, 둘 중 하나를 누르기 전에는 아무것도 쓰지 않는다.
// 저장하지 않은 초안을 두고 떠나면 묻는다(티켓 15, `leave.ts`). 레이아웃이 밖에서 바뀌면 초안이 없을 때는 조용히
// 따라가고, 있으면 폼 카드 머리 아래의 배너로 한쪽을 고르게 한다(`outside.ts`).

/** 편집기 주소를 연다 — 레이아웃을 읽어, 읽을 수 있으면 편집 UI를, 없으면 까닭과 돌아가는 길을 세운다. */
function SpecLayoutEditor({ sidebarOpen }: { sidebarOpen: boolean }) {
  const read = useQuery(specLayoutReadQuery());
  const navigate = useNavigate();
  // 뒤로는 「spec 레이아웃」 설정 페이지다 — 편집기로 오는 문이 거기 한 곳(레이아웃 행의 [편집])이라, 히스토리를 되감지
  // 않고 늘 그 자리로 간다. 주소로 바로 와도 같은 곳에 선다. 저장하지 않은 초안이 있으면 떠나기 전에 묻는다(티켓 15).
  const back = () => void navigate({ to: "/settings/spec-layout" });
  const data = read.data;

  // 한 번 읽었으면 그 뒤로 다시 읽히는 것은 편집 화면이 받는다 — 밖에서 깨지거나 고쳐져도 화면이 내려가지 않아야
  // 초안이 산다(티켓 15).
  if (data !== undefined) {
    return <EditorScreen read={data} sidebarOpen={sidebarOpen} onBack={back} />;
  }
  return (
    <EditorFrame sidebarOpen={sidebarOpen} onBack={back}>
      {/* 읽기 자체가 실패한 길(IPC). 레이아웃 폴더가 깨진 것은 여기가 아니라 편집 화면의 「읽지 못함」이다. */}
      {read.error !== null && (
        <FormBody>
          <div className="flex flex-col items-start gap-3">
            <p className="text-chat-meta text-danger">{String(read.error)}</p>
            {/* 쪽 동작 버튼이다 — 설정 파일 읽기 게이트의 [다시 읽기]와 같다(`Button`의 ghost · sm). */}
            <Button variant="ghost" size="sm" onClick={() => void read.refetch()}>
              다시 읽기
            </Button>
          </div>
        </FormBody>
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
  read,
  sidebarOpen,
  onBack,
}: {
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

  // 새로 읽은 것을 받는다 — 초안을 버리고 그것을 보인다. 고르던 항목이 새것에도 있으면 자리가 밀렸어도 그 항목을
  // 고르고, 지워졌으면 그 바로 위에 보이던 행을 고른다(`followSelection`). 깨졌으면 「읽지 못함」 화면이라 미리보기
  // 팝업도 닫는다 — 열린 채로 두면 고쳐져 편집 UI가 돌아올 때 저절로 다시 뜬다. 누르거나 끄던 항목이 있으면
  // 트리(`EntryTree`)가 그 눌림을 거둔다.
  const take = (fresh: SpecLayoutRead) => {
    const next = viewOf(fresh, view);
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
  const { preview, reserve } = useDraftPreview(draft, read);
  // 팝업을 여는 머리의 버튼 — 팝업이 닫히면 포커스가 여기로 돌아온다(`PreviewDialog`).
  const opener = useRef<HTMLButtonElement>(null);
  // **제 저장** — 쓰였으면 기준본이 저장한 것이 되고, 선 배너는 걷힌다(저장이 밖의 변경을 덮었다). 그래서 제 저장이
  // 부른 다시 읽기는 판정 1번(무시)에 걸린다. 이 바꿈은 **다시 읽기가 도착하기 전에 그려져 있어야** 하므로 저장의
  // 무효화보다 먼저, 곧바로 그린다(`flushSync`) — 미루면 다시 읽힌 답이 옛 기준본과 견줘져 제 저장을 밖 변경으로 읽는다.
  const write = useWriteSpecLayout((written) =>
    flushSync(() => {
      setBaseline((before) => savedBaseline(before, written));
      setOutside(null);
    }),
  );
  // 기준본의 내용 — 깨졌으면 `null`이다(어떤 초안이든 저장하지 않은 것이다).
  const baselineContent = contentOf(baseline);
  const enabled = draft !== null && canSave({ draft, baseline: baselineContent, preview, saving: write.isPending });

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
      const answer = await write.mutateAsync(saved);
      if (answer.errors.length === 0) return true;
      refused({ text: null, lines: [], errors: answer.errors, warnings: [] });
    } catch (e) {
      await showProblem(`저장하지 못했습니다: ${e}`);
    }
    return false;
  };

  // 저장하지 않은 초안을 두고 떠나면 묻는다 — 뒤로, 사이드바 nav, 팔레트, 설정 nav의 다른 항목, 히스토리의 뒤로·앞으로(티켓 15).
  useConfirmLeave({ unsaved: draft !== null && unsaved(draft, baselineContent), savable: enabled, save });

  if (view === null) {
    return (
      <EditorFrame sidebarOpen={sidebarOpen} onBack={onBack}>
        {"errors" in baseline && (
          <FormBody>
            <UnreadableLayout read={baseline} onBack={onBack} />
          </FormBody>
        )}
      </EditorFrame>
    );
  }

  // 마지막으로 받은 답의 오류 — 초안을 고친 직후에는 아직 앞 초안의 것이다. 지연 뒤의 답이 그것을 바꾼다. 폼(항목 제목 아래의
  // 붉은 줄)과 트리(행 끝의 표시)가 같은 답을 읽는다.
  const errors = preview?.answer.errors ?? [];

  return (
    <EditorFrame
      sidebarOpen={sidebarOpen}
      onBack={onBack}
      actions={
        <>
          {/* 카드 머리의 알약이다(`Button` outline · pill — ui-refresh 결정 5 · 6, 프로토타입 `Settings-editor`). 아이콘은 글자
              앞에 선다(`data-icon="inline-start"`). 창을 여는 버튼이지만 「창을 연다」·「열렸다」(`aria-haspopup` ·
              `aria-expanded`)를 달지 않는다 — 앱의 창 여는 버튼(전체화면 뷰어 · 이름 바꾸기)과 같다: 창이 뜨면 창이
              제 이름을 읽히고 뒤는 가려지므로, 버튼에 붙인 두 말은 읽는 말만 늘린다(develop 구현 스펙 「전체화면 뷰어」). */}
          <Button ref={opener} variant="outline" size="pill" onClick={() => setPreviewOpen(true)}>
            <Eye data-icon="inline-start" aria-hidden />
            LLM이 받는 텍스트
          </Button>
          {/* 주 버튼(`Button` 기본)이다 — 설정의 [저장]과 같은 부품이고, 카드 머리라 알약 크기에 선다. 파란 알약은 글자가
              주 버튼의 굵기(500)다 — 부품이 든다(DS `.at-pill.primary`). */}
          <Button size="pill" onClick={() => void save()} disabled={!enabled}>
            {write.isPending ? "저장 중…" : "저장"}
          </Button>
        </>
      }
      tree={
        <TreeCard
          draft={view.draft}
          selected={view.selected}
          errors={errors}
          onSelect={(path) => setView((now) => now && { ...now, selected: path })}
          // 할 수 없는 조작(`null`)은 같은 상태를 돌려준다 — 다시 그리지 않는다.
          onEdit={(edit) => setView((now) => now && (edit(now.draft) ?? now))}
        />
      }
    >
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        opener={opener}
        answer={preview?.answer ?? null}
        selected={view.selected}
      />
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
      <EntryForm
        draft={view.draft}
        folder={read.folder}
        selected={view.selected}
        errors={errors}
        onChange={(change) => setView((now) => now && { ...now, draft: change(now.draft) })}
      />
    </EditorFrame>
  );
}

/**
 * 읽은 것을 펼친 편집 상태 — 초안과 고른 자리. 깨졌으면 펼칠 것이 없어 `null`이다(「읽지 못함」 화면). 앞 상태
 * (`before`)에서 고르던 항목이 새것에도 있으면 그 항목을 고른다 — 자리가 아니라 이름 틀로 따라간다. 이름 틀을 고친
 * 항목이면 같은 자리를, 지워졌으면 휴지통처럼 그 바로 위에 보이던 행을 고른다 — 그 자리로 당겨 온 형제를 고르지 않는다.
 * 처음 열 때나 부모까지 사라졌으면 첫 최상위 항목을, 항목이 없으면 머리 `spec/`(방침 문단)을 고른다(`followSelection`).
 */
function viewOf(read: SpecLayoutRead, before: TreeEdit | null): TreeEdit | null {
  const draft = contentOf(read);
  if (draft === null) return null;
  return { draft, selected: followSelection(before, draft.layout) };
}

/** 배너의 뜻 셋(구현 스펙 5절). */
const OUTSIDE_MESSAGE: Record<BannerVerdict, string> = {
  changed: "밖에서 이 레이아웃이 바뀌었어요",
  broken: "밖에서 이 레이아웃이 깨졌어요",
  removed: "밖에서 지워졌어요",
};

/**
 * 밖 변경 배너(티켓 15 · 결정 22) — 초안이 있는데 레이아웃이 밖에서 바뀌면 폼 카드 몸의 맨 위에 한 줄로 선다. 한쪽을
 * 고르게 할 뿐 합치지 않는다. [새로 불러오기]는 초안을 버리고 새로 읽은 것을 보인다(깨졌으면 「읽지 못함」 화면이다).
 * [내 초안 유지]는 배너를 닫고 기준본만 새것으로 바꾼다.
 *
 * 자리는 카드 머리 바로 아래이고 폼과 같은 글 폭(`--measure-read`) 가운데다 — 설정 페이지의 메시지(`PageNotice`)와 같은 나눔이다.
 * 폼과 함께 구르지 않는다(스크롤 상자 밖). 모양은 경고색(`warning`) 띠다 — 묶음의 옅은 면(ui-refresh 결정 16)이 아니다: 폼의 묶음과 같은 면이면
 * 알림이 폼의 한 행으로 읽힌다(판 06 티켓 07).
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
    <div className="shrink-0 px-(--card-pad)">
      {/* 폼 카드가 좁으면(최소 창) 두 버튼이 다음 줄로 내려간다 — 글이 한 글자씩 꺾여 세로로 서지 않게 글에 최소 폭을 둔다. */}
      <div
        role="alert"
        className="mx-auto flex max-w-(--measure-read) flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warning/10 py-1.5 pr-1.5 pl-4"
      >
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-40 flex-1 text-chat-meta font-medium text-warning">
          {OUTSIDE_MESSAGE[verdict]}
        </span>
        {/* 두 버튼은 경고색 띠의 것이라 `Button`의 변형이 없다(develop도 그 띠를 손으로 짓는다). 흰 버튼의 hover는
            앱의 버튼 농도(`fill-hover` — `quiet-hover`)다. */}
        <button
          type="button"
          onClick={onReload}
          className="h-7 shrink-0 whitespace-nowrap rounded-lg border border-warning/30 bg-surface px-3 text-sm font-medium text-fg transition-colors quiet-hover"
        >
          새로 불러오기
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="h-7 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-warning transition-colors hover:bg-warning/10"
        >
          내 초안 유지
        </button>
      </div>
    </div>
  );
}

/**
 * 편집기의 틀 — 공용 틀 위의 본문 카드(ui-refresh 결정 27)와 그 카드 머리(뒤로 · 위치 · 동작), 그리고 편집할 때는 그 오른쪽의
 * 트리 카드(`tree`). 바탕 줄은 비어 있는 끌기 줄이다(ui-refresh 결정 5). 위치는 세 칸이다: `Settings › spec 레이아웃 › Atelier`.
 * 가운데 칸은 설정 nav 항목 표에서 읽는다 — 머리와 nav가 각자 라벨을 들면 이름을 고치는 날 한쪽만 바뀐다.
 *
 * **트리 카드는 공용 틀의 패널 칸(`Frame`의 `panel`)이 아니라 옆 칸(`beside`)이다**(판 06 티켓 07). 패널 칸은 두 번째 `<aside>`를
 * 그리고 접힘 · 폭 손잡이를 요구하는데, 편집기 트리는 레일 · 패널 토글 · 폭 조절이 없는 늘 열린 카드다. 칸의 틈 · 끌기 영역 · 좁은
 * 창에서 자리를 내주는 것은 그 칸이 든다(ui-refresh 결정 27) — 이 화면은 카드의 안과 폭만 건넨다.
 */
function EditorFrame({
  sidebarOpen,
  onBack,
  actions,
  tree,
  children,
}: {
  sidebarOpen: boolean;
  onBack: () => void;
  actions?: ReactNode;
  /** 오른쪽 트리 카드의 안(`TreeCard`) — 편집할 때만 선다. 읽는 중 · 읽지 못함 화면은 본문 카드 하나다. */
  tree?: ReactNode;
  children: ReactNode;
}) {
  const name = LAYOUT_NAME;
  return (
    <Frame
      sidebarOpen={sidebarOpen}
      // 트리 카드의 폭은 작업 패널의 기본 폭(`WORK_PANEL_WIDTH`)이다 — 작업 화면의 spec 패널과 같은 쪽 · 같은 폭(판 06 티켓 07).
      // 폭 조절 · 접기는 없다.
      beside={tree === undefined ? undefined : { label: "항목 트리", width: WORK_PANEL_WIDTH, children: tree }}
    >
      <Card
        as="main"
        label={`${name} 레이아웃 편집기`}
        // **최소 폭은 머리의 조작(뒤로 · 「LLM이 받는 텍스트」 · 「저장」)이 다 서는 폭이고, 수가 아니라 그 조작들의 폭에서 나온다**
        // (`min-w-min`). 글자가 시스템 글꼴이라 글자 폭이 OS마다 달라(codex-ds 결정 3) 손으로 잰 수는 한쪽 OS에서 「저장」을 자른다.
        // 그래서 카드의 min-content에 머리만 든다 — 몸은 제 내용 폭을 바깥에 안 알리고(`contain-inline-size`), 위치 캡슐도 그 칸이
        // 알리지 않아(아래) 줄어 말줄임이 받는다. 트리 카드가 이 폭을 남기고 자리를 내준다(공용 틀의 옆 칸).
        className="min-w-min flex-1 [&>:not([data-slot=card-head])]:contain-inline-size"
        head={
          <CardHead
            lead={
              // 카드 머리의 원형 아이콘 버튼이다(`size="icon-round"` — ui-refresh 결정 6).
              <Button variant="outline" size="icon-round" onClick={onBack} aria-label="설정으로 돌아가기">
                <ArrowLeft aria-hidden />
              </Button>
            }
            end={actions}
          >
            {/* 위치 캡슐의 칸 — 남는 폭을 다 받고 제 글자 폭은 바깥에 안 알린다(`contain-inline-size`). 칸의 바닥 28은 캡슐의
                좌우 안쪽 여백(`px-3.5` 둘)이다 — 그보다 좁으면 빈 캡슐이 옆 조작 위로 삐져나온다. */}
            <div className="flex min-w-7 flex-1 contain-inline-size">
              <Crumbs items={["Settings", settingsItem("spec-layout").label, name]} />
            </div>
          </CardHead>
        }
      >
        {/* 제목 역할은 이 줄이 진다 — 카드 머리의 위치(`Crumbs`)는 제목 역할이 없는 글자다(설정 페이지와 같다). */}
        <h2 className="sr-only">{name} 레이아웃</h2>
        {children}
      </Card>
    </Frame>
  );
}

/**
 * 폼 카드의 몸 — 카드 안 여백(`--card-pad`)을 든 스크롤 상자와 그 안의 설정 틀 몸(`SettingsBody` — 읽는 폭 `--measure-read`
 * 가운데, ui-refresh 결정 12). 설정 페이지와 같은 나눔이다 — 여백을 폭 상자 밖에 두어 글 폭이 760 그대로다. 이름(`label`)을 주면
 * 그 이름의 영역(`section`)이다.
 */
function FormBody({ label, children }: { label?: string; children: ReactNode }) {
  const Tag = label === undefined ? "div" : "section";
  return (
    <Tag aria-label={label} className="min-h-0 flex-1 overflow-y-auto px-(--card-pad) pb-(--card-pad) scroll-quiet">
      <SettingsBody>{children}</SettingsBody>
    </Tag>
  );
}

/**
 * 고른 자리를 초안에 맞춘 것 — 고른 항목과 그 자리. 고른 자리가 초안에 없으면(항목이 사라졌다) 머리 `spec/`을 고른 것으로 친다.
 * 폼과 트리가 같은 답을 읽는다 — 한쪽만 머리로 돌아가면 트리의 눌림과 폼의 칸이 다른 항목을 말한다.
 *
 * 고른 자리는 맨 위 항목에서부터의 인덱스 경로다. **`[]`이 트리 카드의 머리 `spec/`이다** — 맨 위 항목(spec 폴더 자신)은
 * 트리의 행이 아니고(결정 26), 머리를 누르면 그 설명(방침 문단) 칸 하나만 선다.
 */
function selectionOf(draft: LayoutDraft, selected: EntryPath): { entry: LayoutEntryJson | null; at: EntryPath } {
  const entry = selected.length === 0 ? null : entryAt(draft.layout, selected);
  return { entry, at: entry === null ? [] : selected };
}

/**
 * 고른 항목의 폼 — 본문 카드의 몸이다(판 06 티켓 07). 값을 들지 않는다: 초안과 고른 자리를 받아 그리고, 고친 것은 초안을 고치는
 * 함수로 돌려준다(마크업 테스트가 클릭을 못 건다 — `SpecLayoutSection`과 같은 이유). 아이콘 팝오버가 열렸는지만 그 자리가 든다.
 *
 * 폼은 설정 틀이다 — 큰 제목(이름 틀) 아래 묶음 행(`SettingsGroup` · `SettingsRow`). 고친 것은 **지금 초안을 받는 함수**로
 * 돌려준다(`onChange`) — 트리 카드의 조작과 같은 손버릇이다.
 */
export function EntryForm({
  draft,
  folder,
  selected,
  errors,
  onChange,
}: {
  draft: LayoutDraft;
  /** 레이아웃 폴더 — 홈은 `~`로 줄였고 끝에 `/`가 없다. 템플릿 경로 표시가 이 아래에 선다. */
  folder: string;
  selected: EntryPath;
  errors: LayoutError[];
  onChange: (change: (draft: LayoutDraft) => LayoutDraft) => void;
}) {
  const { entry, at } = selectionOf(draft, selected);
  const errorsAt = (path: EntryPath) => errors.filter((error) => samePath(error.path, path));
  const documentErrors = errors.filter((error) => error.path === null);

  return (
    <FormBody label="고른 항목">
      {/* 자리가 없는 오류(문서 전체의 것) — 고를 항목이 없으니 어느 항목을 골라도 선다. */}
      {documentErrors.length > 0 && (
        <div className="mb-5">
          <ErrorLines errors={documentErrors} />
        </div>
      )}
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
    </FormBody>
  );
}

/**
 * 항목 트리 카드의 안 — 카드는 본문 카드 오른쪽에 선다(판 06 티켓 07 · 「같은 날 더 정한 것」 편집기 트리 오른쪽). 카드 상자 · 이름 ·
 * 폭은 공용 틀의 옆 칸이 그린다(`EditorFrame` — 작업 패널의 기본 폭). 머리는 트리를 고치는 도구 한 줄(`TreeTools`)이고, 몸은 머리
 * `spec/`과 트리다. 카드가 흰 면이라 트리에 따로 바탕을 칠하지 않는다.
 *
 * 값을 들지 않는다 — 폼과 같다. 끄는 동안 어디를 겨눴는지만 트리가 든다. 트리를 고치는 것(`onEdit`, 티켓 13)은 고른 자리도 함께
 * 바꾼다(`TreeEdit`). **지금 초안을 받는 함수**로 돌려준다: 끌기의 손잡이는 누른 순간의 렌더에서 만들어져, 그 클로저의 초안은
 * 놓을 때 낡았을 수 있다.
 */
export function TreeCard({
  draft,
  selected,
  errors,
  onSelect,
  onEdit,
}: {
  draft: LayoutDraft;
  selected: EntryPath;
  errors: LayoutError[];
  onSelect: (path: EntryPath) => void;
  onEdit: (edit: (draft: LayoutDraft) => TreeEdit | null) => void;
}) {
  const { at } = selectionOf(draft, selected);
  return (
    <>
      <CardHead>
        <TreeTools
          edits={editsAt(draft, at)}
          onAdd={(kind) => onEdit((current) => addEntry(current, at, kind))}
          onMove={(move) => onEdit((current) => moveEntry(current, at, move))}
          onRemove={() => onEdit((current) => removeEntry(current, at))}
        />
      </CardHead>
      {/* 좌우 여백은 카드 머리와 같다(DS `.at-card-body.tight`) — 머리의 알약과 트리의 행이 한 세로선에 선다. 머리와 첫 행
          사이는 트리 줄 사이와 같은 2px 틈이다(DS `.at-tree`). */}
      <div className="shrink-0 px-[calc(var(--card-pad)-14px)] pb-(--row-gap)">
        {/* 머리 `spec/`은 항목이 아니다(결정 26) — 끌기·지우기·옮기기의 대상이 아니고, 누르면 spec 폴더 안내(맨 위 항목의
            설명) 칸 하나만 연다. 그래서 행(treeitem)이 아니라 머리의 버튼이다. 모양은 트리의 행이고 폴더 행처럼 한 단 흐리다
            (DS `.at-tree-row.folder`). 도움말은 누르면 서는 칸의 이름이다 — 이름(`spec/`)보다 더 말하는 것이라 설명으로도
            남는다(S28). */}
        <Hint
          text="spec 폴더 안내"
          announce="description"
          type="button"
          onClick={() => onSelect([])}
          aria-pressed={at.length === 0}
          className={cn(
            "flex h-7 w-full items-center gap-[7px] rounded-lg px-2 text-left text-chat-meta transition-colors",
            at.length === 0 ? "selected-row font-medium" : "text-fg-secondary hover:bg-fill-soft",
          )}
        >
          <Folder aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
          <span>spec/</span>
        </Hint>
      </div>
      <EntryTree draft={draft} at={at} errors={errors} onSelect={onSelect} onEdit={onEdit} />
    </>
  );
}

/**
 * 트리 카드의 머리 한 줄(티켓 13 · 구현 스펙 5절 「배치」) — 파일 추가, 폴더 추가, 옮기기 넷, 지우기(휴지통). 옮기는 주된
 * 길은 끌어다 놓기이고, 옮기기 넷과 그 단축키(⌥↑ ⌥↓ ⌥← ⌥→)는 키보드 길로 남긴 것이다.
 *
 * 모양은 카드 머리의 조작이다(판 06 티켓 07, 프로토타입 `Settings-editor`): 더하기 둘은 작은 흰 알약(DS `.at-pill.sm`), 옮기기
 * 넷과 지우기는 28px 원형 아이콘 버튼(DS `.at-icon-btn` — 14px 글리프)이고 오른쪽 끝에 붙어 선다. 옮기기 넷에 묶음 바탕은 없다.
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
    <div role="toolbar" aria-label="항목 편집" className="flex min-w-0 flex-1 items-center gap-1.5">
      {/* 도움말은 이름과 같은 글자라 눈에만 뜬다(S28) — 보이는 글자(「파일」)보다 긴 이름을 보여 줄 뿐이다. 작은 흰 알약이다
          (`size="pill-sm"` — Archive 정렬 알약과 같다). */}
      {(["file", "folder"] as const).map((kind) => (
        <Hint
          key={kind}
          text={ADD_LABEL[kind]}
          aria-label={ADD_LABEL[kind]}
          render={<Button variant="outline" size="pill-sm" onClick={() => onAdd(kind)} />}
        >
          <Plus aria-hidden />
          {kind === "file" ? "파일" : "폴더"}
        </Hint>
      ))}
      <div className="ml-auto flex shrink-0 items-center">
        <div role="group" aria-label="고른 항목 옮기기" className="flex items-center">
          {/* 이름이 없는 아이콘 버튼이라 툴팁 글자가 이름이고, 단축키는 Kbd로 붙어 설명으로도 남는다(S28). 잠기면
              툴팁이 없다(S23) — 버튼이 네이티브 `disabled`다. 모양은 `icon-button` 한 곳이 들고, 크기만 이 자리가 준다(S41). */}
          {MOVE_TOOLS.map(({ move, label, keys, Icon }) => (
            <Hint
              key={move}
              text={label}
              shortcut={keys}
              announce="name"
              disabled={!edits[move]}
              render={
                <button
                  type="button"
                  onClick={() => onMove(move)}
                  disabled={!edits[move]}
                  className="icon-button size-7 text-fg-secondary transition-colors quiet-hover disabled:pointer-events-none disabled:opacity-35"
                />
              }
            >
              <Icon aria-hidden className="size-3.5" />
            </Hint>
          ))}
        </div>
        {/* 휴지통은 붉고(Codex `danger`), 가리키면 붉은 면이 한 겹 서서 더 짙게 읽힌다(프로토타입 뒤 사용자 선택 — 짙은
            붉은 글자의 토큰이 없어 면으로 말한다). 머리 `spec/`을 골랐으면 지울 것이 없어 흐린 붉은색으로 잠긴다 — 잠긴 동안에는
            가리켜도 바뀌지 않고 툴팁도 없다(S23). 도움말 「지우기」는 눈에만 뜬다 — 이름(「고른 항목 지우기」)이 이미 더
            말한다(S28). */}
        <Hint
          text="지우기"
          disabled={!edits.remove}
          render={
            <button
              type="button"
              onClick={onRemove}
              disabled={!edits.remove}
              aria-label="고른 항목 지우기"
              // 모양은 `icon-button` 한 곳이 들고, 크기만 이 자리가 준다(S41) — 옆 옮기기 넷과 같다.
              className={cn(
                "icon-button size-7 transition-colors",
                edits.remove ? "text-danger hover:bg-danger/10" : "text-danger/35",
              )}
            />
          }
        >
          <Trash2 aria-hidden className="size-3.5" />
        </Hint>
      </div>
    </div>
  );
}

/** 더하기 둘의 이름 — 보이는 글자는 종류(「파일」·「폴더」)뿐이다. */
const ADD_LABEL: Record<"file" | "folder", string> = { file: "파일 항목 추가", folder: "폴더 항목 추가" };

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

  // **누르거나 끄는 도중 초안이 바뀌면 그 눌림을 거둔다** — 끌기는 놓기 전까지 초안이 아니라, 그동안 밖 변경은 트리를
  // 조용히 갈아 끼운다(판정 3번). 끌리는 항목(`from`)과 흐려진 행이 인덱스 경로라 새 트리에서는 다른 항목을 가리킨다 —
  // 그대로 두면 놓는 순간 그 자리에 새로 선 항목이 옮겨 간다. 문턱 뒤면 Esc처럼 아무것도 안 부른다.
  //
  // **문턱 전의 눌림도 거둔다.** `from`은 누른 순간 잡은 인덱스 경로라, 남겨 두면 문턱에서 그 경로의 새 항목으로 끌기가
  // 선다. 작업 행 목록(UI개선 스펙 S8)이 문턱 전을 두는 것과 다른 까닭이다 — 그쪽 원천은 slug라 목록이 바뀌어도 같은
  // 작업을 가리킨다. 제 놓기는 여기 걸리지 않는다 — 공용 모듈이 `drop`을 부르기 전에 눌림을 비워, 새 초안이 그려질 때는
  // 거둘 것이 없다.
  const seenDraft = useRef(draft);
  useEffect(() => {
    if (seenDraft.current === draft) return;
    seenDraft.current = draft;
    cancelPress("entry");
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
      // 줄 사이는 2px 틈이다(DS `.at-tree`). 좌우 여백은 카드 머리와 같고 스크롤 상자 **안**에 둔다 — 밖에 두면 행의 포커스 링이
      // 상자 가장자리에서 잘린다.
      className="flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto px-[calc(var(--card-pad)-14px)] scroll-quiet"
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

/**
 * 행의 왼쪽 여백 — 들여쓰기는 `spec` 패널의 트리와 같은 걸음(14px)이다. 깊이는 최상위가 1이고, 최상위 항목도 머리 `spec/`(8)
 * 아래 한 단 들어 선다 — 항목이 그 폴더 안에 있다는 것이 줄의 자리로 보인다(프로토타입 `Settings-editor`, 생성기 `ed_tree`).
 */
function rowIndent(depth: number): number {
  return 8 + depth * 14;
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
      <span className="size-1.5 shrink-0 rounded-full border-2 border-(--accent) bg-surface" />
      <span className="h-0.5 flex-1 rounded-full bg-(--accent)" />
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
 * 경고). 칸에 적으면 맵에 들어가 풀리고, 「없음」으로 바꿔도 풀린다. 그대로 두면 미리보기가 그 자리의 오류로
 * 알리고 저장이 잠긴다(저장도 같은 검증으로 거절한다).
 */
function templateMissing(templates: TemplateBodies, entry: LayoutEntryJson): boolean {
  return entry.kind === "file" && entry.template !== undefined && bodyOf(templates, entry) === null;
}

/**
 * 트리의 행 하나. 이름은 이름 틀이고, 폴더는 끝에 `/`가 붙는다. 아이콘은 표의 것이고, 없거나 모르는
 * 이름이면 종류의 흐린 글리프다. 모르는 아이콘·템플릿 누락과 검증 오류는 행 끝에 표시가 붙는다 — 어디를
 * 골라야 하는지 트리에서 보인다.
 *
 * 규격은 DS `.at-tree-row`다(판 06 티켓 02 · 07) — 28px · 모서리 10 · `text-chat-meta` · 14px `fg-tertiary` 글리프와 이름 사이 7px · hover
 * `fill-soft`, 고른 행은 `selected-row`에 굵기 500이다. 항목 행은 파일 · 폴더 모두 본문 글자색이다 — 한 단 흐린 것은 머리 `spec/`
 * 하나다(프로토타입 `Settings-editor`).
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
  // 경고(모르는 아이콘, 템플릿 누락)는 삼각형 하나에 모은다 — 무엇인지는 고른 항목의 폼이 적는다.
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
        "relative flex h-7 w-full shrink-0 items-center gap-[7px] rounded-lg pr-2 text-left text-chat-meta outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--accent)/50",
        drop === "inside"
          ? "bg-accent-soft text-fg ring-1 ring-inset ring-(--accent)"
          : selected
            ? "selected-row font-medium"
            : "text-fg hover:bg-fill-soft",
        hasError && "text-danger",
        dragged && "opacity-40",
      )}
    >
      <Glyph aria-hidden className={cn("size-3.5 shrink-0 text-fg-tertiary", !Known && "opacity-70")} />
      <span className="min-w-0 flex-1 truncate">
        {entry.pattern ?? ""}
        {folder ? "/" : ""}
      </span>
      {warnings.length > 0 && (
        <>
          <TriangleAlert aria-hidden className="size-3 shrink-0 text-warning" />
          <span className="sr-only">{warnings.join(", ")}</span>
        </>
      )}
      {hasError && (
        <>
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-danger" />
          <span className="sr-only">검증 오류</span>
        </>
      )}
      {(drop === "before" || drop === "after") && (
        <DropLine side={drop === "before" ? "top" : "bottom"} left={rowIndent(depth) - 4} />
      )}
    </button>
  );
}

/**
 * 제목 아래 줄(오류 · 모르는 아이콘 경고)의 왼쪽 여백 — 아이콘 상자(44)와 그 뒤 틈(6)이다. 줄이 이름 틀 칸의 왼쪽 끝에서 시작한다.
 */
const UNDER_TITLE = "pl-[50px]";

/**
 * 검증 오류의 붉은 줄들 — 엔진이 준 글 그대로다. `id`를 주면 줄마다 그 뒤에 번호를 붙인 id가 선다 — 칸이 그 줄들을
 * 제 설명으로 가리킨다(`lineIdsOf`).
 */
function ErrorLines({ errors, inset = false, id }: { errors: LayoutError[]; inset?: boolean; id?: string }) {
  return (
    <>
      {errors.map((error, index) => (
        <p
          key={index}
          id={id === undefined ? undefined : `${id}-${index}`}
          className={cn("text-chat-meta text-danger", inset && UNDER_TITLE)}
        >
          {error.message}
        </p>
      ))}
    </>
  );
}

/** `ErrorLines`에 `id`를 준 줄들을 가리키는 `aria-describedby` 값. 줄이 없으면 없다. */
function lineIdsOf(id: string, errors: LayoutError[]): string | undefined {
  return errors.length === 0 ? undefined : errors.map((_, index) => `${id}-${index}`).join(" ");
}

/**
 * 머리 `spec/`을 골랐을 때의 칸 하나 — 맨 위 항목의 설명, 안내문 맨 위의 방침 문단이다(결정 26). 묶음 행 하나이고 글상자는 행의
 * 아래 줄이다(설정 틀 — 판 06 티켓 07). 맨 위 항목의 오류(자리 `[]`)는 글상자 위에 선다.
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
    <SettingsGroup>
      <SettingsRow
        name="spec 폴더 안내"
        nameFor={id}
        below={
          <div className="flex flex-col gap-1.5">
            <ErrorLines errors={errors} />
            <textarea
              id={id}
              rows={9}
              value={description}
              onChange={(event) => onChange(event.target.value)}
              className={textareaLook}
            />
          </div>
        }
      />
    </SettingsGroup>
  );
}

/**
 * 고른 항목의 칸들 — 설정 틀이다(판 06 티켓 07, 프로토타입 `Settings-editor`). **큰 제목이 곧 이름 틀 칸이다** — 눌러서
 * 고친다. 제목 앞에 아이콘 상자(팝오버), 제목 아래에 그 자리의 검증 오류와 모르는 아이콘 경고가 선다. 그 아래 묶음의 행이
 * 종류(파일|폴더), 설명(아래 줄 글상자)이고, 파일 항목에는 템플릿 행이 더해진다(티켓 12). 행의 이름 글자는 칸 이름 그대로다.
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
  const errorsId = useId();
  const kind = isFolder(entry) ? "folder" : "file";
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <IconPicker
            icon={entry.icon ?? null}
            onPick={(icon) => onChange((draft, path) => setIcon(draft, path, icon))}
          />
          {/* 큰 제목처럼 보이다가 가리키면 칸의 테두리가 선다 — 눌러서 고치는 제목이다(`Input`의 `entry-title` — `text-heading-lg`).
              이 자리의 검증 오류가 있으면 **칸이 말한다**(develop 스토리 107) — 빨간 테두리와 스크린리더의 「잘못된 값」이 한
              속성(`aria-invalid`)에서 나오고, 그 붉은 줄들이 칸의 설명이다. */}
          <Input
            variant="entry-title"
            className="flex-1"
            aria-label="이름 틀"
            aria-invalid={errors.length > 0}
            aria-describedby={lineIdsOf(errorsId, errors)}
            value={entry.pattern ?? ""}
            onChange={(event) => {
              const pattern = event.target.value;
              onChange((draft, path) => setPattern(draft, path, pattern));
            }}
            spellCheck={false}
          />
        </div>
        <ErrorLines errors={errors} inset id={errorsId} />
        {/* 경고색 글자는 이 편집기 어디서나 medium이다 — `warning`은 흰 면 위 3.8:1이라 13px 이상 medium 글자에만 쓴다
            (DS README 「대비」). */}
        {unknownIcon(entry) && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-chat-meta font-medium text-warning",
              UNDER_TITLE,
            )}
          >
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            <span>
              모르는 아이콘 <code className="font-mono text-xs">{entry.icon}</code> — 앱이 그리지 않아요
            </span>
          </p>
        )}
      </div>
      <SettingsSection>
        <SettingsGroup>
          <SettingsRow
            // 행의 이름은 눈에만 선다 — 토글의 이름(`aria-label`)이 같은 말을 이미 한다. 두 번 읽히지 않게 가린다.
            name={<span aria-hidden>종류</span>}
            control={
              // 두 칸 토글 부품이다(develop 판 4 · 결정 1) — 떠오른 칩이 선 칸으로 미끄러지고, 한 컨트롤이라 Tab 자리가
              // 하나이며 그 안에서는 ←/→로 옮긴다. 선 칸을 다시 누르면 아무 일도 없다(`deselectable={false}`, S16).
              <SegmentGroup
                size="sm"
                aria-label="종류"
                cells={KINDS}
                value={[kind]}
                deselectable={false}
                onValueChange={([pick]) => onChange((draft, path) => setKind(draft, path, pick))}
              >
                <SegmentGroupItem value="file">파일</SegmentGroupItem>
                <SegmentGroupItem value="folder">폴더</SegmentGroupItem>
              </SegmentGroup>
            }
          />
          {/* 이름 글자가 글상자의 `<label>`이다 — 칸의 이름이 「설명」이다. */}
          <SettingsRow
            name="설명"
            nameFor={descriptionId}
            below={
              <textarea
                id={descriptionId}
                rows={3}
                value={entry.description ?? ""}
                onChange={(event) => {
                  const text = event.target.value;
                  onChange((draft, path) => setDescription(draft, path, text));
                }}
                className={textareaLook}
              />
            }
          />
          {kind === "file" && (
            <TemplateField
              template={entry.template ?? null}
              body={bodyOf(templates, entry)}
              folder={folder}
              onToggle={(on) => onChange((draft, path) => setTemplate(draft, path, on))}
              onBody={(text) => onChange((draft, path) => setTemplateBody(draft, path, text))}
            />
          )}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

/**
 * 파일 항목의 템플릿 행(티켓 12 · 구현 스펙 5절 「배치」) — 「템플릿」 없음|있음. 있음이면 행의 아래 줄에 12줄 높이의 본문
 * 칸(세로로 늘인다)이 서고, 템플릿 경로는 그 칸의 오른쪽 위에 작게 적는다. **경로는 사람이 적지 않는다** —
 * 켤 때 편집기가 짓고(`setTemplate`), 여기는 보이기만 한다. 폴더 항목과 머리 `spec/`에는 이 행이 없다.
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
    <SettingsRow
      // 종류 행과 같다 — 이름은 토글의 이름이 이미 한다.
      name={<span aria-hidden>템플릿</span>}
      control={
        // 종류와 같은 두 칸 토글이다 — 선 칸을 다시 누르면 아무 일도 없다: 「있음」을 다시 눌러 경로를 새로 짓지
        // 않는다(경로는 켤 때 한 번 정한다).
        <SegmentGroup
          size="sm"
          aria-label="템플릿"
          cells={TEMPLATE_CELLS}
          value={[on ? "on" : "off"]}
          deselectable={false}
          onValueChange={([pick]) => onToggle(pick === "on")}
        >
          <SegmentGroupItem value="off">없음</SegmentGroupItem>
          <SegmentGroupItem value="on">있음</SegmentGroupItem>
        </SegmentGroup>
      }
      below={
        on ? (
          <div className="flex flex-col gap-1.5">
            {/* 잘린 경로의 전체는 `title`이 보인다 — 툴팁(`Hint`)이 아닌 것은 develop S29의 「버튼이 아닌 자리」(깨진 링크 ·
                없는 그림)와 같은 까닭이다: 툴팁 트리거로 세우면 누를 것 없는 글자에 포커스와 역할이 새로 생긴다. */}
            <span
              title={`${folder}/${template}`}
              className="max-w-full min-w-0 self-end truncate font-mono text-xs text-fg-tertiary"
            >
              {folder}/{template}
            </span>
            {body === null && (
              <p className="flex items-center gap-1.5 text-chat-meta font-medium text-warning">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                <span>레이아웃 폴더에 이 템플릿 파일이 없어요</span>
              </p>
            )}
            <textarea
              aria-label="템플릿 본문"
              rows={12}
              value={body ?? ""}
              onChange={(event) => onBody(event.target.value)}
              spellCheck={false}
              className={cn(textareaLook, "font-mono text-code")}
            />
          </div>
        ) : undefined
      }
    />
  );
}

/** 종류 칸의 값 — 칸이 놓인 순서다(칩이 이것으로 서는 자리를 안다). */
const KINDS = ["file", "folder"] as const;

/** 템플릿 칸의 값 — 없음, 있음 순서다. */
const TEMPLATE_CELLS = ["off", "on"] as const;

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
 * 그린다 — 없으면 흐린 「없음」, 모르는 이름이면 경고다. 열린 칸은 앱의 열린 트리거처럼 `toggle-on`이다(develop
 * S42, 옆 ⋯ `RevertMenu`와 같다) — 지금 아이콘은 칸의 글자색을 받아 열리면 함께 진해진다.
 *
 * **카드는 Popover다**(develop 판 3). 열리면 고른 칸에 포커스가 가고(`initialFocus`), Esc로
 * 닫으면 포커스가 칸으로 돌아온다 — 둘 다 부품이 한다. 고르면 닫고, 포커스는 역시 부품이 칸으로 돌려준다. 모달이
 * 아니라(부품 기본, S46) 바깥을 누르면 카드가 닫히고 그 누른 것도 눌린다.
 *
 * 도움말은 둘이다(S28). 칸의 툴팁은 **지금 아이콘의 이름**이다 — 이름(「아이콘 바꾸기」)보다 더 말하는 지금 값이라
 * 설명으로도 남는다. 표의 칸마다의 툴팁은 그 칸의 이름이라 눈에만 뜬다.
 */
function IconPicker({ icon, onPick }: { icon: string | null; onPick: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const Current = specIconOf(icon);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint
        text={icon ?? "아이콘 없음"}
        announce="description"
        render={
          <PopoverTrigger
            aria-label="아이콘 바꾸기"
            // 큰 제목 앞의 아이콘 상자다(판 06 티켓 07, 프로토타입 `Settings-editor`) — 44px · 옅은 면 · 테두리 없음. 모서리는
            // DS에 12가 없어 컨트롤의 10(`rounded-lg`)이다.
            // 바탕 · 글자색 · hover는 가지 안에만 둔다 — 한 요소에 `bg-surface-under`가 `toggle-on`과 겹치면 코어
            // 유틸리티가 뒤에 서서 열린 바탕을 덮고, `quiet-hover`는 꺼진 가지에만 선다(`index.css`의 그 유틸리티).
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors",
              open ? "toggle-on" : "bg-surface-under text-fg-secondary quiet-hover",
            )}
          />
        }
      >
        {Current ? (
          <Current aria-hidden className="size-[17px]" />
        ) : icon !== null ? (
          <TriangleAlert aria-hidden className="size-[17px] text-warning" />
        ) : (
          <Ban aria-hidden className="size-[17px] text-fg-tertiary opacity-60" />
        )}
      </Hint>
      <PopoverContent
        align="start"
        aria-label="아이콘 바꾸기"
        // 폭은 쓰는 자리의 것이다(S41) — 일곱 칸이 한 줄에 선다.
        className="w-[268px]"
        // 지금 고른 칸에 포커스가 간다 — 모르는 이름이라 고른 칸이 없으면 첫 칸(「아이콘 없음」)이다.
        initialFocus={() =>
          grid.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
          grid.current?.querySelector<HTMLElement>('[role="radio"]') ??
          true
        }
      >
        {/* 안쪽 여백은 카드(`PopoverContent`)가 든다. */}
        <div ref={grid} role="radiogroup" aria-label="아이콘" className="grid grid-cols-7 gap-0.5">
          {ICON_CHOICES.map((choice) => {
            const Glyph = choice === null ? Ban : SPEC_ICONS[choice];
            const checked = choice === icon;
            const name = choice ?? "아이콘 없음";
            return (
              <Hint
                key={name}
                text={name}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={name}
                onClick={() => {
                  onPick(choice);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-[34px] items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--accent)/50",
                  checked ? "toggle-on" : "text-fg-secondary quiet-hover",
                )}
              >
                <Glyph aria-hidden className="size-4" />
              </Hint>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 읽지 못하는 레이아웃(티켓 11) — **편집 UI를 세우지 않는다.** 까닭(엔진이 준 오류 전부)과 설정으로
 * 돌아가는 길만 보인다. 고치는 길은 설정의 레이아웃 행에 있다: 에이전트에게 부탁, 손으로 고치기, 되돌리기.
 * 어느 쪽이든 감시가 따라온다. 자리(카드 안 여백 · 글 폭)는 부르는 쪽의 폼 몸(`FormBody`)이 든다 — 트리 카드는 서지 않는다.
 */
export function UnreadableLayout({
  read,
  onBack,
}: {
  read: UnreadableSpecLayout;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-start gap-2">
        <TriangleAlert
          aria-hidden
          className="mt-[3px] size-3.5 shrink-0 text-warning"
        />
        <div className="flex min-w-0 flex-col gap-0.5 text-chat-meta">
          <span className="font-medium text-warning">
            {layoutDirRef(read.folder)} 레이아웃을 읽지 못해 편집할 수 없어요
          </span>
          {/* 까닭은 엔진의 글 그대로다 — 자리는 엔진이 적는 모양(`root.children[1]`)으로 앞에 붙인다. */}
          {read.errors.map((error, index) => (
            <span key={index} className="break-words text-fg-tertiary">
              {error.path === null ? error.message : `${placeOf(error.path)}: ${error.message}`}
            </span>
          ))}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onBack}>
        설정으로 돌아가기
      </Button>
    </div>
  );
}

/** 오류의 자리를 엔진이 적는 모양으로 — `[1, 0]` → `root.children[1].children[0]`. */
function placeOf(path: number[]): string {
  return ["root", ...path.map((index) => `children[${index}]`)].join(".");
}

export default SpecLayoutEditor;
