import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { ArrowDown, ArrowLeft } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { AgentFace, FaceStack } from "./AgentFace";
import ApprovalCard from "./ApprovalCard";
import { threadApi } from "./api";
import ChangesPill from "./ChangesPill";
import { chipLists, currentModel } from "./chips";
import { useCreateAgent } from "./create-agent";
import { awaitingLogin, checkEngineOnce, guideKind, threadEngineStore } from "./engine-store";
import { flowOf, foldOf, type CallEntry, type CastMember, type ThreadModel } from "./fold";
import GuideCard from "./GuideCard";
import HostFace from "./HostFace";
import { useAgentRoster, useChangeChip, useQueue, useRenameThread, useSetMode, useThread, type ChipChange } from "./hooks";
import { changedFiles } from "./log";
import { agentChoices, recipientOf, type SeatedAgent } from "./mentions";
import QueuedMessages from "./QueuedMessages";
import ThreadComposer from "./ThreadComposer";
import ThreadFlow, { UserMessage } from "./ThreadFlow";
import { LogPlace } from "./WorkLog";
import { linesOf, NEW_THREAD, threadRecordStore, threadUiStore, toggleTurn, turnKey } from "./thread-store";
import type { AskLevel, Attachment, ThreadView } from "./types";

// Thread 화면(v1 티켓 05 · 구현 스펙 §13 · §14 · 캔버스 Screen-Home · Messages · WorkLog · Composer 보드) — `/`는 새 Thread, `/threads/<id>`는
// 그 Thread다. 앱은 늘 새 Thread로 열린다(S26).
//
// - **틀은 카드 없는 흰 면이다**(`PlainFrame` — v1 티켓 07) — 머리 줄에 Thread 이름이 서고 그 자리에서 바꾼다(두 번 클릭 · F2). 새
//   Thread의 머리 줄은 비어 있다(Screen-Home 보드).
// - **빈 Thread**(Screen-Home 보드) — 가운데에 Host 얼굴 44 · 「무엇을 만들까요?」 · 부제 · 입력창 · 아래 줄 · 도움 줄. 첫 말을 보내면
//   엔진이 Thread를 세우고 Host의 Session이 열릴 때까지 기다린다(`thread_start`) — 그동안 보낸 말이 말풍선으로 서고 「생각 중」이
//   반짝인다. 새 id가 오면 그 주소로 갈아 선다(`replace` — 새 Thread의 자리가 곧 그 Thread가 됐다).
// - **Thread** — 흐름(`ThreadFlow`)이 읽기 좋은 폭(`size-thread`)에 가운데로 모이고, 바닥에 붙어 있다가 사람이 위로 굴리면 그 자리에
//   선다(그때 「맨 아래로」가 입력창 위 오른쪽에 선다). 입력창 위에는 바뀐 파일 알약 · 기다리는 말이, 입력창 자리에는 승인 카드가 선다.
// - **로그인 · 설치 안내**(`GuideCard`)는 Thread 본문을 대신한다.
// - **여럿이 한 Thread에**(v1 티켓 14) — 머리 줄 오른쪽에 참여자 얼굴이 겹쳐 서고 셋이 넘으면 「+n」이다(`ThreadParticipants`).
//   입력창의 @ 메뉴 · 받는 이 칩은 이 Thread의 범위(`list_agents(work)`)와 앉은 참여자로 서고, 모델 칩은 **다음 말을 받을 참여자**의
//   Session 값이다(§14 「입력창 아래 줄」) — 아직 앉지 않은 Agent를 멘션하면 그 정의 파일의 값을 보이기만 한다. @ 메뉴 끝의
//   「새 Agent 만들기」는 새 Thread의 입력창에 Agent 만들기를 맡기는 말을 채운다(v1 티켓 19 · `useCreateAgent`).
// - **물어보는 정도**(v1 티켓 23 · S18) — 입력창 아래 칩 · `/plan` · `/policy`가 고른다. 새 Thread에서는 첫 말과 함께 가고(그 정도로
//   첫 Session이 뜬다), 선 Thread에서는 곧바로 바꾼다 — 바꾼 것은 흐름의 시스템 줄(「Policy를 … 바꿈」)로 남는다. 칩 메뉴의 「Policy
//   열기」는 다음 말을 받을 Agent의 파일을 Library에서 연다.
// - **Session 보기**(v1 티켓 17 · 구현 스펙 §8 · S37) — 호출 줄의 「Session 열기」는 새 창 없이 같은 흐름에서 그 Agent의 줄만 거른다.
//   흐름 위에 붙은 머리 줄(얼굴 · 「리뷰어의 Session」 · 「Thread로 돌아가기」)이 돌아가는 길이고, 돌아가면 열기 전에 보던 자리로
//   굴러 간다. 열 때는 그 부르기의 맡은 턴으로 굴러 간다. 입력창 · 승인 카드는 그대로다.

/** 흐름 · 입력창을 모으는 열 — 읽기 좋은 폭(DS `size-thread` 48rem)에 가운데로 모인다. 좌우 여백은 바깥 칸이 들어 흐름과 입력창이 같은 폭이다. */
const COLUMN = "mx-auto flex w-full max-w-(--size-thread) flex-col";

interface ThreadScreenProps {
  sidebarOpen: boolean;
}

/** 「Policy 열기」의 자리 — Library 화면의 그 Agent 파일. Work에 이었으면 그 Work의 Project 안 Agent도 서는 범위다. */
const policyPlace = (call: string, work: string | null) =>
  ({ to: "/library", search: { agent: call, ...(work !== null && { work }) } }) as const;

/** 새 Thread(`/`). */
export function NewThreadScreen({ sidebarOpen }: ThreadScreenProps) {
  const navigate = useNavigate();
  const roster = useAgentRoster(null);
  const agents = useMemo(() => agentChoices(roster, []), [roster]);
  const createAgent = useCreateAgent();
  const draft = useStore(threadUiStore, (state) => state.drafts[NEW_THREAD] ?? "");
  const recipient = recipientOf(draft, agents);
  // 첫 말을 받을 이 — 멘션한 Agent, 없으면 Host. 칩은 그 정의 파일의 모델 · 생각 깊이를 보이기만 한다(스토리 33).
  const first = recipient?.agent ?? agents.find((one) => one.call === "host") ?? null;
  const [starting, setStarting] = useState<{ text: string; attachments: readonly Attachment[] } | null>(null);
  // 아직 Thread가 없다 — 고른 정도는 첫 말과 함께 간다.
  const [level, setLevel] = useState<AskLevel>("always");
  const engine = useStore(threadEngineStore, (state) => state);
  useEffect(() => checkEngineOnce(), []);
  const guide = guideKind(engine, false);

  const start = async (text: string, attachments: readonly Attachment[]) => {
    setStarting({ text, attachments });
    try {
      const id = await threadApi.start(text, attachments, level);
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
      model={first?.model?.prefer ?? null}
      effort={first?.model?.effort ?? null}
      onModel={() => {}}
      onEffort={() => {}}
      commands={[]}
      running={false}
      roomy={starting === null}
      busy={starting !== null}
      onSend={start}
      onNewThread={() => {}}
      agents={agents}
      recipient={recipient}
      onCreateAgent={createAgent}
      level={level}
      onLevel={setLevel}
      onOpenPolicy={() => void navigate(policyPlace(first?.call ?? "host", null))}
    />
  );
  return (
    <PlainFrame sidebarOpen={sidebarOpen} label="새 Thread">
      {guide ? (
        <GuidePlace>
          <GuideCard kind={guide} view={engine} />
        </GuidePlace>
      ) : starting !== null ? (
        // 첫 말을 보냈다 — Session이 열려 새 주소로 갈아 서기까지 보낸 말과 「생각 중」이 선다.
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 scroll-quiet">
            <div className={`${COLUMN} gap-6 text-chat-body`}>
              <UserMessage text={starting.text} attachments={starting.attachments} />
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
              <span>
                <b className="font-semibold text-fg-secondary">+</b> 파일 · 이미지
              </span>
            </p>
          </div>
        </div>
      )}
    </PlainFrame>
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
    <PlainFrame
      sidebarOpen={sidebarOpen}
      label={name}
      title={{
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
      end={view && view.participants.length > 0 ? <ThreadParticipants view={view} /> : undefined}
    >
      {view ? (
        <ThreadBody key={thread} view={view} problem={problem} />
      ) : (
        <GuidePlace>
          <p className="text-chat-meta text-fg-tertiary">
            {isPending ? "Thread를 여는 중이에요" : `Thread를 열지 못했어요 — ${String(error)}`}
          </p>
        </GuidePlace>
      )}
    </PlainFrame>
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

/** 참여자의 이름 · 얼굴은 기록의 들어옴 줄(`fold.ts`의 `cast`), 누가 앉았는지는 `thread.json`의 참여자 줄이 정본이다. */
function seatedOf(view: ThreadView, model: ThreadModel): SeatedAgent[] {
  return view.participants.map((one) => ({
    handle: one.handle,
    from: one.from,
    name: model.cast[one.handle]?.name ?? one.handle,
    avatar: model.cast[one.handle]?.avatar ?? null,
  }));
}

/** 머리 줄의 참여자 얼굴(스토리 45 · 캔버스 화면 2 · Sidebar 「셋 넘으면 숫자」) — 들어온 차례로 셋까지, 넘으면 「+n」이다. */
function ThreadParticipants({ view }: { view: ThreadView }) {
  const lines = useStore(threadRecordStore, (state) => linesOf(state, view.id));
  const model = foldOf(lines, view.live ? null : view.lastSeq);
  return (
    <FaceStack
      people={seatedOf(view, model)}
      max={3}
      label="참여자"
      faceClass="size-6"
      moreClass="h-6 min-w-6"
      className="-space-x-2 pr-1"
    />
  );
}

function ThreadBody({ view, problem }: { view: ThreadView; problem: string | null }) {
  const navigate = useNavigate();
  const thread = view.id;
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread));
  // 다시 켠 뒤면 그 앞의 열린 턴 · 물음은 끝난 것으로 접힌다(`goneThrough`).
  const model: ThreadModel = foldOf(lines, view.live ? null : view.lastSeq);
  const roster = useAgentRoster(view.work);
  const agents = useMemo(() => agentChoices(roster, seatedOf(view, model)), [roster, view, model]);
  const createAgent = useCreateAgent();
  const draft = useStore(threadUiStore, (state) => state.drafts[thread] ?? "");
  const recipient = recipientOf(draft, agents);
  // 다음 말을 받을 참여자 — 멘션이 없거나 모르는 이름이면 Host, 앉은 Agent를 멘션하면 그다. 아직 앉지 않은 Agent면 참여자가 없다.
  const target = recipient?.agent ?? null;
  const who = target ? (target.seated ? target.handle : null) : "host";
  const participant = view.participants.find((one) => one.handle === who) ?? null;
  const lists = useMemo(() => chipLists(lines, participant?.handle ?? "host"), [lines, participant?.handle]);
  // 앉지 않은 받는 이(새로 부를 Agent · 아직 들어오지 않은 Host)는 정의 파일의 값을 보이기만 한다.
  const preference = (target ?? agents.find((one) => one.call === "host"))?.model ?? null;
  const host = view.participants.find((one) => one.handle === "host") ?? null;
  const change = useChangeChip();
  const setMode = useSetMode();
  const [chipProblem, setChipProblem] = useState<string | null>(null);
  const queue = useQueue(view);
  const engine = useStore(threadEngineStore, (state) => state);
  const guide = guideKind(engine, awaitingLogin(lines));

  // 흐름에 선 마지막 턴 — 일하는 맡은 턴은 아직 흐름에 서지 않았다(`flowOf`).
  const shown = flowOf(model).turns;
  const last = shown[shown.length - 1];
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

  // Session 보기 — 누구의 줄만 그리나, 열 때 굴러 갈 맡은 턴. 돌아갈 자리는 열기 전의 굴림 값이다.
  const [session, setSession] = useState<{ handle: string; turn: string | null } | null>(null);
  const back = useRef<number | null>(null);
  const openSession = useCallback(
    (call: CallEntry) => {
      back.current = scroller.current?.scrollTop ?? 0;
      const turn = model.turns.find((one) => one.assigned?.id === call.id);
      setSession({ handle: call.to, turn: turn?.key ?? null });
    },
    [model.turns],
  );
  const closeSession = () => setSession(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    // 처음 그릴 때는 할 일이 없다 — 바닥에 붙는 일은 기록 줄의 효과가 한다.
    if (!el || (session === null && back.current === null)) return;
    if (session) {
      const target = session.turn ? el.querySelector(`[data-turn="${CSS.escape(session.turn)}"]`) : null;
      if (target) target.scrollIntoView({ block: "start" });
      else el.scrollTop = el.scrollHeight;
    } else if (back.current !== null) {
      el.scrollTop = back.current;
      back.current = null;
    }
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAway(!stuck.current);
  }, [session]);
  const callAgain = useCallback(
    (call: CallEntry) =>
      threadApi.callAgain(thread, call.from, call.to, call.text).catch((failure: unknown) => setChipProblem(String(failure))),
    [thread],
  );

  const pickLevel = (mode: AskLevel) => {
    setChipProblem(null);
    setMode.mutate({ thread, mode }, { onError: (failure) => setChipProblem(String(failure)) });
  };
  // 「Policy 열기」 — 다음 말을 받을 Agent(멘션이 없으면 Host)의 파일.
  const policyOwner = target?.call ?? "host";

  const chip = (next: ChipChange) => {
    if (!participant) return;
    setChipProblem(null);
    change.mutate(
      { thread, who: participant.handle, change: next },
      { onError: (failure) => setChipProblem(String(failure)) },
    );
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
          {session && (
            <SessionHead
              handle={session.handle}
              name={model.cast[session.handle]?.name ?? session.handle}
              avatar={model.cast[session.handle]?.avatar ?? null}
              onBack={closeSession}
            />
          )}
          <LogPlace.Provider value={host?.cwd ?? null}>
            <ThreadFlow
              thread={thread}
              model={model}
              only={session?.handle ?? null}
              onRetry={(text, attachments) =>
                void threadApi.send(thread, text, attachments).catch((failure: unknown) => setChipProblem(String(failure)))
              }
              onOpenSession={openSession}
              onCallAgain={callAgain}
            />
          </LogPlace.Provider>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className={COLUMN}>
          <ThreadComposer
            draftKey={thread}
            models={participant ? lists.models : null}
            model={participant ? currentModel(lists, participant) : (preference?.prefer ?? null)}
            effort={participant ? participant.effort : (preference?.effort ?? null)}
            onModel={(value) => chip({ field: "model", value })}
            onEffort={(value) => chip({ field: "effort", value })}
            commands={lists.commands}
            running={model.running}
            stopped={stopped}
            onSend={(text, attachments) => {
              stuck.current = true;
              return threadApi.send(thread, text, attachments);
            }}
            onStop={() => threadApi.stop(thread)}
            onNewThread={() => void navigate({ to: "/" })}
            problem={problem ?? chipProblem}
            agents={agents}
            recipient={recipient}
            recipientRunning={participant !== null && model.answering.includes(participant.handle)}
            onCreateAgent={createAgent}
            level={view.askLevel}
            onLevel={pickLevel}
            onOpenPolicy={() => void navigate(policyPlace(policyOwner, view.work))}
            card={
              asking && (
                <ApprovalCard
                  key={asking.requestId}
                  thread={thread}
                  name={model.cast[asking.who]?.name ?? asking.who}
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

/**
 * Session 보기의 머리 줄(S37) — 흐름 위에 붙어 굴려도 남는다. 굴림 상자의 위 여백(`pt-6`)까지 덮고 붙는다(`-top-6`) — 그 여백으로 흐름이
 * 비쳐 오르지 않게. 왼쪽은 돌아가는 길(「Thread로 돌아가기」), 오른쪽은 누구의 Session인지
 * (얼굴 · 이름 · `@handle`)다. 시안에 없는 줄이라 작업 로그의 글자 · 색을 따른다.
 */
function SessionHead({
  handle,
  name,
  avatar,
  onBack,
}: {
  handle: string;
  name: string;
  avatar: CastMember["avatar"];
  onBack: () => void;
}) {
  return (
    <div
      data-session={handle}
      className="sticky -top-6 z-10 -mt-6 mb-4 flex items-center gap-2 border-b-[0.5px] border-border-light bg-surface pt-3 pb-2"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-chat-meta text-fg-secondary transition-colors quiet-hover focus-ring"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Thread로 돌아가기
      </button>
      <span className="flex-1" />
      <h2 className="flex items-center gap-1.5 text-chat-meta">
        <AgentFace handle={handle} avatar={avatar} className="size-5" />
        <b className="font-semibold">{name}의 Session</b>
        {handle !== "host" && <span className="text-xs text-fg-tertiary">@{handle}</span>}
      </h2>
    </div>
  );
}
