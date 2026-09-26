import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Ban, File, Folder, TriangleAlert, type LucideIcon } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { showProblem } from "@/components/ui/confirm-store";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { settingsItem } from "@/features/settings/pages";
import { SPEC_ICONS, specIconOf, type SpecIconName } from "@/features/works/spec-icons";
import { layoutDirRef } from "@/features/works/refs";
import { cn } from "@/lib/utils";
import { modeNameOf, type Mode } from "@/mode";
import {
  entryAt,
  setDescription,
  setIcon,
  setKind,
  setPattern,
  type EntryPath,
  type LayoutDraft,
} from "./draft";
import { specLayoutReadQuery, useWriteSpecLayout } from "./hooks";
import type {
  LayoutEntryJson,
  LayoutError,
  ReadableSpecLayout,
  UnreadableSpecLayout,
} from "./types";

// 「spec 레이아웃」의 편집기(spec 레이아웃 티켓 11 · 결정 11·20·26). 설정 한 열(620px) 안이 아니라 설정 nav
// 항목 「spec 레이아웃」의 하위 주소(`/settings/spec-layout/<id>`)에 선 **별도 화면**이다 — 트리와 고른 항목,
// 두 열이 설정 한 열에 들지 않는다. 설정 nav는 그대로 서고 「spec 레이아웃」이 켜져 있다.
//
// **이 화면의 주된 쓰임은 마지막 손질이다**(결정 20). 레이아웃은 대부분 에이전트가 고치고, 사람은 여기서
// 한 칸을 고친다. 그래서 머리에는 뒤로, 위치, 저장만 둔다 — id, 배지, 오류 개수, 「저장하지 않은 변경」,
// 부탁 버튼, 설명 문구, 도움말은 두지 않는다(구현 스펙 5절 「배치」).
//
// **규칙이 없다**(결정 13). 초안을 고치는 것은 `draft.ts`의 순수 함수이고, 이름 틀이 맞는지·폴더에 자식이
// 있어도 되는지는 저장이 엔진의 검증으로 판정한다. 그 오류는 데이터로 와서(`{ path, message }`) 그 자리의
// 항목 제목 아래에 붉은 줄로 선다.
//
// **저장은 이 화면의 저장 버튼 하나다** — 설정 초안의 저장 버튼과 따로다. 누르기 전에는 아무것도 쓰지 않는다.

/** 편집기 주소를 연다 — 레이아웃을 읽어, 읽을 수 있으면 편집 UI를, 없으면 까닭과 돌아가는 길을 세운다. */
function SpecLayoutEditor({ id, sidebarOpen }: { id: Mode; sidebarOpen: boolean }) {
  const read = useQuery(specLayoutReadQuery(id));
  const navigate = useNavigate();
  // 뒤로는 「spec 레이아웃」 설정 페이지다 — 편집기로 오는 문이 거기 한 곳(모드 행의 [편집])이라, 히스토리를 되감지
  // 않고 늘 그 자리로 간다. 주소로 바로 왔어도 같은 곳에 선다.
  const back = () => void navigate({ to: "/settings/spec-layout" });
  const data = read.data;

  if (data !== undefined && !("errors" in data)) {
    return <EditorScreen id={id} read={data} sidebarOpen={sidebarOpen} onBack={back} />;
  }
  return (
    <EditorFrame id={id} sidebarOpen={sidebarOpen} onBack={back}>
      {data !== undefined && <UnreadableLayout read={data} onBack={back} />}
      {/* 읽기 자체가 실패한 길(IPC). 레이아웃 폴더가 깨진 것은 여기가 아니라 위 화면이다. */}
      {data === undefined && read.error !== null && (
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

/**
 * 편집 UI — 초안과 고른 자리를 든다. 초안은 **처음 읽은 것으로 한 번 짓는다**: 저장 뒤의 무효화나 감시가
 * 다시 읽어 와도 쓰던 초안을 덮지 않는다(밖 변경을 어떻게 받을지는 티켓 15가 정한다).
 */
function EditorScreen({
  id,
  read,
  sidebarOpen,
  onBack,
}: {
  id: Mode;
  read: ReadableSpecLayout;
  sidebarOpen: boolean;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<LayoutDraft>(() => ({
    layout: read.layout,
    templates: read.templates,
  }));
  // 처음에는 첫 최상위 항목을 고른다. 항목이 없으면 머리 `spec/`(방침 문단)이다.
  const [selected, setSelected] = useState<EntryPath>(() =>
    (read.layout.root.children ?? []).length > 0 ? [0] : [],
  );
  // 마지막 저장이 돌려준 검증 오류. 다음 저장까지 그 자리에 선다 — 저장 전에 미리 알려 주고 저장을
  // 잠그는 것은 초안마다 엔진에 묻는 미리보기의 일이다(티켓 14).
  const [errors, setErrors] = useState<LayoutError[]>([]);
  const write = useWriteSpecLayout();

  // **템플릿은 늘 전부 넘긴다**(구현 스펙 3절) — 읽은 본문을 그대로 싣는다. 검증이 거절하면 답의 `errors`가
  // 오고 아무것도 쓰이지 않았다: 초안은 그대로 남고 오류가 그 자리에 선다. 거절(throw)은 쓰다가 실패한
  // 것뿐이다.
  const save = async () => {
    if (write.isPending) return;
    try {
      const answer = await write.mutateAsync({
        id,
        layout: draft.layout,
        templates: draft.templates,
      });
      setErrors(answer.errors);
    } catch (e) {
      await showProblem(`저장하지 못했습니다: ${e}`);
    }
  };

  return (
    <EditorFrame
      id={id}
      sidebarOpen={sidebarOpen}
      onBack={onBack}
      actions={
        <button
          type="button"
          onClick={() => void save()}
          disabled={write.isPending}
          // 규격은 설정의 저장 버튼(`SettingsPage`의 `SaveButton`)과 같다 — 이 저장소의 주 버튼 하나다.
          className="h-8 rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08] disabled:pointer-events-none disabled:opacity-40"
        >
          {write.isPending ? "저장 중…" : "저장"}
        </button>
      }
    >
      <EditorColumns
        draft={draft}
        selected={selected}
        errors={errors}
        onSelect={setSelected}
        onChange={setDraft}
      />
    </EditorFrame>
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
 * 이유). 아이콘 팝오버가 열렸는지만 그 칸이 든다.
 *
 * 고른 자리는 맨 위 항목에서부터의 인덱스 경로다. **`[]`이 트리 열의 머리 `spec/`이다** — 맨 위 항목(spec
 * 폴더 자신)은 트리의 행이 아니고(결정 26), 머리를 누르면 그 설명(방침 문단) 칸 하나만 선다.
 */
export function EditorColumns({
  draft,
  selected,
  errors,
  onSelect,
  onChange,
}: {
  draft: LayoutDraft;
  selected: EntryPath;
  errors: LayoutError[];
  onSelect: (path: EntryPath) => void;
  onChange: (change: (draft: LayoutDraft) => LayoutDraft) => void;
}) {
  const entry = selected.length === 0 ? null : entryAt(draft.layout, selected);
  // 고른 자리가 초안에 없으면(항목이 사라졌다) 머리를 고른 것으로 친다.
  const at: EntryPath = entry === null ? [] : selected;
  const rows = rowsOf(draft.layout.root.children ?? [], []);
  const errorsAt = (path: EntryPath) => errors.filter((error) => samePath(error.path, path));
  const documentErrors = errors.filter((error) => error.path === null);

  return (
    <div className="flex min-h-0 flex-1 border-t border-border">
      <section
        aria-label="항목 트리"
        className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar"
      >
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
        <div
          role="tree"
          aria-label="레이아웃 항목"
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3 scroll-quiet"
        >
          {rows.map(({ entry: row, path }) => (
            <TreeRow
              key={path.join(".")}
              entry={row}
              depth={path.length}
              selected={samePath(path, at)}
              hasError={errorsAt(path).length > 0}
              onSelect={() => onSelect(path)}
            />
          ))}
        </div>
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
              errors={errorsAt(at)}
              onChange={(change) => onChange((current) => change(current, at))}
            />
          )}
        </div>
      </section>
    </div>
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

function samePath(a: readonly number[] | null, b: readonly number[]): boolean {
  return a !== null && a.length === b.length && a.every((index, i) => index === b[i]);
}

/** 아이콘 이름이 앱의 표에 없는가 — 손으로 적은 모르는 이름이다. 없는 아이콘은 모르는 것이 아니다. */
function unknownIcon(entry: LayoutEntryJson): boolean {
  return entry.icon !== undefined && specIconOf(entry.icon) === null;
}

/**
 * 트리의 행 하나. 이름은 이름 틀이고, 폴더는 끝에 `/`가 붙는다. 아이콘은 표의 것이고, 없거나 모르는
 * 이름이면 종류의 흐린 글리프다. 모르는 아이콘과 검증 오류는 행 끝에 표시가 붙는다 — 어디를 골라야 하는지
 * 트리에서 보인다.
 */
function TreeRow({
  entry,
  depth,
  selected,
  hasError,
  onSelect,
}: {
  entry: LayoutEntryJson;
  depth: number;
  selected: boolean;
  hasError: boolean;
  onSelect: () => void;
}) {
  const folder = entry.kind !== "file";
  const Known = specIconOf(entry.icon ?? null);
  const Glyph: LucideIcon = Known ?? (folder ? Folder : File);
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth}
      aria-selected={selected}
      onClick={onSelect}
      // 들여쓰기는 `spec` 패널 탭의 트리와 같은 걸음(14px)이다.
      style={{ paddingLeft: 8 + (depth - 1) * 14 }}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[8px] pr-2 text-left text-[12.5px] transition-colors",
        selected ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
        hasError && "text-red-600",
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
      {unknownIcon(entry) && (
        <>
          <TriangleAlert
            aria-hidden
            className="size-3 shrink-0 text-amber-700 dark:text-amber-400"
            strokeWidth={2}
          />
          <span className="sr-only">모르는 아이콘</span>
        </>
      )}
      {hasError && (
        <>
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-red-600" />
          <span className="sr-only">검증 오류</span>
        </>
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
 * (파일|폴더), 제목 아래에 그 자리의 검증 오류와 모르는 아이콘 경고, 그 아래에 설명 칸이다. 템플릿 칸은
 * 파일 항목에 더해진다(티켓 12).
 */
function EntryFields({
  entry,
  errors,
  onChange,
}: {
  entry: LayoutEntryJson;
  errors: LayoutError[];
  onChange: (change: (draft: LayoutDraft, path: EntryPath) => LayoutDraft) => void;
}) {
  const descriptionId = useId();
  const kind = entry.kind === "file" ? "file" : "folder";
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
    </>
  );
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
