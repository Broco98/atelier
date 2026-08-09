import { useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Terminal } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { useProjects } from "@/features/projects/hooks";
import { cn } from "@/lib/utils";
import { useCreateSession, useSessions } from "./hooks";

interface SessionsPageProps {
  sidebarOpen: boolean;
}

function SessionsPage({ sidebarOpen }: SessionsPageProps) {
  const { data: sessions = [] } = useSessions();
  const { data: projects = [] } = useProjects();
  const [startPointSlug, setStartPointSlug] = useState<string | null>(null);
  const createSession = useCreateSession();

  const startPoint =
    projects.find((p) => p.slug === startPointSlug) ?? projects[0] ?? null;

  const handleStart = async () => {
    if (!startPoint || createSession.isPending) return;
    try {
      await createSession.mutateAsync(startPoint.slug);
    } catch (e) {
      // 무엇을 실행하려다 실패했는지가 이 문장 안에 들어 있다 (커맨드 + 원인)
      await message(`세션을 시작하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        root="Sessions"
        inset={!sidebarOpen}
        actions={
          projects.length > 0 && (
            <>
              <select
                value={startPoint?.slug ?? ""}
                onChange={(e) => setStartPointSlug(e.target.value)}
                aria-label="시작점"
                className="h-7 max-w-[220px] rounded-[9px] border border-border-strong bg-background px-2 text-[13.5px] font-medium text-muted-foreground"
              >
                {projects.map((project) => (
                  <option key={project.slug} value={project.slug}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleStart}
                disabled={createSession.isPending}
                className="h-7 rounded-[9px] bg-primary px-[11px] text-[13.5px] font-medium text-primary-foreground transition-[filter] hover:brightness-[1.08] disabled:opacity-40"
              >
                {createSession.isPending ? "시작 중…" : "세션 시작"}
              </button>
            </>
          )
        }
      />

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <EmptyState
            title="등록된 프로젝트가 없어요"
            hint="세션은 등록된 프로젝트에서 시작해요. 먼저 Projects에서 폴더를 등록하세요."
          />
        ) : sessions.length === 0 ? (
          <EmptyState
            title="아직 세션이 없어요"
            hint="시작점을 고르고 세션 시작을 누르면 그 디렉터리에서 에이전트가 떠요."
          />
        ) : (
          <ul className="flex flex-col gap-[3px] p-3">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-col gap-[7px] rounded-[12px] px-3 py-2.5 hover:bg-accent"
              >
                <span className="flex items-center gap-[7px]">
                  <span
                    aria-label={session.alive ? "살아있음" : "죽음"}
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      session.alive ? "bg-primary" : "bg-border-strong",
                    )}
                  />
                  <span className="min-w-0 truncate text-[13.5px] font-medium">
                    {projectName(projects, session.startPoint.slug)}
                  </span>
                  <span className="shrink-0 rounded-[6px] bg-accent px-1.5 py-px text-[11px] text-muted-foreground">
                    {session.agent}
                  </span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-tertiary">
                    {formatStarted(session.createdAt)}
                  </span>
                </span>
                <span className="truncate font-mono text-[11.5px] text-tertiary">
                  {session.cwd}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/** 슬러그보다 이름이 읽힌다. 등록이 지워진 프로젝트면 슬러그가 마지막 단서다. */
function projectName(projects: { slug: string; name: string }[], slug: string) {
  return projects.find((p) => p.slug === slug)?.name ?? slug;
}

function formatStarted(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex max-w-[400px] flex-col items-center gap-[7px] text-center">
        <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
          <Terminal className="size-5" strokeWidth={1.6} />
        </div>
        <span className="text-[16.5px] font-semibold tracking-[-0.01em]">{title}</span>
        <span className="text-[14px] leading-[1.65] text-tertiary">{hint}</span>
      </div>
    </div>
  );
}

export default SessionsPage;
