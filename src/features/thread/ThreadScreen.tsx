import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { ArrowDown, MessageSquare } from "lucide-react";
import { Card, Frame } from "@/components/shell/Frame";
import ApprovalCard from "./ApprovalCard";
import { threadApi } from "./api";
import ChangesPill from "./ChangesPill";
import { chipLists, currentModel } from "./chips";
import { awaitingLogin, checkEngineOnce, guideKind, threadEngineStore } from "./engine-store";
import { foldOf, type ThreadModel } from "./fold";
import GuideCard from "./GuideCard";
import HostFace from "./HostFace";
import { useChangeChip, useHostPreference, useQueue, useRenameThread, useThread, type ChipChange } from "./hooks";
import { changedFiles } from "./log";
import QueuedMessages from "./QueuedMessages";
import ThreadComposer from "./ThreadComposer";
import ThreadFlow, { UserMessage } from "./ThreadFlow";
import { LogPlace } from "./WorkLog";
import { linesOf, NEW_THREAD, threadRecordStore, toggleTurn, turnKey } from "./thread-store";
import type { RecordLine, ThreadView } from "./types";

// Thread 화면(v1 티켓 05 · 구현 스펙 §13 · §14 · 캔버스 Screen-Home · Messages · WorkLog · Composer 보드) — `/`는 새 Thread, `/threads/<id>`는
// 그 Thread다. 앱은 늘 새 Thread로 열린다(S26).
//
// - **틀은 앱의 공용 틀이다**(`Frame`) — 머리 카드에 Thread 이름이 서고 그 자리에서 바꾼다(두 번 클릭 · F2). 새 Thread는 「새 Thread」다.
//   사이드바 · 머리 줄의 시안 모양은 07이 맞춘다.
// - **빈 Thread**(Screen-Home 보드) — 가운데에 Host 얼굴 44 · 「무엇을 만들까요?」 · 부제 · 입력창 · 아래 줄 · 도움 줄. 첫 말을 보내면
//   엔진이 Thread를 세우고 Host의 Session이 열릴 때까지 기다린다(`thread_start`) — 그동안 보낸 말이 말풍선으로 서고 「생각 중」이
//   반짝인다. 새 id가 오면 그 주소로 갈아 선다(`replace` — 새 Thread의 자리가 곧 그 Thread가 됐다).
// - **Thread** — 흐름(`ThreadFlow`)이 읽기 좋은 폭(`size-thread`)에 가운데로 모이고, 바닥에 붙어 있다가 사람이 위로 굴리면 그 자리에
//   선다(그때 「맨 아래로」가 입력창 위 오른쪽에 선다). 입력창 위에는 바뀐 파일 알약 · 기다리는 말이, 입력창 자리에는 승인 카드가 선다.
// - **로그인 · 설치 안내**(`GuideCard`)는 Thread 본문을 대신한다.

/** 흐름 · 입력창을 모으는 열 — 읽기 좋은 폭(DS `size-thread` 48rem)에 가운데로 모인다. 좌우 여백은 바깥 칸이 들어 흐름과 입력창이 같은 폭이다. */
const COLUMN = "mx-auto flex w-full max-w-(--size-thread) flex-col";

interface ThreadScreenProps {
  sidebarOpen: boolean;
}

/** 새 Thread(`/`). */
export function NewThreadScreen({ sidebarOpen }: ThreadScreenProps) {
  const navigate = useNavigate();
  const host = useHostPreference();
  const [starting, setStarting] = useState<string | null>(null);
  const engine = useStore(threadEngineStore, (state) => state);
  useEffect(() => checkEngineOnce(), []);
  const guide = guideKind(engine, false);

  const start = async (text: string) => {
    setStarting(text);
    try {
      const id = await threadApi.start(text);
      void navigate({ to: "/threads/$id", params: { id }, replace: true });
    } catch (error) {
      setStarting(null);
      throw error;
    }
  };

  const composer = (
    <ThreadComposer
      draftKey={NEW_THREAD}
      models={null}
      model={host.model}
      effort={host.effort}
      onModel={() => {}}
      onEffort={() => {}}
      commands={[]}
      running={false}
      roomy={starting === null}
      busy={starting !== null}
      onSend={start}
      onNewThread={() => {}}
    />
  );
  return (
    <Frame sidebarOpen={sidebarOpen} head={{ icon: MessageSquare, name: "새 Thread" }}>
      <Card as="main" label="새 Thread" className="flex-1">
        {guide ? (
          <GuidePlace>
            <GuideCard kind={guide} view={engine} />
          </GuidePlace>
        ) : starting !== null ? (
          // 첫 말을 보냈다 — Session이 열려 새 주소로 갈아 서기까지 보낸 말과 「생각 중」이 선다.
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 scroll-quiet">
              <div className={`${COLUMN} gap-6 text-chat-body`}>
                <UserMessage text={starting} />
                <p className="chat-shimmer text-sm">생각 중</p>
              </div>
            </div>
            <div className="px-5 pb-4">
              <div className={COLUMN}>{composer}</div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-30 scroll-quiet">
            <div className="flex w-full max-w-(--size-thread) flex-col gap-7">
              <div className="flex flex-col items-center gap-3.5 text-center">
                <HostFace className="size-11" />
                <h1 className="text-heading-lg">무엇을 만들까요?</h1>
                <p className="text-sm text-fg-tertiary">Host가 답합니다. Work는 필요할 때 Host가 만들어요.</p>
              </div>
              {composer}
              <p className="flex flex-wrap justify-center gap-4.5 text-xs text-fg-tertiary">
                <span>
                  <b className="font-semibold text-fg-secondary">@</b> Agent 부르기
                </span>
                <span>
                  <b className="font-semibold text-fg-secondary">/</b> 명령
                </span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </Frame>
  );
}

/** Thread 하나(`/threads/<id>`). */
export function ThreadScreen({ thread, sidebarOpen }: ThreadScreenProps & { thread: string }) {
  const { data: view, error, isPending } = useThread(thread);
  const rename = useRenameThread();
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => checkEngineOnce(), []);
  const name = view?.title || "Thread";
  return (
    <Frame
      sidebarOpen={sidebarOpen}
      head={{
        icon: MessageSquare,
        name,
        rename: view
          ? {
              editing: renaming,
              onStart: () => setRenaming(true),
              onEnd: () => setRenaming(false),
              onCommit: (title) => {
                setProblem(null);
                rename.mutate({ thread, title }, { onError: (failure) => setProblem(String(failure)) });
              },
              label: "Thread 이름",
            }
          : undefined,
      }}
    >
      <Card as="main" label={name} className="flex-1">
        {view ? (
          <ThreadBody key={thread} view={view} problem={problem} />
        ) : (
          <GuidePlace>
            <p className="text-chat-meta text-fg-tertiary">
              {isPending ? "Thread를 여는 중이에요" : `Thread를 열지 못했어요 — ${String(error)}`}
            </p>
          </GuidePlace>
        )}
      </Card>
    </Frame>
  );
}

/** 안내 · 빈 자리의 칸 — 본문 위쪽 가운데. */
function GuidePlace({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 scroll-quiet">
      <div className={COLUMN}>{children}</div>
    </div>
  );
}

/** 참여자 handle → 화면 이름 — 기록의 들어옴 줄(`joined`)에서 읽는다. Host는 늘 「Host」다. */
function namesOf(lines: readonly RecordLine[]): Record<string, string> {
  const names: Record<string, string> = { host: "Host" };
  for (const line of lines) {
    if (line.kind !== "joined" || typeof line.payload !== "object" || line.payload === null) continue;
    const { handle, name } = line.payload as { handle?: unknown; name?: unknown };
    if (typeof handle === "string" && typeof name === "string" && name.trim() !== "") names[handle] = name;
  }
  return names;
}

function ThreadBody({ view, problem }: { view: ThreadView; problem: string | null }) {
  const navigate = useNavigate();
  const thread = view.id;
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread));
  // 다시 켠 뒤면 그 앞의 열린 턴 · 물음은 끝난 것으로 접힌다(`goneThrough`).
  const model: ThreadModel = foldOf(lines, view.live ? null : view.lastSeq);
  const lists = useMemo(() => chipLists(lines, "host"), [lines]);
  const names = useMemo(() => namesOf(lines), [lines]);
  const host = view.participants.find((one) => one.handle === "host") ?? null;
  const change = useChangeChip();
  const [chipProblem, setChipProblem] = useState<string | null>(null);
  const queue = useQueue(view);
  const engine = useStore(threadEngineStore, (state) => state);
  const guide = guideKind(engine, awaitingLogin(lines));

  const last = model.turns[model.turns.length - 1];
  // 알약이 세는 것 — 마지막 턴의 끝난 편집. 도는 동안에도 끝난 편집만큼 선다(Composer 보드 「작업 중 · … · 바뀐 파일」).
  const changes = last ? changedFiles(last) : null;
  const asking = model.pending[0] ?? null;
  const stopped = last?.end?.stopReason === "cancelled" && last.end.cancelledByUs;

  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const chip = (next: ChipChange) => {
    setChipProblem(null);
    change.mutate({ thread, who: "host", change: next }, { onError: (failure) => setChipProblem(String(failure)) });
  };

  if (guide) {
    return (
      <GuidePlace>
        <GuideCard kind={guide} view={engine} />
      </GuidePlace>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          stuck.current = atBottom;
          setAway(!atBottom);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-4 scroll-quiet"
      >
        <div className={COLUMN}>
          <LogPlace.Provider value={host?.cwd ?? null}>
            <ThreadFlow
              thread={thread}
              model={model}
              names={names}
              onRetry={(text) => void threadApi.send(thread, text).catch((failure: unknown) => setChipProblem(String(failure)))}
            />
          </LogPlace.Provider>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className={COLUMN}>
          <ThreadComposer
            draftKey={thread}
            models={lists.models}
            model={currentModel(lists, host)}
            effort={host?.effort ?? null}
            onModel={(value) => chip({ field: "model", value })}
            onEffort={(value) => chip({ field: "effort", value })}
            commands={lists.commands}
            running={model.running}
            stopped={stopped}
            onSend={(text) => {
              stuck.current = true;
              return threadApi.send(thread, text);
            }}
            onStop={() => threadApi.stop(thread)}
            onNewThread={() => void navigate({ to: "/" })}
            problem={problem ?? chipProblem}
            card={
              asking && (
                <ApprovalCard
                  key={asking.requestId}
                  thread={thread}
                  name={names[asking.who] ?? asking.who}
                  request={asking}
                  running={model.running}
                />
              )
            }
            above={
              (changes || away || queue.length > 0) && (
                <>
                  {(changes || away) && (
                    <div className="flex items-center gap-2">
                      {changes && last && (
                        <ChangesPill
                          changes={changes}
                          onReview={() => {
                            toggleTurn(turnKey(thread, last.key), true);
                            stuck.current = false;
                          }}
                        />
                      )}
                      <span className="flex-1" />
                      {away && (
                        <button
                          type="button"
                          aria-label="맨 아래로"
                          onClick={toBottom}
                          className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-surface text-fg-secondary shadow-lifted transition-colors hover:text-fg focus-ring"
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                  <QueuedMessages thread={thread} queue={queue} />
                </>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
