import { useMemo, useState } from "react";
import { BookOpen, ChevronRight, Compass, Copy, Layers, ListChecks, Search } from "lucide-react";
import { cn } from "@/lib/utils";

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
// 판을 넘어 사는 구역. 이 배열이 트리에서의 순서이자 아이콘의 유일한 출처다.
const STANDING = [
  { name: "research", Glyph: Search },
  { name: "explanation", Glyph: BookOpen },
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

// 접기 행 하나의 규격. 판 머리글(SpecSection)이 같은 문자열을 읽는다 —
// 트리의 폴더와 판이 같은 모양으로 접혀야 하고, 한쪽만 바뀌면 그 자리가 갈린다.
export const COLLAPSE_ROW =
  "flex h-7 items-center gap-1 rounded-[8px] text-left text-[12.5px] text-tertiary transition-colors hover:bg-state-1";

interface TreeProps {
  files: string[];
  current: string | null;
  onSelect: (path: string) => void;
  // 파일 행 hover 시 경로 복사 버튼 (생략 시 미표시)
  onCopy?: (path: string) => void;
  // 들여쓰기 시작 단. 판 구획 안에서는 판 머리글 아래로 한 단 들어간다.
  depth?: number;
}

function SpecTree({ files, current, onSelect, onCopy, depth = 0 }: TreeProps) {
  const tree = useMemo(() => orderSections(buildTree(files)), [files]);
  // 접힌 폴더 경로 — 트리가 소유하며 리마운트(작업 전환·패널 토글)를 넘어 살지 않는다
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  return (
    <TreeRows
      nodes={tree}
      depth={depth}
      current={current}
      collapsed={collapsed}
      onToggle={toggle}
      onSelect={onSelect}
      onCopy={onCopy}
    />
  );
}

function TreeRows({
  nodes,
  depth,
  current,
  collapsed,
  onToggle,
  onSelect,
  onCopy,
}: {
  nodes: TreeNode[];
  depth: number;
  current: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onCopy?: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const expanded = !collapsed.has(node.path);
        return (
          <div key={node.path} className="flex flex-col">
            {node.children ? (
              <>
                <button
                  type="button"
                  onClick={() => onToggle(node.path)}
                  aria-expanded={expanded}
                  className={COLLAPSE_ROW}
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  <ChevronRight
                    className={cn("size-3 transition-transform", expanded && "rotate-90")}
                    strokeWidth={2.2}
                  />
                  <FolderGlyph name={node.name} />
                  {node.name}
                </button>
                {expanded && (
                  <TreeRows
                    nodes={node.children}
                    depth={depth + 1}
                    current={current}
                    collapsed={collapsed}
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
              <div
                className={cn(
                  "group flex h-7 items-center gap-1.5 rounded-[8px] pr-1 text-[12.5px] transition-colors",
                  node.path === current
                    ? "selected-row font-medium text-foreground"
                    : "text-muted-foreground hover:bg-state-1",
                )}
              >
                {/* 들여쓰기는 바깥이 아니라 여기 남는다 — 바깥 div로 올리면 깊은 노드일수록
                    이름을 누를 수 있는 자리가 그만큼 좁아진다. h-full은 28px 행 전체가
                    클릭 영역이 되게 한다 (items-center는 자식을 내용 높이로 줄인다) */}
                <button
                  type="button"
                  onClick={() => onSelect(node.path)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  <FileGlyph name={node.name} />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                </button>
                {onCopy && (
                  // 페이드 없이 뜨는 것은 icon-button-quiet이 정한다 — 행 높이가 28px뿐이라
                  // 페이드를 걸면 옆 행으로 옮겨 갈 때 두 복사 아이콘이 겹쳐 미끄러져 보인다.
                  // focus-visible:opacity-100이 없으면 Tab으로 도달은 하는데 보이지 않는다 —
                  // 거터 복사 버튼이 이미 같은 답을 하고 있다
                  <button
                    type="button"
                    aria-label={`${node.name} 경로 복사`}
                    title="경로 복사"
                    onClick={() => onCopy(node.path)}
                    className="icon-button-quiet text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
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

// 알려진 폴더 이름의 글리프. tickets/는 판 안에 있든 밖에 있든 같은 아이콘이다 —
// 이름으로만 판단하고 위치는 보지 않는다. 규칙에 없는 폴더는 아이콘 없이 그대로 보인다.
//
// 판 머리글(SpecSection)도 이것을 부른다 — 폴더 하나가 트리 안에 있을 때와 구획 머리글로
// 올라섰을 때 다른 아이콘을 달면, 위 STANDING 배열이 「아이콘의 유일한 출처」라는 말이 깨진다.
export function FolderGlyph({ name }: { name: string }) {
  const className = "size-3 shrink-0 text-tertiary";
  if (ITERATION.test(name)) return <Layers className={className} strokeWidth={1.9} />;
  if (name === TICKETS) return <ListChecks className={className} strokeWidth={1.9} />;
  const standing = STANDING.find((s) => s.name === name);
  if (standing) return <standing.Glyph className={className} strokeWidth={1.9} />;
  return null;
}

// 파일 타입 글리프 — 확장자를 소형 mono 라벨로 (MD, YAML …). 다섯 이름 중 파일은
// overview.md 하나뿐이라, 그것만 확장자 대신 진입점 글리프를 받는다.
function FileGlyph({ name }: { name: string }) {
  if (name === OVERVIEW) {
    return <Compass className="size-3 shrink-0 text-tertiary" strokeWidth={1.9} />;
  }
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
