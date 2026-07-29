import { useMemo, useState } from "react";
import { BookOpen, ChevronRight, Copy, Layers, ListChecks, Search } from "lucide-react";
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

interface TreeProps {
  files: string[];
  current: string | null;
  onSelect: (path: string) => void;
  // 파일 행 hover 시 경로 복사 버튼 (생략 시 미표시)
  onCopy?: (path: string) => void;
}

function SpecTree({ files, current, onSelect, onCopy }: TreeProps) {
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
      depth={0}
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
                  className="flex h-7 items-center gap-1 rounded-[8px] text-left text-[12.5px] text-tertiary transition-colors hover:bg-accent"
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
              <button
                type="button"
                onClick={() => onSelect(node.path)}
                className={cn(
                  "group flex h-7 items-center gap-1.5 rounded-[8px] pr-1 text-left text-[12.5px] transition-colors hover:bg-accent",
                  node.path === current ? "font-medium text-primary" : "text-muted-foreground",
                )}
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                <FileGlyph name={node.name} />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {onCopy && (
                  <span
                    role="button"
                    title="경로 복사"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopy(node.path);
                    }}
                    className="flex size-[22px] shrink-0 items-center justify-center rounded-[7px] text-tertiary opacity-0 transition-opacity hover:bg-inset hover:text-foreground group-hover:opacity-100"
                  >
                    <Copy className="size-3" strokeWidth={1.8} />
                  </span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

// 알려진 폴더 이름의 글리프. tickets/는 판 안에 있든 밖에 있든 같은 아이콘이다 —
// 이름으로만 판단하고 위치는 보지 않는다. 규칙에 없는 폴더는 아이콘 없이 그대로 보인다.
function FolderGlyph({ name }: { name: string }) {
  const className = "size-3 shrink-0 text-tertiary";
  if (ITERATION.test(name)) return <Layers className={className} strokeWidth={1.9} />;
  if (name === TICKETS) return <ListChecks className={className} strokeWidth={1.9} />;
  const standing = STANDING.find((s) => s.name === name);
  if (standing) return <standing.Glyph className={className} strokeWidth={1.9} />;
  return null;
}

// 목업 트리의 파일 타입 글리프 — 확장자를 소형 mono 라벨로 (MD, YAML …)
function FileGlyph({ name }: { name: string }) {
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
