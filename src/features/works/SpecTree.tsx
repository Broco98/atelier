import { useState, type KeyboardEvent } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRow, ROVING, useRoving } from "@/lib/roving";
import { TargetMenu, type TargetRegion } from "@/components/shell/TargetMenu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Hint } from "@/components/ui/tooltip";
import { specIconOf } from "./spec-icons";
import type { SpecTreeItem } from "./types";

// 행의 규격은 DS `.at-tree-row`다(ui-refresh 결정 6 · 25) — 28px · 모서리 10 · `text-chat-meta` · 글리프와 이름 사이 6px · hover
// `fill-soft`. 파일 행은 본문 글자색이고, 폴더 행은 한 단 흐린 `fg-secondary`다(Archive · Main 프로토타입). 고른 행은
// `selected-row`에 굵기 500이다.
//
// 접기 행 하나의 규격. 폴더 행이 쓴다. 오른쪽 8px은 DS 행의 안쪽 여백이다 — 긴 폴더 이름의 말줄임이 행 끝에 붙지 않는다.
const COLLAPSE_ROW =
  "flex h-7 items-center gap-1.5 rounded-lg pr-2 text-left text-chat-meta text-fg-secondary transition-colors hover:bg-fill-soft focus-ring";

// 줄 사이는 1px 틈이다(DS `.at-tree` — 사이드바 · 목록 칸의 행 사이 2보다 촘촘하다). 폴더 상자와 그 패널도 같은 틈으로 줄을 잇는다.
const ROWS = "flex flex-col gap-px";

// 트리 한 단의 들여쓰기 — 첫 단 8px, 한 단 내려갈 때마다 14px. 폴더 행 · 파일 행이 함께 읽는다. 같은 식을
// 두 자리에 옮겨 적으면 한쪽만 고친 날 같은 깊이의 줄이 서로 다른 x에서 시작한다. 인라인 style인 것은 깊이가
// 정해지지 않은 수라 클래스로 못 적어서다.
const treeIndent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

interface TreeProps {
  // 엔진이 가른 spec 트리의 첫 층 — `spec/` 바로 아래의 파일·폴더들. **받은 순서 그대로
  // 그린다** — 앱에는 순서의 규칙도 폴더 이름의 규칙도 없다(spec 레이아웃 결정 13,
  // `src/spec-folder-names.test.ts`가 소스로 본다). 구획 머리도 없다(spec 레이아웃 결정 24): 번호
  // 묶음 폴더도 레이아웃의 자리에 선다. 아카이브는 그 트리를 기록 행 곁의 `spec/` 행 아래에 얹어
  // spec 목록 패널에 넘긴다(`archive/archive-tree.ts`) — 작업 패널의 트리처럼 첫 층이 패널 왼쪽 끝에서 선다.
  items: SpecTreeItem[];
  current: string | null;
  onSelect: (path: string) => void;
  // 파일 행 hover 시 경로 복사 버튼과, 그 행의 대상 메뉴(⇧F10 · 메뉴 키 · 우클릭)의 「경로 복사」 (생략 시 둘 다 미표시)
  onCopy?: (path: string) => void;
}

// **트리 하나가 Tab 정류장 하나다**(roving — codex-ds 스펙 §9 · S10, `@/lib/roving`). ↑↓는 보이는 행(펼친 폴더의 자식까지)을 화면
// 차례로 옮기고, Enter는 행의 누름이다(파일은 열고 폴더는 접고 편다). →는 접힌 폴더를 펴고 펼친 폴더에서는 첫 자식으로 간다. ←는 펼친
// 폴더를 접고, 아니면 부모 폴더로 간다(APG 트리 뷰의 길). 끝에서 돌지 않는다. ⌥가 걸린 화살표는 받지 않는다 — spec 레이아웃 편집기
// 트리의 들이기 · 내기 키다(그 편집기는 이 트리를 안 쓴다).
//
// 경로 복사 버튼은 **Tab 정류장이 아니다**(행 안 버튼은 빠진다) — 키보드의 길은 그 파일 행의 대상 메뉴(⇧F10 · 메뉴 키)의 「경로
// 복사」이고 같은 동작이다(구현 노트 Q16). 메뉴는 `onCopy`가 있을 때만 선다 — 없으면 메뉴에 남는 항목이 없다.

function SpecTree({ items, current, onSelect, onCopy }: TreeProps) {
  // 손으로 접고 편 폴더 — 폴더 경로가 키다. 트리가 소유하며 리마운트를 넘어 살지 않는다. **언제
  // 리마운트하는지는 트리를 세우는 패널이 정하고 두 패널이 다르다:**
  // - 작업 패널은 패널을 접을 때 트리를 새로 세운다(`WorkPanel`의 `treeGeneration`). 작업 전환은
  //   리마운트가 아니다 — 결정 49가 패널을 화면으로 올리며 `key`를 떼서, 작업을 옮겨도 이 기억이
  //   유지된다(그 결정이 감수한 것이다).
  // - spec 목록 패널은 아카이브마다 새로 세운다(`ArchivePage`의 `key`). 패널을 접었다 펴도 그대로다.
  //
  // 손으로 바꾼 것만 기억하고 기본값은 매번 받은 트리의 파일·폴더에서 낸다. 판이 새로 생겼을 때
  // 그것이 저절로 「펼쳐진 최신 판」이 되려면, 처음 그린 때의 펼침을 굳혀 두면 안 된다.
  //
  // 접힘을 폴더마다의 Collapsible에 맡기지 않고 여기 둔다 — 부모 폴더가 접히면 자식 폴더가 언마운트되는데,
  // 그때 자식의 접힘이 제 안에 살았다면 부모를 다시 펼 때 사라진다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // Collapsible은 **다음** 상태를 알린다 — 받은 값을 그대로 적는다.
  const setOpen = (path: string, open: boolean) => setToggled((prev) => ({ ...prev, [path]: open }));
  const isOpen = (item: SpecTreeItem) => toggled[item.path] ?? openByDefault(item);
  // 정류장은 연 문서의 행에서 시작한다 — 그 행이 접힌 폴더 안이면 첫 행이다(`useRoving`).
  const roving = useRoving(shownPaths(items, isOpen), current);

  const tree = (menu?: TargetRegion) => (
    <div
      className={cn(ROWS, "shrink-0")}
      onContextMenu={menu?.onContextMenu}
      onFocus={roving.box.onFocus}
      onKeyDown={(event) => {
        menu?.onKeyDown(event);
        roving.box.onKeyDown(event);
        walkTree(event, items, isOpen, setOpen);
      }}
    >
      <TreeRows
        items={items}
        depth={0}
        current={current}
        stop={roving.stop}
        isOpen={isOpen}
        onOpenChange={setOpen}
        onSelect={onSelect}
        onCopy={onCopy}
      />
    </div>
  );
  if (!onCopy) return tree();
  // 파일 행의 대상 메뉴 — 대상은 그 행(`data-spec-file`)이고 테두리는 이름 버튼에 선다. 폴더 행 · 빈 자리는 대상이 아니다.
  return (
    <TargetMenu<string>
      targetOf={(from) => {
        const row = from.closest<HTMLElement>("[data-spec-file]");
        const path = row?.dataset.specFile;
        if (row === null || path === undefined) return null;
        return { of: path, ring: row.querySelector<HTMLElement>(`[${ROVING}]`) };
      }}
      items={(path) => (
        <ContextMenuItem onClick={() => onCopy(path)}>
          <Copy />
          <span className="min-w-0 flex-1 truncate">경로 복사</span>
        </ContextMenuItem>
      )}
    >
      {(region) => tree(region)}
    </TargetMenu>
  );
}

/** 지금 보이는 행의 경로 — 화면 차례다. 펼친 폴더만 자식을 낸다. */
function shownPaths(items: SpecTreeItem[], isOpen: (item: SpecTreeItem) => boolean): string[] {
  return items.flatMap((item) => [
    item.path,
    ...(item.kind === "folder" && isOpen(item) ? shownPaths(item.children, isOpen) : []),
  ]);
}

/** 그 경로의 항목과 부모 폴더(첫 층이면 `null`). */
function locate(
  items: SpecTreeItem[],
  path: string,
  parent: SpecTreeItem | null = null,
): { item: SpecTreeItem; parent: SpecTreeItem | null } | null {
  for (const item of items) {
    if (item.path === path) return { item, parent };
    const inner = locate(item.children, path, item);
    if (inner) return inner;
  }
  return null;
}

/** ← · → — 폴더를 접고 펴거나 부모 · 첫 자식으로 간다(트리 머리말). ↑↓는 `useRoving`이 받는다. */
function walkTree(
  event: KeyboardEvent<HTMLElement>,
  items: SpecTreeItem[],
  isOpen: (item: SpecTreeItem) => boolean,
  setOpen: (path: string, open: boolean) => void,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const path = (event.target as HTMLElement).getAttribute(ROVING);
  const spot = path === null ? null : locate(items, path);
  if (!spot) return;
  event.preventDefault();
  const { item, parent } = spot;
  const open = item.kind === "folder" && isOpen(item);
  if (event.key === "ArrowRight") {
    if (item.kind !== "folder") return;
    if (!open) setOpen(item.path, true);
    else if (item.children[0]) focusRow(event.currentTarget, item.children[0].path);
  } else if (open) setOpen(item.path, false);
  else if (parent) focusRow(event.currentTarget, parent.path);
}

/**
 * 손대기 전의 펼침. 번호 묶음의 구성원은 **최신 표시가 붙은 것만** 펼친다 — 판이 쌓여도 지금
 * 판이 보이고 지난 판은 접힌 채 아래에 선다. 묶음 밖 폴더는 펼친 채 시작한다. 중첩된 묶음도
 * 같다(spec 레이아웃 결정 4: 「어디에 있든 같은 동작」). 파일 묶음(`adr-{n}-{name}.md`)은 펼칠
 * 것이 없다.
 */
function openByDefault(item: SpecTreeItem): boolean {
  return item.group === null || item.group.latest;
}

// 폴더는 Collapsible이다(판 4, 스토리 114). 행이 트리거라 `aria-expanded`를 스스로 달고, 자식 줄은 패널이다.
// 기본 변형이라 움직임 없이 **바로** 접히고 닫히면 언마운트된다 — 지금까지의 조건부 렌더와 같다.
// 뿌리가 곧 노드 상자(`flex flex-col`)라 상자가 느는 것은 자식 줄을 싸는 패널 하나다.
function TreeRows({
  items,
  depth,
  current,
  stop,
  isOpen,
  onOpenChange,
  onSelect,
  onCopy,
}: {
  items: SpecTreeItem[];
  depth: number;
  current: string | null;
  /** 트리의 Tab 정류장 행(경로) — 그 행의 버튼만 `tabIndex={0}`이다(트리 머리말). */
  stop: string | null;
  isOpen: (item: SpecTreeItem) => boolean;
  onOpenChange: (path: string, open: boolean) => void;
  onSelect: (path: string) => void;
  onCopy?: (path: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.kind === "folder") {
          const expanded = isOpen(item);
          return (
            <Collapsible
              key={item.path}
              open={expanded}
              onOpenChange={(open) => onOpenChange(item.path, open)}
              className={ROWS}
            >
              <CollapsibleTrigger
                className={COLLAPSE_ROW}
                style={treeIndent(depth)}
                tabIndex={item.path === stop ? 0 : -1}
                data-roving={item.path}
              >
                {/* 트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
                    독립 rotate 속성을 써서, transform만 걸면 화살표가 뚝 끊긴다
                    (SidebarWorkList가 같은 자리에서 같은 사실을 적고 있다) */}
                {/* 셰브론은 12px `fg-tertiary`이고 글리프와 행의 사이 6으로 떨어진다(DS `.at-tree-row > .ic.chev`). */}
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-fg-tertiary transition-[rotate] duration-basic",
                    expanded && "rotate-90",
                  )}
                  strokeWidth={SMALL_GLYPH_STROKE}
                />
                <FolderGlyph icon={item.icon} />
                {/* 폴더 이름을 그대로 보여준다 — 경로 복사가 붙어 있는 트리라 화면의 이름이
                    디스크의 이름과 어긋나면 안 된다. 판 폴더 이름은 길어서 자른다 */}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className={ROWS}>
                <TreeRows
                  items={item.children}
                  depth={depth + 1}
                  current={current}
                  stop={stop}
                  isOpen={isOpen}
                  onOpenChange={onOpenChange}
                  onSelect={onSelect}
                  onCopy={onCopy}
                />
              </CollapsibleContent>
            </Collapsible>
          );
        }
        // 파일 행은 버튼 하나가 아니라 div + 형제 버튼 둘이다. 복사가 이름 선택 안에
        // 중첩돼 있으면 두 가지가 동시에 깨진다 — 중첩 버튼은 HTML에서 허용되지 않아
        // 안쪽을 span role="button"으로 흉내 내야 했고, 그러면 누름도 포커스도 손으로 흉내 내야 한다.
        // 게다가 ARIA의 presentational-children 규칙상 button의 자식은 접근성 트리에서
        // 무시되므로 스크린리더에는 존재조차 읽히지 않았다. 형제로 푸는 것이 유일한 길이다.
        //
        // 배경(선택·hover)은 바깥 div가 갖는다. 두 hover가 한 요소에 겹치지 않도록
        // selected-row는 자기 hover를 품고, 비선택 행만 여기서 hover:bg-fill-soft를 붙인다.
        // 글자색은 고르든 안 고르든 본문 색이다 — 고른 행은 면과 굵기가 말한다(DS `.at-tree-row.is-on`).
        // 가로 여백은 div가 갖지 않는다. div가 가진 padding·gap은 두 버튼 어디에도
        // 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다 —
        // 행 전체가 하나의 button이던 시절엔 그 자리가 전부 눌렸다. 그래서 이름 버튼이
        // 자기 오른쪽 여백까지 품는다(복사 버튼이 있을 때만 필요하다).
        // 남는 것은 오른쪽 끝 pr-1(4px)뿐이고, 그건 복사 버튼을 행 가장자리에서
        // 띄우는 값이라 어느 버튼에도 넣을 수 없다.
        return (
          // 바깥 상자의 표는 대상 메뉴가 행을 가르는 자리다(트리 머리말) — 복사 버튼 위의 우클릭도 그 행의 메뉴다. 안쪽 행 상자에
          // 달지 않는다 — 고른 행을 `<div class="… selected-row …">`로 집는 마크업 검사가 있다(`WorksPage.test` · `ArchivePage.test`).
          <div key={item.path} className="flex flex-col" data-spec-file={item.path}>
            <div
              className={cn(
                "group flex h-7 items-center rounded-lg pr-1 text-chat-meta transition-colors",
                item.path === current ? "selected-row font-medium" : "hover:bg-fill-soft",
              )}
            >
              {/* 들여쓰기는 바깥이 아니라 여기 남는다 — 바깥 div로 올리면 깊은 노드일수록
                  이름을 누를 수 있는 자리가 그만큼 좁아진다. h-full은 28px 행 전체가
                  클릭 영역이 되게 한다 (items-center는 자식을 내용 높이로 줄인다) */}
              <button
                type="button"
                // 트리의 정류장 행만 Tab이 앉는다(트리 머리말). 이름(`aria-*`)은 달지 않는다 — 행의 글자가 이름이다.
                tabIndex={item.path === stop ? 0 : -1}
                data-roving={item.path}
                // ⌃클릭은 그 문서를 열지 않는다 — macOS에서 ⌃클릭은 우클릭이라 행 메뉴를 여는 손이고, 우클릭은 고름을 안 바꾼다(codex-ds
                // 결정 7 — 사이드바 work 행의 `onClick`과 같은 거름이다).
                onClick={(event) => {
                  if (!event.ctrlKey) onSelect(item.path);
                }}
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left focus-ring",
                  onCopy && "pr-1.5",
                )}
                style={treeIndent(depth)}
              >
                <FileGlyph name={item.name} icon={item.icon} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </button>
              {onCopy && (
                // 페이드 없이 뜨는 것은 icon-button-tint가 정한다 — 행 높이가 28px뿐이라
                // 페이드를 걸면 옆 행으로 옮겨 갈 때 두 복사 아이콘이 겹쳐 미끄러져 보인다.
                // Tab 정류장이 아니라(`tabIndex={-1}`, 트리 머리말) 포커스에 뜨는 갈래가 없다 — 키보드는 행 메뉴의 「경로 복사」다.
                // 포커스는 여전히 받으므로(보조 기술 · 코드, WebKit 밖의 누름) 링(`focus-ring`)은 단다 — 없으면 브라우저 기본 테두리다.
                <Hint
                  text="경로 복사"
                  type="button"
                  aria-label={`${item.name} 경로 복사`}
                  tabIndex={-1}
                  onClick={() => onCopy(item.path)}
                  className="icon-button-tint icon-button-xs text-fg-tertiary opacity-0 outline-none focus-ring group-hover:opacity-100"
                >
                  <Copy className="size-3" />
                </Hint>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// 폴더 · 파일 행의 글리프는 14px `fg-tertiary`다(DS `.at-tree-row .ic`).
const GLYPH = "size-3.5 shrink-0 text-fg-tertiary";

// 폴더 행의 글리프 — 항목이 준 아이콘이다. 없거나 표에 없는 이름이면 아무것도 안 그린다:
// 지금의 폴더 모양(화살표와 이름)이 그대로 선다.
function FolderGlyph({ icon }: { icon: string | null }) {
  const Glyph = specIconOf(icon);
  return Glyph && <Glyph className={GLYPH} />;
}

// 파일 행의 글리프. 항목이 아이콘을 줬으면 **확장자 라벨 대신** 그 아이콘이다. 라벨은 글자라 이름
// 버튼의 접근성 이름에 들어가서, 둘을 함께 그리면 `overview.md` 행의 이름이 `MD overview.md`가
// 된다 — 이름으로 행을 찾는 L3·L4가 그것을 딛는다(spec 레이아웃 구현 스펙 4절).
//
// 아이콘이 없거나 표에 없는 이름이면 확장자를 소형 mono 라벨로 (MD, YAML …). 확장자는 레이아웃이
// 아니라 파일의 성질이라 남는다. 꼬리표는 DS `at-ext`의 글자(`text-2xs` 10 / 14 · `font-mono` · 500)에 문서 안 인라인
// 코드와 같은 옅은 면 · `rounded-sm`이고 테두리가 없다(ui-refresh 결정 16 · 25).
function FileGlyph({ name, icon }: { name: string; icon: string | null }) {
  const Glyph = specIconOf(icon);
  if (Glyph) return <Glyph className={GLYPH} />;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
  if (!ext) return null;
  return (
    <span className="shrink-0 rounded-sm bg-surface-under px-1 font-mono text-2xs font-medium text-fg-tertiary">
      {ext}
    </span>
  );
}

export default SpecTree;
