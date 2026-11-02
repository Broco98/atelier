import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { ArrowDown } from "lucide-react";
import { PANEL_MOTION } from "@/components/shell/panel-layout";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { shellStore, showSidebar } from "@/components/shell/shell-store";
import { workChangesKey } from "@/features/files/hooks";
import { useProjects } from "@/features/projects/hooks";
import { worksApi } from "@/features/works/api";
import { expandHome } from "@/features/works/doc-refs";
import { useReadingScope, useServices } from "@/features/services/hooks";
import { useHomeDir, useWorks } from "@/features/works/hooks";
import { cn } from "@/lib/utils";
import { withoutNewWork, type NewThreadSeed } from "@/routes/-new-thread-search";
import { recallSearch } from "@/routes/-work-search";
import ApprovalCard from "./ApprovalCard";
import { ArrivalScope, Arriving } from "./arrival";
import QuestionCard from "./QuestionCard";
import { threadApi } from "./api";
import { placeOf } from "./approval";
import { askTurn, nextOf } from "./asks";
import { AskNext } from "./AskTurnMarks";
import ChangesPill from "./ChangesPill";
import { chipLists, CLAUDE_MODELS, currentModel, newThreadLevel } from "./chips";
import { awaitingLogin, checkEngineOnce, guideKind, threadEngineStore } from "./engine-store";
import { foldOf, type ThreadModel } from "./fold";
import type { Opened } from "./expanded";
import GuideCard from "./GuideCard";
import {
  useChangeChip,
  useMarkRead,
  useQueue,
  useRenameThread,
  useSetMode,
  useThread,
  useThreads,
  useWorkMode,
  type ChipChange,
} from "./hooks";
import { changedFiles } from "./log";
import { reducedMotion } from "./motion";
import QueuedMessages from "./QueuedMessages";
import ReadOnlyNotice from "./ReadOnlyNotice";
import { changesOf, fixAsk, type PrLine } from "./pr";
import { PrPlace, type PrActions } from "./PrCard";
import { ResultPlace, type ResultActions } from "./ResultCard";
import { runtimeNameOf } from "./runtime";
import { readMark } from "./status";
import ThreadComposer from "./ThreadComposer";
import ThreadFlow, { DocPlace, FollowTail, TURN_GAP, UserMessage } from "./ThreadFlow";
import { isToolCardAsk } from "./tool-cards";
import { ToolCardSlot } from "./ToolCards";
import { LogPlace } from "./WorkLog";
import { fillDraft, linesOf, NEW_THREAD, threadRecordStore, toggleTurn, turnKey } from "./thread-store";
import type { AskLevel, Attachment, StartPicks, ThreadView } from "./types";
import type { ComposerTray, ScopeChoice } from "./ComposerChips";
import { ArchivedSummaryCard, LooseSummaryCard, useSummaryOpen, WorkSummaryCard } from "./SummaryCard";
import { HeadWork, ServiceCrumb, SummaryToggle, ThreadMenu } from "./ThreadHead";
import { headService, heldScope, holdOf, holdPick, scopeArgs, shownScope, startScope } from "./service-chip";
import { lockedWork, startLink, startPlaceholder } from "./work-chip";

// Thread 화면(v1 티켓 05 · 구현 스펙 §13 · §14 · 캔버스 Screen-Home · Messages · WorkLog · Composer 보드) — `/`는 새 Thread, `/threads/<id>`는
// 그 Thread다. 앱은 늘 새 Thread로 열린다(S26).
//
// - **틀은 앱 셸 하나다**(크롬 맨 위 머리 줄 · 그 아래 흰 판 — 02 구현 스펙 §3) — 이 화면은 머리 줄에 놓을 것과 판 안의 본문만 건넨다
//   (`PlainFrame`). 새 Thread의 머리 줄은 비어 있다.
// - **머리 줄**(02 구현 스펙 §6 · 캔버스 v35 Screen-Live 머리 줄 · `ThreadHead`) — 왼쪽에 Thread 이름(14/500)이 서고 그 자리에서 바꾼다
//   (두 번 클릭 · F2). Work에 이은 Thread면 이름 앞에 흐린 「폴더 · 작업공간 이름 ›」이 서고, Work 이름을 누르면 카드가 열린다(S13). Work 없는
//   Thread에 Service가 있으면 「흐린 Service /」가 서고 누르면 그 Service 상세다(03 §10 — Service가 없으면 이름만). 오른쪽
//   끝에 「…」(이 Thread의 대상 메뉴 — 「이름 바꾸기」, S15)와 요약 고정 토글이 선다(Work 없는 Thread에도 — 첫 말 전의 새 Thread에는 둘
//   다 없다, S23). 옛 Work 알약(브랜치)은 걷었다(S14). 시안의 머리 줄 Work
//   탭은 짓지 않는다 — Work 화면 몫이다.
// - **빈 Thread**(02 티켓 10 · 02 구현 스펙 §11 · 캔버스 v35 F1-Home) — 가운데에 「무엇을 만들까요?」(28 · 보통 굵기 · 자간 −0.2) 한 줄, 그
//   아래 28에 입력창과 트레이뿐이다. 시안의 Service 제안 줄은 짓지 않는다(03
//   P3). 칩은 입력창 안에 서고(v1 티켓 31 · 사용자 결정), 첫 말 전에 물어보는 정도 · 모델과 생각 깊이를, 상자 아래 트레이에서 범위를
//   고른다(03 §5). 고른 범위는 입력창이 쥐었다가 첫 말과 함께 간다(`service-chip.ts` — 씨앗 `?service=` · `?project=`가 처음 쥔다). 보드의 부제(「Host가 답합니다. …」)도 걷었다(v1 티켓 46 — 칩이 고른 것을
//   이미 말한다). 어디서 일할지는 주소 씨앗이 정한다(`startLink`) — 씨앗이 없으면 작업공간 없는 채팅이고, `?new=work`는 ×로 뺄 수 있는 「새 작업공간」
//   칩을, `?work=`는 그 Work의 잠긴 칩을 세운다. 입력 글 씨앗(`?say=`)은 입력창에 넣기만 하고 보내는 것은 사람이다. 시작할 곳을 입력창
//   안내가 따른다(`startPlaceholder`). 첫 말을 보내면 엔진이 고른 것대로
//   Thread를 세우고 받는 Agent의 Session이 열릴 때까지 기다린다(`thread_start`) — 그동안 보낸 말이 말풍선으로 서고 「생각 중」이
//   반짝인다. 새 id가 오면 그 주소로 갈아 선다(`replace` — 새 Thread의 자리가 곧 그 Thread가 됐다).
// - **트레이**(03 §5) — Thread 화면에도 선다. 입력창이 화면 아래에 붙으므로 상자 위다. Work 칩은 잠겨 보이기만 한다(`lockedWork`
//   — 이은 Work 이름은 누르면 그 Work 화면, 「작업공간 없이 대화」, 아직 Work가 서지 않은 흐린 「새 작업공간」). 첫 말을 보내 Session이 열리기를
//   기다리는 동안도 같은 잠긴 트레이가 바닥 입력창 위에 선다. 범위 칩과 범위 줄은 첫 말 뒤에 서지 않는다 — 범위는 대화로 바꾼다(Service 도구).
// - **Thread** — 흐름(`ThreadFlow`)이 대화 열 폭(`size-column` 737 — Codex, 02 §9)에 가운데로 모이고, 바닥에 붙어 있다가 사람이 위로 굴리면 그 자리에
//   선다(그때 「맨 아래로」가 입력창 위 가운데에 선다 — Motion 보드, v1 티켓 46). Agent가 일하는 동안은 그 자리의 원 안에 점 셋이 선다(02
//   §10). 입력창 위에는 바뀐 파일 알약 · 기다리는 말이, 입력창 자리에는 승인 카드 등 한 겉의 카드가 선다(v1 티켓 24 · 02 §10 — 실행할
//   자리는 그 Session의 작업 폴더를 이은 Work의 자리 · 브랜치와 견줘 읽는다). 여럿이 물으면 먼저 온 것 하나만 서고 카드가
//   「1 / 2」 · 「다음 · …」 줄로 차례를 말한다(v1 티켓 25 · `askTurn`).
// - **Work와 이어짐**(v1 티켓 30 · §11) — Host의 Work 만들기 제안은 같은 자리 · 같은 차례에 Work 만들기 카드로 선다. 만들어 이어지면
//   머리 줄 이름 앞에 그 Work의 이름(누르면 요약 카드가 열린다 — 02 S13)이 선다.
// - **Agent의 질문**(v1 티켓 26) — 같은 자리 · 같은 차례에 질문 카드로 선다(`QuestionCard`). Thread 도구가 세운 카드(Work 만들기 · Work 밖
//   Project · Service 질문 · Project 추가)도 같은 자리 · 같은 차례에 그 갈래의 카드로 선다(`ToolCardSlot` — 갈래마다의 표는 `ToolCards.tsx`).
// - **로그인 · 설치 안내**(`GuideCard`)는 Thread 본문을 대신한다.
// - **말은 Runtime 이름으로 선다**(`runtimeNameOf`) — 채팅은 Runtime 세션 하나라 흐름과 카드에 얼굴도 이름 줄도 없다. 모델 칩은 채팅의
//   값이다(§14).
// - **물어보는 정도**(v1 티켓 23 · S18) — 입력창 칩 · `/plan` · `/policy`가 고른다. 새 Thread에서는 첫 말과 함께 가고(그 정도로
//   첫 Session이 뜬다 — `?work=`로 열었으면 칩은 그 Work의 지금 정도를 보이고, 다르게 고르면 그 Work의 정도가 바뀐다), 선 Thread에서는
//   곧바로 바꾼다 — 바꾼 것은 흐름의 시스템 줄(「Policy를 … 바꿈」)로 남는다.
// - **요약 카드**(02 구현 스펙 §7 · Screen-Live — v1 Work 카드를 바꿨다, `SummaryCard`) — 판 오른쪽 위에 위 · 오른쪽 8 띄워 떠 있고 높이는
//   내용만큼이다. Work에 이은 Thread는 머리 · 변경 사항 · 결과물 · 소스, 보관된 Work의 Thread는 같은 카드에 「보관됨」, Work 없는 Thread는
//   결과물 · 소스만이다(지워진 Work의 Thread에는 카드도 토글도 없다). 머리 줄의 요약 고정 토글이 여닫고 머리 줄 Work 이름이 열며, 열림은
//   **Thread마다** 기억한다(S22). 카드가 열린 동안 대화 열과 입력창은 카드 왼쪽 끝 16 앞에서 멈추도록 왼쪽으로 비켜나고, 열고 닫을 때
//   패널 박자(220ms 감속)로 미끄러진다(`Beside`). 카드 머리 「…」의 「이 작업공간에서 새 채팅」은 그 Work를 고른 새 Thread(`/?work=`)다.
// - **넓힌 카드**(v1 티켓 35 · §15 배치 1 · Layout-Expand 보드 — 02 §7 「넓힌 카드는 그대로다」) — 요약 카드의 줄 · 대화 속 문서 카드를
//   누르면 카드가 넓어진다. 대화는 왼쪽 480(`size-thread-beside` — 보드 `.p-open .chat{right:calc(100% - 480px)}`)에 남고, 카드가 그
//   오른쪽을 작은 카드와 같은 띄움 8까지 채운다. 넓어지는 동안 사이드바를 접고(적지 않는다 — `showSidebar`) 작은 카드로 돌아오면
//   되돌린다. 넓힌 것은 이 화면의 상태라 다른 Thread로 옮기면 작은 카드다. 카드를 닫으면 넓힌 것도 걷힌다.
// - **움직임**(v1 티켓 43 · Motion 보드) — 화면이 선 뒤에 새로 선 것만 들어서며 움직인다(`ArrivalScope` — Thread를 열 때 이미 있던 줄은
//   그대로다). 입력창 자리의 카드는 아래에서 올라오고(승인 카드), 「맨 아래로」는 아래에서 떠오른다.
//   카드가 넓어지고 접힐 때 대화 폭 · 카드 자리는 사이드바와 같은 패널 박자로 옮겨 간다(`duration-panel` · `ease-panel`).
// - **읽은 자리는 맨 아래가 보일 때 적는다**(v1 티켓 41 · 구현 스펙 §17 · S38) — 열기만 하고 위를 보고 있으면 읽은 것이 아니다. 바닥에
//   붙어 있는 동안 턴이 끝나거나 사람이 바닥까지 굴리면, 읽지 않은 턴 끝이 있을 때만 끝 줄의 seq를 적는다(`readMark`). 사이드바의 「새
//   결과」(줄 오른쪽 끝 파란 점 — 02 티켓 05)가 그것으로 걷힌다.

/**
 * 흐름 · 입력창을 모으는 열 — Codex 대화 열 폭(`size-column` 737, 02 §9)에 가운데로 모인다. 좌우 여백은 바깥 칸이 들어 흐름과 입력창이 같은
 * 폭이다. 문서 · 설정이 읽는 `size-thread`(768)는 그대로다(02 결정 「01 · 공유 토큰은 새 이름으로」).
 */
const COLUMN = "mx-auto flex w-full max-w-(--size-column) flex-col";

/** 이은 Work의 화면으로 가는 길 — 잠긴 Work 칩이 누른다. 사이드바 · ⌘K가 그 Work를 여는 주소와 같다(`recallSearch`). */
function useOpenWork(): (slug: string) => void {
  const navigate = useNavigate();
  return useCallback((slug: string) => void navigate({ to: "/works/$slug", params: { slug }, search: recallSearch(slug) }), [navigate]);
}

/**
 * 새 Thread(`/`). `seed`는 주소가 말하는 처음 것이다 — 시작할 곳(요약 카드 「…」의 「이 작업공간에서 새 채팅」 `/?work=`는 그 Work, 작업공간 만들기
 * `/?new=work`는 「새 작업공간」, `/?new=thread`와 씨앗 없음은 작업공간 없는 채팅)과 범위, 입력 글(`?say=`). 첫 말 전의 이 화면에는 요약 카드도 토글도
 * 없다(02 S23) — 첫 말을 보내 Thread가 서면(`/threads/<id>`) 나타난다.
 */
export function NewThreadScreen({ seed = { link: null, say: null, service: null, project: null } }: { seed?: NewThreadSeed }) {
  const navigate = useNavigate();
  const router = useRouter();
  const openWork = useOpenWork();
  // 어디서 일할지는 주소가 말한다 — 씨앗이 없으면 작업공간 없는 채팅이다. 「새 작업공간」 칩의 ×는 주소를 그냥 새 채팅으로 바꾼다. 화면은 그대로라
  // 고른 범위 · 모드 · 쓴 글이 남는다(`newThreadKey`).
  const link = startLink(seed.link);
  // 입력 글 씨앗(03 §5) — 입력창에 넣는다. 보내지 않는다 — 채운 입력칸이 포커스를 받고, 보내는 것은 사람이다(S16).
  useEffect(() => {
    if (seed.say !== null) fillDraft(NEW_THREAD, seed.say);
  }, [seed.say]);
  const work = link.kind === "work" ? link.slug : null;
  // 주소로 받은 Work는 제목을 쥐지 않고 왔다 — 목록에서 읽는다(없으면 slug).
  const { data: works } = useWorks();
  const linked = works?.find((one) => one.slug === work);
  const title = linked?.title ?? null;
  // 읽을 곳(03 §5 · 티켓 06) — 범위 칩이 고르고 입력창이 쥐었다가 첫 말과 함께 간다. `?work=`로 열었으면 칩은 그 Work의 Service를 보이고,
  // 바꾸면 첫 말을 보낼 때 그 Work에 적는다(S4). 범위 줄은 쥔 것으로 센 범위다.
  const [hold, setHold] = useState(() => holdOf(seed));
  const held = heldScope(link, hold, linked?.service ?? null);
  const { data: reading, isPlaceholderData } = useReadingScope({ work, ...scopeArgs(held) });
  // 칩이 보이는 것은 쥔 것으로 센 범위의 것이다(03 코드 리뷰 P14) — 그것이 사라졌으면 빈 칩이고, 첫 말도 보이는 대로 간다(P6).
  const shown = shownScope(held, reading, !isPlaceholderData);
  const scope: ScopeChoice = {
    shown,
    ofWork: work !== null,
    onPick: (pick) => setHold((now) => holdPick(link, now, pick)),
    reading,
  };
  const [starting, setStarting] = useState<{ text: string; attachments: readonly Attachment[] } | null>(null);
  // 아직 Thread가 없다 — 칩에서 고른 것은 첫 말과 함께 간다. 고르지 않은 칸은 null이다: 정도는 Work 없으면 「편집 자동」, `?work=`면
  // 그 Work의 지금 정도이고(`newThreadLevel`), 모델 · 생각 깊이는 Runtime의 기본값이다.
  const [picks, setPicks] = useState<Omit<StartPicks, "service" | "project">>({ mode: null, model: null, effort: null });
  const workLevel = useWorkMode(work);
  const { shown: level, sent: mode } = newThreadLevel(picks.mode, work, workLevel);
  const engine = useStore(threadEngineStore, (state) => state);
  useEffect(() => checkEngineOnce(), []);
  const guide = guideKind(engine, false);

  const start = async (text: string, attachments: readonly Attachment[]) => {
    setStarting({ text, attachments });
    let id: string;
    try {
      id = await threadApi.start(text, attachments, link, { ...picks, mode, ...startScope(link, hold, shown) });
    } catch (error) {
      setStarting(null);
      throw error;
    }
    // 새 id의 주소로 갈아 선다. Thread 화면(나눠 받는 라우트 청크)이 서기 전에 「새 채팅」 · ⌘N으로 `/`에 다시 오면 이 화면이 그대로
    // 남는다 — 같은 주소의 같은 화면이라 새로 서지 않고, 「시작하는 중」에 멈춘다(02 티켓 13b 「앱의 틈」). 그때는 막 선 화면처럼 비운다.
    void navigate({ to: "/threads/$id", params: { id }, replace: true }).then(() => {
      if (router.state.location.pathname !== "/") return;
      setStarting(null);
      setHold(holdOf(seed));
      setPicks({ mode: null, model: null, effort: null });
    });
  };

  // 첫 말 전의 Work 칩은 씨앗이 세운다 — 씨앗이 없으면 없다. 보낸 뒤에는 잠긴 칩이다.
  const locked: ComposerTray["work"] = { kind: "locked", locked: lockedWork(work, title, link.kind === "new-work"), onOpen: openWork };
  const dropNewWork = () => void navigate({ to: "/", search: withoutNewWork(seed), replace: true });
  const seeded: ComposerTray["work"] = link.kind === "new-work" ? { kind: "new-work", onDrop: dropNewWork } : link.kind === "work" ? locked : undefined;
  const composer = (
    <ThreadComposer
      draftKey={NEW_THREAD}
      models={CLAUDE_MODELS}
      model={picks.model ?? "default"}
      effort={picks.effort}
      onModel={(model) => setPicks((now) => ({ ...now, model }))}
      onEffort={(effort) => setPicks((now) => ({ ...now, effort }))}
      commands={[]}
      running={false}
      busy={starting !== null}
      onSend={start}
      onNewThread={() => {}}
      level={level}
      onLevel={(mode) => setPicks((now) => ({ ...now, mode }))}
      // 트레이는 첫 말 전에 상자 아래에서 범위를 고르고, 씨앗이 있으면 그 앞에 Work 칩이 선다. 보낸 뒤 입력창이 바닥으로 내려가면 Thread 안의
      // 입력창처럼 상자 위에서 잠긴다. 범위 칩은 첫 말 뒤에 서지 않는다.
      tray={starting === null ? { at: "below", work: seeded, scope } : { at: "above", work: locked }}
      placeholder={startPlaceholder(link, title)}
    />
  );
  return (
    <PlainFrame label="새 채팅">
      <ArrivalScope>
        {guide ? (
          <GuidePlace>
            <GuideCard kind={guide} view={engine} />
          </GuidePlace>
        ) : (
          // 첫 화면과 첫 말을 보낸 뒤가 한 틀이다 — 입력창은 같은 자리(둘째 칸)에 남아 갈아 서지 않는다. 그래야 보내기 원이 ↑에서 스피너로
          // 모핑하고(02 §9 · Screen-Live 단계 1) 입력칸이 포커스를 지킨다. 첫 칸만 물음 ↔ 보낸 말로 바뀐다.
          // - 첫 화면: 가운데 묶음 — 물음 아래 28에 입력창 · 트레이다. 아래 210을 비우고 가운데에 선다: F1-Home의 아래 88(`main{padding:0
          //   16px 88px}`)에 짓지 않은 Service 제안 줄의 자리 122(위 22 + 줄 32 × 3 + 사이 2 × 2)를 더한 것이다 — 물음과 입력창이 시안의 그
          //   자리에 선다.
          // - 첫 말을 보낸 뒤: Session이 열려 새 주소로 갈아 서기까지 보낸 말과 「생각 중」이 서고, 입력창은 바닥으로 내려간다.
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              starting === null && "items-center justify-center overflow-y-auto px-4 pb-52.5 scroll-quiet",
            )}
          >
            {starting === null ? (
              <h1 className="mb-7 text-center text-home">무엇을 만들까요?</h1>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 scroll-quiet">
                <div className={`${COLUMN} ${TURN_GAP} text-chat-body`}>
                  <UserMessage text={starting.text} attachments={starting.attachments} />
                  <p className="think-shimmer text-sm">생각 중</p>
                </div>
              </div>
            )}
            <div className={starting === null ? "w-full" : "px-5 pb-4"}>
              <div className={COLUMN}>{composer}</div>
            </div>
          </div>
        )}
      </ArrivalScope>
    </PlainFrame>
  );
}

/** Thread 하나(`/threads/<id>`). */
export function ThreadScreen({ thread }: { thread: string }) {
  const navigate = useNavigate();
  const { data: view, error, isPending } = useThread(thread);
  const rename = useRenameThread();
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => checkEngineOnce(), []);
  const name = view?.title || "채팅";
  const work = view?.work ?? null;
  // 읽기만 된 Thread(v1 티켓 38) — 이름을 바꾸지 못하고, 보관된 Work의 카드는 「보관됨」이며, 지워진 Work에는 카드가 없다.
  const gone = view?.readOnly ?? null;
  const cardWork = gone === "removed" ? null : work;
  // 요약 카드가 서는 Thread(02 §7) — 읽은 Thread면 Work가 없어도 서고, 지워진 Work의 Thread에만 없다. 열림은 Thread마다다(S22).
  const hasCard = view !== undefined && gone !== "removed";
  const [cardOpen, setCardOpen] = useSummaryOpen(hasCard ? thread : null);
  // 넓힌 카드가 연 것(v1 티켓 35) — 없으면 작은 카드다. 보관된 Work · Work 없는 Thread의 카드는 넓어지지 않는다.
  const [opened, setOpened] = useState<Opened | null>(null);
  const expanded = cardWork !== null && gone !== "archived" && cardOpen && opened !== null;
  useFoldSidebar(expanded);
  // 대화 속 문서 카드(스토리 102)가 여는 길 — 이은 Work의 spec 폴더(절대 경로)를 알아야 그 턴이 쓴 문서를 가린다. 보관된 Work는 목록에
  // 없어 카드가 서지 않는다.
  const { data: works } = useWorks();
  const { data: home } = useHomeDir();
  const specDir = works?.find((one) => one.slug === cardWork)?.specDir ?? null;
  const specRoot = specDir !== null && home ? expandHome(specDir, home) : null;
  const docPlace = useMemo(
    () =>
      specRoot === null
        ? null
        : {
            specRoot,
            open: (path: string) => {
              setCardOpen(true);
              setOpened({ kind: "doc", path });
            },
          },
    [specRoot, setCardOpen, setOpened],
  );
  // PR 카드의 「변경 사항 보기」(v1 티켓 36) — 카드를 열고, 그 PR의 Project에서 바뀐 첫 파일을 넓힌 카드에 연다. 변경은 카드의 「변경 사항」과
  // 같은 쿼리에서 읽는다(읽은 답이 있으면 다시 읽지 않는다). 보관된 Work는 카드가 넓어지지 않아 카드만 열린다.
  const queryClient = useQueryClient();
  const showChanges = useCallback(
    (pr: PrLine) => {
      setCardOpen(true);
      if (cardWork === null) return;
      void queryClient
        .ensureQueryData({ queryKey: workChangesKey(cardWork), queryFn: () => worksApi.changes(cardWork) })
        .catch(() => undefined)
        .then((changes) => setOpened(changesOf(pr.project, changes)));
    },
    [cardWork, queryClient, setCardOpen],
  );
  // 머리 줄 이름 앞 — 이은 Work(02 §6)거나, Work 없는 Thread에 Service가 있으면 「흐린 Service /」(03 §10 — 누르면 그 Service 상세).
  const { data: scope } = useReadingScope({ thread });
  const crumb = view ? headService(view.work, scope) : null;
  // 머리 줄 이름의 제자리 바꾸기(두 번 클릭 · F2 · 「…」의 「이름 바꾸기」) — 읽기만 된 Thread는 바꾸지 못한다.
  const renameName =
    view && !gone
      ? {
          editing: renaming,
          onStart: () => setRenaming(true),
          onEnd: () => setRenaming(false),
          onCommit: (title: string) => {
            setProblem(null);
            rename.mutate({ thread, title }, { onError: (failure) => setProblem(String(failure)) });
          },
          label: "채팅 이름",
        }
      : undefined;
  return (
    <PlainFrame
      label={name}
      lead={
        cardWork ? (
          <HeadWork slug={cardWork} archived={gone === "archived"} onOpen={() => setCardOpen(true)} />
        ) : crumb ? (
          <ServiceCrumb name={crumb.name} onOpen={() => void navigate({ to: "/services/$slug", params: { slug: crumb.slug } })} />
        ) : undefined
      }
      title={{ name, rename: renameName }}
      end={
        view ? (
          <>
            <ThreadMenu key={thread} rename={renameName?.onStart ?? null} />
            {hasCard && (
              <SummaryToggle
                open={cardOpen}
                onToggle={() => {
                  if (cardOpen) setOpened(null);
                  setCardOpen(!cardOpen);
                }}
              />
            )}
          </>
        ) : undefined
      }
    >
      {view ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 대화는 판 폭 그대로이고 열 · 입력창이 카드를 비켜난다(`Beside`). 카드가 넓으면 대화는 왼쪽 480에 남는다 — 폭은 두 갈래 모두
              적어 둔다. 폭이 늘 길이라야 넓어지고 접히는 동안 패널 박자로 옮겨 간다. */}
          <div
            className={cn("flex min-h-0 flex-1 flex-col", PANEL_MOTION, "transition-[width] motion-reduce:transition-none")}
            style={{ width: expanded ? THREAD_BESIDE : "100%" }}
          >
            <DocPlace.Provider value={docPlace}>
              <ThreadBody key={thread} view={view} problem={problem} beside={hasCard && cardOpen} onShowChanges={showChanges} />
            </DocPlace.Provider>
          </div>
          {/* 카드 자리 — 위 · 오른쪽 · 아래 8(Screen-Live `top: 8px; right: 8px`). 작은 카드는 그 오른쪽 위에 내용만큼 서고(`items-end`),
              넓어지면 자리가 왼쪽 480까지 자라 카드가 그것을 채운다. 자리 자체는 누름을 받지 않는다 — 카드 밑으로 보이는 흐름이 굴러야
              한다. 카드는 흐름 · 입력창 위에 선다(좁은 창에서 열의 끝을 덮는다). */}
          {hasCard && cardOpen && (
            <div
              className={cn(
                "pointer-events-none absolute top-2 right-2 bottom-2 z-10 flex flex-col items-end",
                PANEL_MOTION,
                "transition-[left] motion-reduce:transition-none",
              )}
              style={{ left: expanded ? THREAD_BESIDE : `calc(100% - ${CARD_ROOM})` }}
            >
              {cardWork === null ? (
                <LooseSummaryCard key={thread} thread={thread} />
              ) : gone === "archived" ? (
                <ArchivedSummaryCard key={thread} slug={cardWork} />
              ) : (
                <WorkSummaryCard
                  key={thread}
                  thread={thread}
                  slug={cardWork}
                  onNewThread={() => void navigate({ to: "/", search: { work: cardWork } })}
                  opened={expanded ? opened : null}
                  onOpen={setOpened}
                  onClose={() => setOpened(null)}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <GuidePlace>
          <p className="text-chat-meta text-fg-tertiary">
            {isPending ? "채팅을 여는 중이에요" : `채팅을 열지 못했어요 — ${String(error)}`}
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

/**
 * 입력창 위 가운데의 원(02 §10 · Screen-Live · Motion 보드 `.cx-dots`) — 32 · 흰 면 · 1px `border-faint`. 「맨 아래로」와 작업 중 점이 같은
 * 원이다.
 */
const SLOT_CIRCLE =
  "col-start-2 flex size-8 shrink-0 items-center justify-center rounded-full border border-border-faint bg-surface text-fg-secondary";

/**
 * 작업 중 점 셋 — 그림이라 숨고, 원이 말한다(「작업 중」 · 「맨 아래로」). 움직임은 `typing-dots`다 — Codex 파도(1s `steps(3)` · +1.2 / −2px ·
 * 점마다 .1s, 02 티켓 12). 점 색은 원의 글자색 2단계(70% — Codex `bg-text/70`)다.
 */
function WorkingDots({ className }: { className?: string }) {
  return (
    <span className={cn("typing-dots", className)} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** 작은 카드 자리의 폭 — 카드 폭 + 오른쪽 띄움 8(Screen-Live `aside{right:8px; width:300px}`). 자리의 왼쪽 끝이 판 오른쪽 끝에서 이만큼이다. */
const CARD_ROOM = "calc(var(--size-summary) + 8px)";

/** 카드가 넓은 동안 대화의 폭이자 넓힌 카드 자리의 왼쪽 끝(보드 `.p-open .chat{right:calc(100% - 480px)}`). */
const THREAD_BESIDE = "var(--size-thread-beside)";

/**
 * 대화 열이 요약 카드를 비켜나는 칸(02 §7 · Screen-Live `.chat{padding-right:324px; transition: padding-right .22s cubic-bezier(.2,0,0,1)}`)
 * — 열(737)은 폭을 그대로 두고, 카드가 열려 있으면 오른쪽 몫(`--size-summary-room` 308)을 비운 남은 자리 가운데로 옮겨 간다. 그래서 열 ·
 * 입력창의 오른쪽 끝이 카드 왼쪽 끝 16 앞에서 멈춘다. 남은 자리가 열보다 좁으면(좁은 창) 열은 판 왼쪽 안쪽 여백(16)까지만 가고 카드가
 * 열의 끝을 덮는다 — 열이 줄지 않는다.
 *
 * 셈은 빈 칸 둘이 든다: 왼쪽 빈 칸(자람 1 · 기본 0)과 오른쪽 빈 칸(자람 1 · 기본 = 몫 · 줄어듦 1) 사이에 열(줄지 않음)이 선다. 남는 자리는
 * 두 빈 칸이 반씩 나눠 열이 남은 자리 가운데에 서고, 모자라면 오른쪽 빈 칸만 줄어 열이 왼쪽 끝에 붙는다. 몫은 오른쪽 빈 칸의 기본
 * 길이(`flex-basis`)라 열고 닫을 때 패널 박자(220ms 감속 — `duration-panel` · `ease-panel`, 02 §12)로 미끄러지고, 동작 줄이기에서는
 * 곧바로 바뀐다.
 */
function Beside({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="flex">
      <span aria-hidden className="min-w-0 flex-1" />
      <div className="flex w-full max-w-(--size-column) shrink-0 flex-col">{children}</div>
      <span
        aria-hidden
        className={cn(
          "min-w-0 grow transition-[flex-basis] duration-panel ease-panel motion-reduce:transition-none",
          open ? "basis-(--size-summary-room)" : "basis-0",
        )}
      />
    </div>
  );
}

/**
 * 카드가 넓은 동안 사이드바를 접는다(§15 배치 1) — 열려 있었을 때만 접고, 작은 카드로 돌아오거나 화면을 떠나면 되돌린다. 넓은 동안 사람이
 * 사이드바를 다시 열었으면 그대로다.
 */
function useFoldSidebar(expanded: boolean) {
  useEffect(() => {
    if (!expanded || !shellStore.state.sidebarOpen) return;
    showSidebar(false);
    return () => showSidebar(true);
  }, [expanded]);
}

/**
 * Thread 본문 — 흐름과 입력창. `onShowChanges`는 PR 카드의 「변경 사항 보기」다(v1 티켓 36) — 넓힌 카드(v1 티켓 35)의 변경으로 간다.
 */
function ThreadBody({
  view,
  problem,
  beside,
  onShowChanges,
}: {
  view: ThreadView;
  problem: string | null;
  /** 요약 카드가 열려 있나 — 흐름 · 입력창의 열이 카드를 비켜난다(`Beside`). */
  beside: boolean;
  onShowChanges: (pr: PrLine) => void;
}) {
  const navigate = useNavigate();
  const thread = view.id;
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread));
  // 다시 켠 뒤면 그 앞의 열린 턴 · 물음은 끝난 것으로 접힌다(`goneThrough`).
  const model: ThreadModel = foldOf(lines, view.live ? null : view.lastSeq);
  const lists = useMemo(() => chipLists(lines), [lines]);
  const change = useChangeChip();
  const setMode = useSetMode();
  const [chipProblem, setChipProblem] = useState<string | null>(null);
  const queue = useQueue(view);
  const engine = useStore(threadEngineStore, (state) => state);
  const guide = guideKind(engine, awaitingLogin(lines));
  const { data: works } = useWorks();
  const linked = view.work ? (works?.find((one) => one.slug === view.work) ?? null) : null;
  // 트레이(03 §5) — 상자 위에 서고 Work 칩은 잠겨 있다. 이은 Work의 제목은 목록에서 읽는다(아직 없으면 slug). 범위는 대화로 바꾼다(스토리 14).
  const openWork = useOpenWork();
  const tray: ComposerTray = {
    at: "above",
    work: { kind: "locked", locked: lockedWork(view.work, linked?.title ?? null, view.newWork === true), onOpen: openWork },
  };

  const last = model.turns[model.turns.length - 1];
  // 알약이 세는 것 — 마지막 턴의 끝난 편집. 도는 동안에도 끝난 편집만큼 선다(Composer 보드 「작업 중 · … · 바뀐 파일」).
  const changes = last ? changedFiles(last) : null;
  const turn = askTurn(model);
  const asking = turn?.current ?? null;
  const askingCwd = asking ? view.cwd : null;
  // 작업 중 점(02 §10 · 스토리 71) — Agent가 일하는 동안 「맨 아래로」 자리의 원 안에 선다. 입력창 자리에 카드가 서서 사람을 기다리면 서지
  // 않는다(Screen-Live 단계 4 — 일은 사람의 답을 기다리며 멎어 있다).
  const working = model.running && asking === null;
  const stopped = last?.end?.stopReason === "cancelled" && last.end.cancelledByUs;

  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  // 맨 아래를 보던 흐름은 끝을 따라간다 — 기록 줄이 늘 때와 흐르는 글이 늘 때(`FollowTail`).
  const follow = useCallback(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(follow, [follow, lines]);

  // 읽은 자리(S38) — 요약이 정본이고(Thread 화면 밖에서도 요약 이벤트가 고친다), 방금 적으러 보낸 자리는 답이 오기 전에도 다시 보내지
  // 않는다. 안내 카드가 본문을 대신하면 흐름이 보이지 않는다.
  const { data: threads } = useThreads();
  const lastRead = Math.max(view.lastRead, threads?.find((one) => one.id === thread)?.lastRead ?? 0);
  const { mutate: markRead } = useMarkRead();
  const marked = useRef(0);
  const read = useCallback(() => {
    const seq = guide || !stuck.current ? null : readMark(lines, Math.max(lastRead, marked.current));
    if (seq === null) return;
    marked.current = seq;
    // 적지 못했으면 다음 기회(새 줄 · 바닥까지 굴림)에 다시 적는다 — 곧바로 다시 보내지 않는다.
    markRead({ thread, seq }, { onError: () => (marked.current = 0) });
  }, [guide, lines, lastRead, markRead, thread]);
  useEffect(read, [read]);

  // 흐름이 부드럽게 내려간다 — 동작 줄이기면 곧바로다(부드러운 굴림은 CSS의 동작 줄이기 갈래가 끄지 못한다).
  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  // PR 카드의 동작(v1 티켓 36) — 「고쳐 달라고 하기」는 이 Thread의 입력창에 맡기는 말을 채운다. 보내는 것은 사람이다.
  const prActions = useMemo<PrActions>(
    // 읽기만인 Thread(v1 티켓 38)에는 채울 입력창이 없다 — 고쳐 달라는 버튼이 서지 않는다.
    () => ({ showChanges: onShowChanges, askFix: view.readOnly ? undefined : (pr) => fillDraft(thread, fixAsk(pr)) }),
    [onShowChanges, thread, view.readOnly],
  );
  // 결과 카드(03 티켓 12)의 「열기」 — 대상이 그사이 사라졌는지는 지금 목록으로 본다(바깥에서 지운 것도 `projects:changed` · `services:changed`가 따라온다).
  const { data: projects } = useProjects();
  const { data: services } = useServices();
  const resultActions = useMemo<ResultActions>(
    () => ({
      listed: (target) => (target === "project" ? projects : services)?.map((one) => one.slug) ?? null,
      open: (to) => void navigate(to),
    }),
    [projects, services, navigate],
  );

  // 카드 맨 아래 「다음 · …」 줄 — 다음 차례가 없으면 비운다(승인 카드 · Work 만들기 카드가 같은 줄을 쓴다).
  const askNext = turn?.next && <AskNext line={nextOf(turn.next)} />;
  // 입력창 자리 카드가 함께 받는 것 — 답할 Thread, 그 채팅의 Runtime 이름, 물음 차례의 표시.
  const runtime = runtimeNameOf(view);
  const slot = asking && {
    thread,
    name: runtime,
    count: turn?.count,
    next: askNext,
  };

  const pickLevel = (mode: AskLevel) => {
    setChipProblem(null);
    setMode.mutate({ thread, mode }, { onError: (failure) => setChipProblem(String(failure)) });
  };

  const chip = (next: ChipChange) => {
    setChipProblem(null);
    change.mutate({ thread, change: next }, { onError: (failure) => setChipProblem(String(failure)) });
  };

  if (guide) {
    return (
      <GuidePlace>
        <GuideCard kind={guide} view={engine} />
      </GuidePlace>
    );
  }
  // 화면이 선 뒤에 새로 선 줄 · 칩 · 카드만 들어서며 움직인다(v1 티켓 43 — `ArrivalScope`). 이 본문은 Thread마다 새로 선다(`key`).
  return (
    <ArrivalScope>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            stuck.current = atBottom;
            setAway(!atBottom);
            if (atBottom) read();
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-4 scroll-quiet"
        >
          <Beside open={beside}>
            <LogPlace.Provider value={view.cwd}>
              <PrPlace.Provider value={prActions}>
                <ResultPlace.Provider value={resultActions}>
                  <FollowTail.Provider value={follow}>
                    <ThreadFlow
                      thread={thread}
                      model={model}
                      runtime={runtime}
                      onRetry={(text, attachments) =>
                        void threadApi.send(thread, text, attachments).catch((failure: unknown) => setChipProblem(String(failure)))
                      }
                    />
                  </FollowTail.Provider>
                </ResultPlace.Provider>
              </PrPlace.Provider>
            </LogPlace.Provider>
          </Beside>
        </div>
        <div className="px-4 pb-4">
          <Beside open={beside}>
            <ThreadComposer
              draftKey={thread}
              // Session을 연 적 없는 채팅(로그인을 기다린다)도 고른다 — 그때의 목록은 claude가 받는 별칭이다(v1 티켓 31).
              models={lists.models ?? CLAUDE_MODELS}
              model={currentModel(lists, view)}
              effort={view.effort}
              onModel={(value) => chip({ field: "model", value })}
              onEffort={(value) => chip({ field: "effort", value })}
              commands={lists.commands}
              running={model.running}
              stopped={stopped}
              onSend={(text, attachments, quote) => {
                stuck.current = true;
                return threadApi.send(thread, text, attachments, quote);
              }}
              onStop={() => threadApi.stop(thread)}
              onNewThread={() => void navigate({ to: "/" })}
              problem={problem ?? chipProblem}
              level={view.askLevel}
              onLevel={pickLevel}
              tray={tray}
              card={
                // 입력창 자리를 잠시 빌리는 카드는 아래에서 올라온다(v1 티켓 43 · Motion 보드 「승인 카드 올라옴」). 다음 물음으로 갈아 서면
                // 새 카드가 올라온다 — 자리의 열쇠가 그 물음이다.
                asking && slot ? (
                  <Arriving key={asking.requestId} motion="card-rise">
                    {asking.card === "question" ? (
                      <QuestionCard {...slot} request={asking} />
                    ) : isToolCardAsk(asking) ? (
                      <ToolCardSlot {...slot} card={asking} />
                    ) : (
                      <ApprovalCard
                        thread={thread}
                        name={slot.name}
                        request={asking}
                        scope={view.work ? "work" : "thread"}
                        cwd={askingCwd}
                        place={placeOf(askingCwd, linked)}
                        count={slot.count}
                        next={slot.next}
                      />
                    )}
                  </Arriving>
                ) : view.readOnly ? (
                  <ReadOnlyNotice
                    gone={view.readOnly}
                    running={model.running}
                    onStop={() => void threadApi.stop(thread).catch((error: unknown) => setChipProblem(String(error)))}
                  />
                ) : null
              }
              above={
                (changes || away || working || queue.length > 0) && (
                  <>
                    {(changes || away || working) && (
                      // 세 칸 — 바뀐 파일 알약은 왼쪽, 「맨 아래로」 · 작업 중 점은 가운데다(Motion 보드 「아래로 버튼」 — v1 티켓 46, 한때 오른쪽
                      // 끝이었다. 작업 중 점은 Codex처럼 그 원 안에 선다 — 02 §10).
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        {changes && last ? (
                          <ChangesPill
                            changes={changes}
                            onReview={() => {
                              toggleTurn(turnKey(thread, last.key), true);
                              stuck.current = false;
                            }}
                          />
                        ) : (
                          <span />
                        )}
                        {away ? (
                          // 위로 굴린 뒤에만 선다 — 화면이 처음 설 때는 바닥이라 늘 움직이며 선다(아래로 버튼). 일하는 동안은 원 안에 점 셋이
                          // 서고, 올려 두거나 포커스가 오면 ↓로 바뀐다(Motion 보드 「작업 중 점」 — Codex).
                          <button
                            type="button"
                            aria-label="맨 아래로"
                            onClick={toBottom}
                            className={cn(SLOT_CIRCLE, "group text-fg-secondary transition-colors jump-in hover:text-fg focus-ring")}
                          >
                            {working && <WorkingDots className="group-hover:hidden group-focus-visible:hidden" />}
                            <ArrowDown
                              className={cn("size-4", working && "hidden group-hover:block group-focus-visible:block")}
                              aria-hidden
                            />
                          </button>
                        ) : (
                          working && (
                            <span role="img" aria-label="작업 중" className={SLOT_CIRCLE}>
                              <WorkingDots />
                            </span>
                          )
                        )}
                      </div>
                    )}
                    <QueuedMessages thread={thread} queue={queue} />
                  </>
                )
              }
            />
          </Beside>
        </div>
      </div>
    </ArrivalScope>
  );
}

