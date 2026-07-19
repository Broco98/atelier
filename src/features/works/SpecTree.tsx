import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null; // null = 파일
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

function SpecTree({
  files,
  current,
  onSelect,
}: {
  files: string[];
  current: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return <TreeRows nodes={tree} depth={0} current={current} onSelect={onSelect} />;
}

function TreeRows({
  nodes,
  depth,
  current,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  current: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.path} className="flex flex-col">
          {node.children ? (
            <>
              <span
                className="flex h-7 items-center gap-1 text-[12.5px] text-tertiary"
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                <ChevronRight className="size-3 rotate-90" strokeWidth={2.2} />
                {node.name}
              </span>
              <TreeRows nodes={node.children} depth={depth + 1} current={current} onSelect={onSelect} />
            </>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[8px] text-left text-[12.5px] transition-colors hover:bg-accent",
                node.path === current ? "font-medium text-primary" : "text-muted-foreground",
              )}
              style={{ paddingLeft: 8 + depth * 14 + 16 }}
            >
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </div>
      ))}
    </>
  );
}

export default SpecTree;
