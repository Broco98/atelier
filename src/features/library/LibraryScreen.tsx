import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import { openInFinder } from "@/components/shell/open-in-finder";
import { PathBar, ROUND } from "@/components/shell/PathBar";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentFace } from "@/features/thread/AgentFace";
import { threadApi } from "@/features/thread/api";
import { useCreateAgent } from "@/features/thread/create-agent";
import { AGENT_FILE_KEY, AGENTS_KEY } from "@/features/thread/hooks";
import { agentChoices, type AgentChoice } from "@/features/thread/mentions";
import type { AgentRoster } from "@/features/thread/types";
import { useWorks } from "@/features/works/hooks";
import { agentFileRef } from "@/features/works/refs";
import { PrettyView, SourceView } from "@/features/works/SpecViewer";
import { libraryApi } from "./api";
import { agentPathPieces, frontmatterAsCode, groupsOf, pickedAgent, type LibraryGroup } from "./library";

// Library 화면(v1 티켓 19 · 구현 스펙 §16 S35) — Agent 목록과 파일 읽기만 한다. 고치는 길은 둘이다: 대화(「새 Agent 만들기」 · Host에게
// 맡김)와 외부 편집기(「Finder에서 열기」).
//
// - **틀은 앱 셸 하나다**(머리 줄 · 흰 판 — 02 구현 스펙 §3). 이 화면은 머리 줄에 「Library」와 오른쪽 끝 「새 Agent 만들기」를, 판 안에
//   목록과 파일을 건넨다(`PlainFrame`).
// - **왼쪽은 목록이다** — 사이드바 Thread 줄과 같은 두 줄(캔버스 「Thread 목록과 아바타」 보드 — 얼굴 32 · 이름 14/500 · 둘째 줄 13/18
//   `fg-tertiary` · 안쪽 8 · 반경 12)이고, 묶음 머리도 사이드바 묶음 머리(「Work」 · 「Thread」)의 꼴이다. 둘째 줄은 설명, 깨졌으면 그
//   까닭이다(흐리게 — @ 메뉴의 깨진 줄과 같은 55%). 이름 뒤에 `@handle`이 선다(@ 메뉴 줄과 같다). Library 보드는 없다 — 시안 비교는
//   사이드바 목록 · 컴포저 메뉴 부품과 맞댄다(디자인-참고/README).
// - **지금 Work의 Project 안 Agent는 따로 묶인다**(S35) — 사이드바의 Library 줄이 지금 선 자리의 Work를 주소에 싣는다(`workOfPlace`).
//   그 Work를 찾지 못하면(지웠다 · 보관했다) Library만 보이고 그 사실을 한 줄로 말한다.
// - **오른쪽은 고른 Agent의 파일이다** — 문서 카드의 경로 줄(`PathBar` — 문서 | 원문 · 경로 복사 · 줄 끝의 「Finder에서 열기」) 아래
//   문서 보기(`PrettyView`, frontmatter는 YAML 코드 블록)나 원문(`SourceView`)이 선다. 깨진 파일도 읽는다 — 무엇이 틀렸는지 봐야 고친다.
// - 파일은 사람이 언제든 바깥에서 고친다 — 창에 돌아올 때마다 목록과 파일을 다시 읽는다. 대화로 저장한 Agent는 기록의 `library` 줄이
//   목록을 다시 읽게 한다(`useThreadFeeds`).

interface LibraryScreenProps {
  /** 지금 Work — 그 Work의 Project 안 Agent를 따로 묶는다. 없으면 Library만이다. */
  work: string | null;
  /** 주소가 고른 Agent(부르는 이름). 없으면 첫 줄이다. */
  agent: string | undefined;
  onPick: (call: string) => void;
}

/** 목록의 열 — 사이드바와 같은 폭이라 줄의 말줄임이 사이드바 Thread 줄과 같은 자리에서 끊긴다. */
const LIST = "w-(--size-sidebar)";

function LibraryScreen({ work, agent, onPick }: LibraryScreenProps) {
  const createAgent = useCreateAgent();
  const scoped = useQuery({
    queryKey: [...AGENTS_KEY, work],
    queryFn: () => threadApi.agents(work),
    refetchOnWindowFocus: true,
    retry: false,
  });
  // 지금 Work를 찾지 못했다 — Library만이라도 보인다.
  const lost = work !== null && scoped.isError;
  const library = useQuery({
    queryKey: [...AGENTS_KEY, null],
    queryFn: () => threadApi.agents(null),
    enabled: lost,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const scope = lost ? null : work;
  const roster: AgentRoster | undefined = lost ? library.data : scoped.data;
  const rows = useMemo(() => agentChoices(roster ?? null, []), [roster]);
  const groups = useMemo(() => groupsOf(rows), [rows]);
  const picked = pickedAgent(rows, agent);
  const { data: works } = useWorks();
  const workTitle = works?.find((one) => one.slug === work)?.title ?? work;
  // 원문 보기는 화면이 쥔다 — 파일 칸은 Agent마다 새로 서지만(`key`) 골라 둔 보기는 다른 Agent로 가도 그대로다.
  const [source, setSource] = useState(false);

  return (
    <PlainFrame
      label="Library"
      title={{ name: "Library" }}
      end={
        <Button variant="ghost" size="top" onClick={createAgent}>
          <Plus aria-hidden />새 Agent 만들기
        </Button>
      }
    >
      <div className="relative flex min-h-0 flex-1">
        <section
          aria-label="Agent 목록"
          className={cn(LIST, "flex shrink-0 flex-col overflow-y-auto border-r-[0.5px] border-border-light px-2 py-2 scroll-quiet")}
        >
          {lost && <p className="px-2 pb-2 text-chat-meta text-fg-tertiary">Work `{work}`를 찾지 못해 Library만 보여요</p>}
          {scoped.isError && !lost && <p className="px-2 text-chat-meta text-fg-tertiary">Agent 목록을 읽지 못했어요</p>}
          {groups.map((group) => (
            <AgentGroup
              key={group.section}
              group={group}
              note={group.section === "Library" ? null : workTitle}
              picked={picked?.call ?? null}
              onPick={onPick}
            />
          ))}
        </section>
        <section aria-label="Agent 파일" className="flex min-w-0 flex-1 flex-col">
          {picked && (
            <AgentFile
              key={`${scope}\u0000${picked.call}`}
              row={picked}
              scope={scope}
              roster={roster}
              source={source}
              onSource={setSource}
            />
          )}
        </section>
        <Toaster />
      </div>
    </PlainFrame>
  );
}

/** 목록의 묶음 하나 — 머리(사이드바 묶음 머리의 꼴)와 줄들. Project 묶음은 머리 오른쪽에 어느 Work의 Project인지 옅게 선다. */
function AgentGroup({
  group,
  note,
  picked,
  onPick,
}: {
  group: LibraryGroup;
  note: string | null;
  picked: string | null;
  onPick: (call: string) => void;
}) {
  return (
    <div role="group" aria-label={group.section} className="flex flex-col">
      <h2 className="flex h-7.5 shrink-0 items-center gap-2 px-2 text-chat-meta text-fg-tertiary">
        <span className="min-w-0 truncate">{group.section}</span>
        {note && <span className="ml-auto min-w-0 shrink truncate">{note}</span>}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {group.rows.map((row) => (
          <li key={row.call}>
            <AgentRow row={row} on={row.call === picked} onPick={() => onPick(row.call)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 줄 하나 — 사이드바 Thread 줄의 두 줄 꼴. 깨진 줄은 얼굴과 글이 흐리고 둘째 줄이 그 까닭이다. 고른 줄은 사이드바의 고른 줄 면이다. */
function AgentRow({ row, on, onPick }: { row: AgentChoice; on: boolean; onPick: () => void }) {
  const broken = row.broken !== null;
  const second = row.broken ?? row.description;
  return (
    <button
      type="button"
      aria-current={on || undefined}
      aria-description={row.broken ?? undefined}
      onClick={() => {
        if (!on) onPick();
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-xl p-2 text-left transition-colors focus-ring",
        on ? "selected-row" : "text-fg hover:bg-fill-soft",
      )}
    >
      <AgentFace handle={row.handle} avatar={row.avatar} className={cn("size-8", broken && "opacity-55")} />
      <span className={cn("flex min-w-0 flex-1 flex-col", broken && "opacity-55")}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-nav-row">{row.name}</span>
          <span className="shrink-0 text-xs text-fg-tertiary">@{row.call}</span>
        </span>
        {second !== "" && <span className="truncate text-chat-meta text-fg-tertiary">{second}</span>}
      </span>
    </button>
  );
}

/** 고른 Agent의 파일 — 경로 줄과 문서 보기 · 원문. 원문 보기를 골라 두면 다른 Agent로 가도 원문이다(화면이 떠 있는 동안 — `source`). */
function AgentFile({
  row,
  scope,
  roster,
  source,
  onSource,
}: {
  row: AgentChoice;
  scope: string | null;
  roster: AgentRoster | undefined;
  source: boolean;
  onSource: (source: boolean) => void;
}) {
  const file = useQuery({
    queryKey: [...AGENT_FILE_KEY, scope, row.call],
    queryFn: () => libraryApi.readFile(scope, row.call),
    refetchOnWindowFocus: true,
    retry: false,
  });
  const path =
    roster?.agents.find((one) => one.call === row.call)?.path ?? roster?.broken.find((one) => one.call === row.call)?.path;
  return (
    <>
      <PathBar
        path={agentPathPieces(row)}
        view={{ source, locked: file.data === undefined, onChange: onSource }}
        onCopy={path ? () => copyText(path) : undefined}
        end={
          <Hint
            text="Finder에서 열기"
            announce="name"
            type="button"
            tabIndex={0}
            onClick={() => openInFinder(() => libraryApi.reveal(scope, row.call))}
            className={ROUND}
          >
            <FolderOpen aria-hidden className="size-4" />
          </Hint>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {file.data === undefined ? (
          file.isError && <p className="px-5 py-6 text-chat-meta text-fg-tertiary">파일을 읽지 못했어요 — {String(file.error)}</p>
        ) : source ? (
          <SourceView content={file.data} />
        ) : (
          <PrettyView
            file={path ?? `${row.handle}.md`}
            content={frontmatterAsCode(file.data)}
            onCopyBlock={(start, end) => copyText(agentFileRef(path ?? `${row.handle}.md`, start, end))}
            files={[]}
            onNavigate={() => {}}
            specRoot={null}
          />
        )}
      </div>
    </>
  );
}

export default LibraryScreen;
