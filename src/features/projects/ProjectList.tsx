import { useState } from "react";
import { Folder, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListHead } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
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

// 목록 칸의 안 — 목록 머리(「Projects」 · 개수 · `+`), 찾기 칸, 두 줄 행(DS `.at-listcol` · `.at-row.two`). 칸 · 세로 선 · 폭 손잡이는
// 공용 틀의 목록 칸이 든다(`Frame`의 `list` — codex-ds 결정 28). 폭의 저장도 화면(`ProjectsPage`)이 그 칸에 건넨다.
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
      {/* 목록 머리 — 제목 · 등록한 프로젝트 수와 끝의 `+`(DS `.at-ib` — 테두리 없는 28 아이콘 버튼). 신호등을 피할 일은 머리 줄의
          몫이라 여기에는 사이드바 열림에 따라 갈리는 여백이 없다. */}
      <ListHead
        title={navItem("projects").label}
        count={projects.length}
        end={
          <Hint
            text="프로젝트 등록"
            announce="name"
            render={<Button variant="ghost" size="icon" onClick={onAdd} />}
          >
            <Plus className="size-4" />
          </Hint>
        }
      />

      {/* 찾기 칸 — 머리 아래 칸 폭으로 서고 행과 8 떨어진다(DS `.at-search`). */}
      {projects.length > 0 && (
        <InputGroup className="mb-2 shrink-0">
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
            <Button variant="soft" size="xs" onClick={onAdd}>
              프로젝트 등록
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pb-10">
          <span className="text-chat-meta text-fg-tertiary">검색 결과가 없어요</span>
        </div>
      ) : (
        <div className="-mx-2 -mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2 scroll-quiet">
          {/* **`-mx-2 px-2`가 칸의 안쪽 여백을 뚫고 나갔다 되돌린다** — 보이는 것은 안 움직이고 막대만
              칸 가장자리로 간다. 상자가 안쪽 여백 안에 들어앉아 있으면 막대(상자 안쪽 3~9px)가
              그만큼 더 안쪽에 서서 행 위로 들어온다. 사이드바 work 목록이 그 병을 실측으로
              드러냈고(그쪽 주석), 이 목록도 같은 자리였다.
              위끝의 `-mt-1 pt-1`도 같은 손버릇이다 — 첫 행의 포커스 링(테두리 바깥 4px)이 구르는 상자의 위끝에 잘리지 않게
              상자만 4px 올라갔다 되돌린다(codex-ds 결정 11 · `index.css`의 `focus-ring-room`). 아래끝은 `pb-2`가 그 자리이자
              칸 바닥의 안쪽 8이다(DS `.at-listcol`). */}
          {filtered.map((project) => {
            const active = project.slug === selectedSlug;
            return (
              <button
                key={project.slug}
                type="button"
                onClick={() => onSelect(project.slug)}
                className={cn(
                  // 두 줄 행(DS `.at-row.two`) — 50 이상 · 안쪽 7 8 · 모서리 10, 이름 줄과 경로 줄이 2 사이로 선다. 글자가 칸 + 16에
                  // 서서 목록 머리의 제목과 한 세로줄이다. 고른 행과 hover는 카드 안 목록의 두 단이다.
                  "flex min-h-12.5 w-full shrink-0 flex-col gap-0.5 rounded-lg px-2 py-1.75 text-left transition-colors focus-ring",
                  active ? "selected-row" : "hover:bg-fill-soft",
                )}
              >
                {/* 이름 줄 — 폴더 글리프 14(`fg-secondary`)와 이름 14/500. 폴더를 못 찾은 프로젝트는 끝에 「누락」 꼬리표가 선다. */}
                <span className="flex w-full min-w-0 items-center gap-2">
                  <Folder aria-hidden className="size-3.5 shrink-0 text-fg-secondary" />
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
                {/* 경로 줄 — 고정폭 12 `fg-tertiary`(행 메타, DS 「대비」)이고 이름 글자 밑에서 시작한다(글리프 14 + 사이 8). */}
                <span className="w-full truncate pl-5.5 font-mono text-xs text-fg-tertiary">{project.path}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default ProjectList;
