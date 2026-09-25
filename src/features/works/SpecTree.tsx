import { useMemo, useState } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { specIconOf } from "./spec-icons";
import type { SpecTreeItem } from "./types";

// ─── 아카이브 트리가 아직 쓰는 이름 규칙 ───────────────────────────────────────────
//
// work 화면은 이것을 더는 부르지 않는다 — 엔진이 가른 spec 트리를 받아 그리기만 한다(아래
// `SpecTree`, spec 레이아웃 결정 13). 아카이브의 문서 트리만 아직 파일 목록을 받아 여기서 트리를
// 짓는다. 그 트리도 spec 트리를 그리게 되면(티켓 06) 이 절이 통째로 사라진다. **그때까지 이
// 파일에 둔다** — TS 소스를 읽는 Rust 결합 테스트(`atelier-cli`의
// `the_app_recognises_the_same_folder_names_it_teaches`)가 이 파일에서 이름을 찾는다.

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null; // null = 파일
}

// spec 폴더에서 의미를 갖는 다섯 이름. 고정하는 것은 **폴더 이름뿐**이고 그 안의
// 파일 이름은 자유다. 규칙에 없는 폴더·파일도 트리에서 사라지지 않는다 —
// 아틀리에가 특정 스킬의 산출물 이름에 묶이면 안 되기 때문이다.
const OVERVIEW = "overview.md";
const ITERATION = /^(\d+)-/; // NN-<이름>/ = 판 하나
const TICKETS = "tickets";
// 판을 넘어 사는 구역. 이 배열이 트리에서의 순서이자 이름 규칙이 주는 아이콘의 유일한 출처다.
const STANDING = [
  { name: "research", icon: "search" },
  { name: "explanation", icon: "book-open" },
] as const;

/** 구역 번호와 구역 안 순서. 같은 키는 커널이 준 순서를 그대로 지킨다(안정 정렬). */
function sectionKey(node: TreeNode): [number, number] {
  const isDir = node.children !== null;
  if (!isDir && node.name === OVERVIEW) return [0, 0];
  const iteration = isDir ? ITERATION.exec(node.name) : null;
  if (iteration) return [1, Number(iteration[1])];
  const standing = isDir ? STANDING.findIndex((s) => s.name === node.name) : -1;
  if (standing >= 0) return [2, standing];
  return [3, 0];
}

/** overview → 판(번호 오름차순) → 상시 구역 → 나머지. 최상위에서만 적용한다. */
function orderSections(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const [aSection, aOrder] = sectionKey(a);
    const [bSection, bOrder] = sectionKey(b);
    return aSection - bSection || aOrder - bOrder;
  });
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.split("/");
    let siblings = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      let node = siblings.find((n) => n.name === name && (n.children === null) === isFile);
      if (!node) {
        node = { name, path: prefix, children: isFile ? null : [] };
        siblings.push(node);
      }
      if (node.children) siblings = node.children;
    }
  }
  return root;
}

// 이름 → 아이콘. tickets/는 판 안에 있든 밖에 있든 같은 아이콘이다 — 이름으로만 판단하고 위치는
// 보지 않는다. 규칙에 없는 폴더는 아이콘 없이 그대로 보인다. 다섯 이름 중 파일은 overview.md
// 하나뿐이라, 그것만 확장자 대신 진입점 글리프(나침반)를 받는다.
function iconByName(node: TreeNode): string | null {
  if (node.children === null) return node.name === OVERVIEW ? "compass" : null;
  if (ITERATION.test(node.name)) return "layers";
  if (node.name === TICKETS) return "list-checks";
  return STANDING.find((s) => s.name === node.name)?.icon ?? null;
}

/** 이름 규칙으로 지은 트리를 spec 트리의 모양으로 — 그리는 것은 work 화면과 같은 `SpecTree`다. */
function itemsByName(nodes: TreeNode[]): SpecTreeItem[] {
  return nodes.map((node) => ({
    name: node.name,
    path: node.path,
    kind: node.children === null ? "file" : "folder",
    icon: iconByName(node),
    // 이름 규칙에는 번호 묶음이 없다 — 그래서 폴더가 모두 펼친 채 선다(이 규칙의 원래 모양)
    group: null,
    children: itemsByName(node.children ?? []),
  }));
}

/**
 * 파일 목록에서 이름 규칙으로 트리를 지어 그린다. **아카이브 트리만 쓴다**(티켓 06이 걷는다).
 * 입력만 다르고 그리는 것은 `SpecTree` 그대로다 — 두 화면의 트리가 다르게 생기면 안 된다.
 */
export function FileSpecTree({ files, ...rest }: Omit<TreeProps, "items"> & { files: string[] }) {
  const items = useMemo(() => itemsByName(orderSections(buildTree(files))), [files]);
  return <SpecTree items={items} {...rest} />;
}

// ─── spec 트리 ───────────────────────────────────────────────────────────────────

// 접기 행 하나의 규격. 폴더 행이 쓴다.
const COLLAPSE_ROW =
  "flex h-7 items-center gap-1 rounded-[8px] text-left text-[12.5px] text-tertiary transition-colors hover:bg-state-1";

interface TreeProps {
  // 엔진이 가른 spec 트리의 맨 위 항목들. **받은 순서 그대로 그린다** — 앱에는 순서의 규칙이 없다
  // (spec 레이아웃 결정 13). 구획 머리도 없다(spec 레이아웃 결정 24): 번호 묶음 폴더도 레이아웃의
  // 자리에 선다.
  items: SpecTreeItem[];
  current: string | null;
  onSelect: (path: string) => void;
  // 파일 행 hover 시 경로 복사 버튼 (생략 시 미표시)
  onCopy?: (path: string) => void;
}

function SpecTree({ items, current, onSelect, onCopy }: TreeProps) {
  // 손으로 접고 편 폴더 — 폴더 경로가 키다. 트리가 소유하며 리마운트(패널 토글)를 넘어 살지
  // 않는다. **작업 전환은 더 이상 리마운트가 아니다** — 결정 49가 패널을 화면으로 올리며
  // `key`를 떼서, 작업을 옮겨도 이 기억이 유지된다(그 결정이 감수한 것이다).
  //
  // 손으로 바꾼 것만 기억하고 기본값은 매번 항목에서 낸다. 판이 새로 생겼을 때 그것이 저절로
  // 「펼쳐진 최신 판」이 되려면, 처음 그린 때의 펼침을 굳혀 두면 안 된다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const toggle = (path: string, open: boolean) =>
    setToggled((prev) => ({ ...prev, [path]: !open }));
  return (
    <TreeRows
      items={items}
      depth={0}
      current={current}
      isOpen={(item) => toggled[item.path] ?? openByDefault(item)}
      onToggle={toggle}
      onSelect={onSelect}
      onCopy={onCopy}
    />
  );
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

function TreeRows({
  items,
  depth,
  current,
  isOpen,
  onToggle,
  onSelect,
  onCopy,
}: {
  items: SpecTreeItem[];
  depth: number;
  current: string | null;
  isOpen: (item: SpecTreeItem) => boolean;
  onToggle: (path: string, open: boolean) => void;
  onSelect: (path: string) => void;
  onCopy?: (path: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        const expanded = isOpen(item);
        return (
          <div key={item.path} className="flex flex-col">
            {item.kind === "folder" ? (
              <>
                <button
                  type="button"
                  onClick={() => onToggle(item.path, expanded)}
                  aria-expanded={expanded}
                  className={COLLAPSE_ROW}
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  {/* 트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
                      독립 rotate 속성을 써서, transform만 걸면 화살표가 뚝 끊긴다
                      (SidebarWorkList가 같은 자리에서 같은 사실을 적고 있다) */}
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 transition-[rotate] duration-150",
                      expanded && "rotate-90",
                    )}
                    strokeWidth={2.2}
                  />
                  <FolderGlyph icon={item.icon} />
                  {/* 폴더 이름을 그대로 보여준다 — 경로 복사가 붙어 있는 트리라 화면의 이름이
                      디스크의 이름과 어긋나면 안 된다. 판 폴더 이름은 길어서 자른다 */}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
                {expanded && (
                  <TreeRows
                    items={item.children}
                    depth={depth + 1}
                    current={current}
                    isOpen={isOpen}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    onCopy={onCopy}
                  />
                )}
              </>
            ) : (
              // 파일 행은 버튼 하나가 아니라 div + 형제 버튼 둘이다. 복사가 이름 선택 안에
              // 중첩돼 있으면 두 가지가 동시에 깨진다 — 중첩 버튼은 HTML에서 허용되지 않아
              // 안쪽을 span role="button"으로 흉내 내야 했고, 그러면 Tab으로 도달할 수 없다.
              // 게다가 ARIA의 presentational-children 규칙상 button의 자식은 접근성 트리에서
              // 무시되므로 스크린리더에는 존재조차 읽히지 않았다. 형제로 푸는 것이 유일한 길이다.
              //
              // 배경(선택·hover)은 바깥 div가 갖는다. 두 hover가 한 요소에 겹치지 않도록
              // selected-row는 자기 hover를 품고, 비선택 행만 여기서 hover:bg-state-1을 붙인다.
              // 가로 여백은 div가 갖지 않는다. div가 가진 padding·gap은 두 버튼 어디에도
              // 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다 —
              // 행 전체가 하나의 button이던 시절엔 그 자리가 전부 눌렸다. 그래서 이름 버튼이
              // 자기 오른쪽 여백까지 품는다(복사 버튼이 있을 때만 필요하다).
              // 남는 것은 오른쪽 끝 pr-1(4px)뿐이고, 그건 복사 버튼을 행 가장자리에서
              // 띄우는 값이라 어느 버튼에도 넣을 수 없다.
              <div
                className={cn(
                  "group flex h-7 items-center rounded-[8px] pr-1 text-[12.5px] transition-colors",
                  item.path === current
                    ? "selected-row font-medium"
                    : "text-muted-foreground hover:bg-state-1",
                )}
              >
                {/* 들여쓰기는 바깥이 아니라 여기 남는다 — 바깥 div로 올리면 깊은 노드일수록
                    이름을 누를 수 있는 자리가 그만큼 좁아진다. h-full은 28px 행 전체가
                    클릭 영역이 되게 한다 (items-center는 자식을 내용 높이로 줄인다) */}
                <button
                  type="button"
                  onClick={() => onSelect(item.path)}
                  className={cn(
                    "flex h-full min-w-0 flex-1 items-center gap-1.5 text-left",
                    onCopy && "pr-1.5",
                  )}
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  <FileGlyph name={item.name} icon={item.icon} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
                {onCopy && (
                  // 페이드 없이 뜨는 것은 icon-button-tint가 정한다 — 행 높이가 28px뿐이라
                  // 페이드를 걸면 옆 행으로 옮겨 갈 때 두 복사 아이콘이 겹쳐 미끄러져 보인다.
                  // focus-visible:opacity-100이 없으면 Tab으로 도달은 하는데 보이지 않는다 —
                  // 거터 복사 버튼이 이미 같은 답을 하고 있다
                  <button
                    type="button"
                    aria-label={`${item.name} 경로 복사`}
                    title="경로 복사"
                    onClick={() => onCopy(item.path)}
                    className="icon-button-tint text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
                  >
                    <Copy className="size-3" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const GLYPH = "size-3 shrink-0 text-tertiary";

// 폴더 행의 글리프 — 항목이 준 아이콘이다. 없거나 표에 없는 이름이면 아무것도 안 그린다:
// 지금의 폴더 모양(화살표와 이름)이 그대로 선다.
function FolderGlyph({ icon }: { icon: string | null }) {
  const Glyph = specIconOf(icon);
  return Glyph && <Glyph className={GLYPH} strokeWidth={1.9} />;
}

// 파일 행의 글리프. 항목이 아이콘을 줬으면 **확장자 라벨 대신** 그 아이콘이다. 라벨은 글자라 이름
// 버튼의 접근성 이름에 들어가서, 둘을 함께 그리면 `overview.md` 행의 이름이 `MD overview.md`가
// 된다 — 이름으로 행을 찾는 L3·L4가 그것을 딛는다(구현 스펙 4절).
//
// 아이콘이 없거나 표에 없는 이름이면 확장자를 소형 mono 라벨로 (MD, YAML …). 확장자는 레이아웃이
// 아니라 파일의 성질이라 남는다.
function FileGlyph({ name, icon }: { name: string; icon: string | null }) {
  const Glyph = specIconOf(icon);
  if (Glyph) return <Glyph className={GLYPH} strokeWidth={1.9} />;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
  if (!ext) return null;
  return (
    <span className="shrink-0 rounded-[5px] border bg-inset px-1 py-px font-mono text-[9px] font-medium leading-[1.4] text-tertiary">
      {ext}
    </span>
  );
}

export default SpecTree;
