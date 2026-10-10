import { useState } from "react";
import { Folder, GitFork, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardHead } from "@/components/shell/Frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Hint } from "@/components/ui/tooltip";
import type { ProjectView } from "./types";

interface ProjectListProps {
  projects: ProjectView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onAdd: () => void;
}

// 목록 카드의 안 — 머리(검색칸 · `+`)와 몸(행). 카드 · 접힘 · 폭 손잡이는 공용 틀의 목록 칸이 든다(`Frame`의 `list`,
// ui-refresh 결정 15 · 27). 폭과 열림의 저장도 화면(`ProjectsPage`)이 그 칸에 건넨다.
function ProjectList({ projects, selectedSlug, onSelect, onAdd }: ProjectListProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) =>
        [p.name, p.path, p.git?.remoteSlug ?? ""].some((s) => s.toLowerCase().includes(q)),
      )
    : projects;

  // 숫자 단축키는 여기에 없다 — 사이드바 작업 목록에도 없다. 한때 사이드바 N번째 작업을
  // 여는 키였는데, ⌘1~9가 한 화면 안에서 본문을 옮기는 키로 바뀌면서 걷혔다
  // (`shell-registry.ts`의 ⌘1~9 머리말). 목록 순서가 바뀌어도 따라 바꿀 키가 없다.

  return (
    <>
      {/* 목록 카드 머리 — 검색칸이 캡슐 자리에 늘어서고 `+`가 끝이다(Projects 프로토타입). 신호등을 피할 일은 바탕 줄의 몫이라
          여기에는 사이드바 열림에 따라 갈리는 여백이 없다. */}
      <CardHead
        end={
          <Hint
            text="프로젝트 등록"
            announce="name"
            render={<Button variant="outline" size="icon-round" onClick={onAdd} />}
          >
            <Plus className="size-4" />
          </Hint>
        }
      >
        {projects.length > 0 && (
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {/* 이름은 aria-label이 든다(S37) — placeholder는 이름표가 아니라 빈 칸에만 서는 안내 글자다. */}
            <InputGroupInput
              aria-label="프로젝트 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="프로젝트 검색"
            />
          </InputGroup>
        )}
      </CardHead>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {projects.length === 0 ? (
          <Empty variant="list" className="my-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>프로젝트가 없어요</EmptyTitle>
              <EmptyDescription>로컬 저장소 폴더를 등록해 시작하세요.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="soft" size="sm" onClick={onAdd}>
                프로젝트 등록
              </Button>
            </EmptyContent>
          </Empty>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center pb-10">
            <span className="text-chat-meta text-fg-tertiary">검색 결과가 없어요</span>
          </div>
        ) : (
          <div className="-mx-3 flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto px-3 pb-2 scroll-quiet">
            {/* **`-mx-3 px-3`가 거터를 뚫고 나갔다 되돌린다** — 보이는 것은 안 움직이고 막대만
                패널 가장자리로 간다. 상자가 바깥 거터 안에 들어앉아 있으면 막대(상자 안쪽 3~9px)가
                그만큼 더 안쪽에 서서 행 위로 들어온다. 사이드바 work 목록이 그 병을 실측으로
                드러냈고(그쪽 주석), 이 목록은 행이 짧아 눈에 덜 띄었을 뿐 같은 자리였다. */}
            {filtered.map((project) => {
              const active = project.slug === selectedSlug;
              return (
                <button
                  key={project.slug}
                  type="button"
                  onClick={() => onSelect(project.slug)}
                  className={cn(
                    // 테두리 없는 평평한 목록 행(DS `.at-list-row`) — 이름 줄 + 경로 줄 + 원격 줄이 2px 사이로 선다.
                    // 안쪽 8 · 12 · 모서리 10(ui-refresh 결정 6 — 목록 행). 고른 행과 hover는 카드 안 목록의 두 단이다.
                    "flex w-full shrink-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                    active ? "selected-row" : "hover:bg-fill-soft",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-sm font-medium",
                        project.missing && "text-fg-secondary line-through",
                      )}
                    >
                      {project.name}
                    </span>
                    {project.missing && (
                      // 꼬리표(`tag` — DS `Tag`)의 빨간 갈래(`.at-tag.danger`)다.
                      <span className="tag ml-auto bg-danger/8 text-xs text-danger">누락</span>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-[7px] font-mono text-xs text-fg-secondary">
                    <Folder className="size-[13px] shrink-0 text-fg-tertiary" />
                    <span className="truncate">{project.path}</span>
                  </span>
                  {project.git?.remoteSlug && (
                    <span className="flex min-w-0 items-center gap-[7px] font-mono text-xs text-fg-secondary">
                      <GitFork className="size-[13px] shrink-0 text-fg-tertiary" />
                      <span className="truncate">{project.git.remoteSlug}</span>
                      {/* 꼬리표(`tag` — DS `Tag`). 글자는 이 줄의 고정폭을 물려받는다. */}
                      <span className="tag">{project.baseBranch}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default ProjectList;
