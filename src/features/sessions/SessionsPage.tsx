import { useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Terminal } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { useProjects } from "@/features/projects/hooks";
import SessionList from "./SessionList";
import SessionThread from "./SessionThread";
import { useCreateSession, useSessions, useWatchPermissions } from "./hooks";
import type { SessionView } from "./types";

interface SessionsPageProps {
  sidebarOpen: boolean;
}

function SessionsPage({ sidebarOpen }: SessionsPageProps) {
  const { data: sessions = [] } = useSessions();
  const { data: projects = [] } = useProjects();
  const [startPointSlug, setStartPointSlug] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const createSession = useCreateSession();
  // 지금 보고 있지 않은 세션에 뜬 권한 요청도 목록에서 보여야 한다
  useWatchPermissions();

  const startPoint =
    projects.find((p) => p.slug === startPointSlug) ?? projects[0] ?? null;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  // 첫 지시가 세션의 이름이 된다. 아직 없으면 어느 프로젝트에서 떴는지가 다음 단서이고,
  // 그 프로젝트의 등록이 지워졌으면 슬러그가 마지막 단서다.
  const label = (session: SessionView) =>
    session.title ??
    projects.find((p) => p.slug === session.startPoint.slug)?.name ??
    session.startPoint.slug;

  const handleStart = async () => {
    if (!startPoint || createSession.isPending) return;
    try {
      const started = await createSession.mutateAsync(startPoint.slug);
      setSelectedId(started.id);
    } catch (e) {
      // 무엇을 실행하려다 실패했는지가 이 문장 안에 들어 있다 (커맨드 + 원인)
      await message(`세션을 시작하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SessionList
        sessions={sessions}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        label={label}
        sidebarOpen={sidebarOpen}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Sessions"
          leaf={selected ? label(selected) : undefined}
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

        {selected ? (
          // 세션을 바꾸면 대화도 처음부터 다시 그린다 — 재생과 라이브가 섞이지 않도록
          <SessionThread key={selected.id} session={selected} />
        ) : (
          <EmptyState
            title={projects.length === 0 ? "등록된 프로젝트가 없어요" : "세션을 고르세요"}
            hint={
              projects.length === 0
                ? "세션은 등록된 프로젝트에서 시작해요. 먼저 Projects에서 폴더를 등록하세요."
                : "왼쪽에서 세션을 고르면 지난 대화가 그대로 보이고, 이어서 지시할 수 있어요."
            }
          />
        )}
      </main>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
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
