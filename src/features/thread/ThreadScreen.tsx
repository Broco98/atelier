import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { ArrowDown } from "lucide-react";
import { PANEL_MOTION } from "@/components/shell/panel-layout";
import { Toaster } from "@/components/ui/toast";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { shellStore, showSidebar } from "@/components/shell/shell-store";
import { workChangesKey } from "@/features/files/hooks";
import { useProjects } from "@/features/projects/hooks";
import { worksApi } from "@/features/works/api";
import { expandHome } from "@/features/works/doc-refs";
import { useReadingScope, useServices } from "@/features/services/hooks";
import { useHomeDir, useWorks } from "@/features/works/hooks";
import type { Quote } from "@/features/works/QuotePick";
import type { WorkView } from "@/features/works/types";
import { cn } from "@/lib/utils";
import { withoutNewWork, type NewThreadSeed } from "@/routes/-new-thread-search";
import { newChatDoor, recallSearch } from "@/routes/-work-search";
import ApprovalCard from "./ApprovalCard";
import { ArrivalScope, Arriving } from "./arrival";
import QuestionCard from "./QuestionCard";
import { threadApi } from "./api";
import { placeOf } from "./approval";
import { askTurn, nextOf } from "./asks";
import { AskNext } from "./AskTurnMarks";
import ChangesPill from "./ChangesPill";
import { chipLists, newThreadChips, newThreadLevel, pickRuntime, threadChips, type NewThreadPicks } from "./chips";
import { awaitingLogin, checkEngineOnce, engineOf, guideKind, threadEngineStore } from "./engine-store";
import { foldOf, type ThreadModel } from "./fold";
import type { Opened } from "./expanded";
import GuideCard from "./GuideCard";
import {
  useChangeChip,
  useMarkRead,
  useQueue,
  useReconnect,
  useRenameThread,
  useSetCodexMode,
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
import { DEFAULT_RUNTIME, isRuntime, runtimeNameOf } from "./runtime";
import { atBottom, leavingPlace, type ReadingPlace } from "./reading-place";
import { chatSeat, followTab, rightShown, useRightSeat, workSeat, type BodyTab, type RightMove } from "./right-place";
import { readMark } from "./status";
import ThreadComposer from "./ThreadComposer";
import ThreadFlow, { DocPlace, FollowTail, TURN_GAP, UserMessage, type FlowActions } from "./ThreadFlow";
import { isToolCardAsk } from "./tool-cards";
import { ToolCardSlot } from "./ToolCards";
import { LogPlace } from "./WorkLog";
import { fillDraft, linesOf, NEW_THREAD, threadRecordStore, toggleTurn, turnKey } from "./thread-store";
import type { AskLevel, Attachment, Runtime, ThreadLink, ThreadView } from "./types";
import type { ComposerTray, ModeChoice, ModelChoice, ScopeChoice } from "./ComposerChips";
import { ArchivedSummaryCard, LooseSummaryCard, WorkSummaryCard } from "./SummaryCard";
import { HeadWork, ServiceCrumb, SummaryToggle, ThreadMenu } from "./ThreadHead";
import { headService, heldScope, holdOf, holdPick, scopeArgs, shownScope, startScope, type ScopeHold } from "./service-chip";
import { lockedWork, startLink, startPlaceholder } from "./work-chip";

// Thread 화면(v1 티켓 05 · 구현 스펙 §13 · §14 · 캔버스 Screen-Home · Messages · WorkLog · Composer 보드) — `/`는 새 Thread, `/threads/<id>`는
// 그 Thread다. 앱은 늘 새 Thread로 열린다(S26).
//
// - **틀은 앱 셸 하나다**(크롬 맨 위 머리 줄 · 그 아래 카드 자리 — 02 구현 스펙 §3 · restart 02a-2) — 이 화면은 머리 줄에 놓을 것과
//   본문 카드에 들 것만 건넨다(`PlainFrame`). 새 Thread의 머리 줄은 비어 있다.
// - **머리 줄**(02 구현 스펙 §6 · 캔버스 v35 Screen-Live 머리 줄 · `ThreadHead`) — 왼쪽에 Thread 이름(14/500)이 서고 그 자리에서 바꾼다
//   (두 번 클릭 · F2). Work에 이은 Thread면 이름 앞에 흐린 「폴더 · 작업공간 이름 ›」이 서고, Work 이름을 누르면 카드가 열린다(S13). Work 없는
//   Thread에 Service가 있으면 「흐린 Service /」가 서고 누르면 그 Service 상세다(03 §10 — Service가 없으면 이름만). 이름 바로
//   뒤에 「…」(이 Thread의 대상 메뉴 — 「이름 바꾸기」, S15)가, 오른쪽 끝에 요약 단추(「요약 카드」)가 선다(restart 02a-7 · 시안 MainLoose 창
//   머리 — 한때 「…」도 오른쪽 끝이었다. Work 없는 Thread에도 선다 — 첫 말 전의 새 Thread에는 둘 다 없다, S23). 옛 Work 알약(브랜치)은
//   걷었다(S14). 이 화면은 탭 줄이 없는 채팅 — 작업공간 밖 채팅과 읽기만 되는 채팅 — 의 자리다(restart 02a-4 · 02a-7).
// - **빈 Thread**(02 티켓 10 · 02 구현 스펙 §11 · 캔버스 v35 F1-Home) — 가운데에 「무엇을 만들까요?」(28 · 보통 굵기 · 자간 −0.2) 한 줄, 그
//   아래 28에 입력창과 트레이뿐이다. 시안의 Service 제안 줄은 짓지 않는다(03
//   P3). 칩은 입력창 안에 서고(v1 티켓 31 · 사용자 결정), 첫 말 전에 물어보는 정도 · 모델과 생각 깊이를, 상자 아래 트레이에서 범위를
//   고른다(03 §5). 고른 범위는 입력창이 쥐었다가 첫 말과 함께 간다(`service-chip.ts` — 씨앗 `?service=` · `?project=`가 처음 쥔다). 보드의 부제(「Host가 답합니다. …」)도 걷었다(v1 티켓 46 — 칩이 고른 것을
//   이미 말한다). 어디서 일할지는 주소 씨앗이 정한다(`startLink`) — 씨앗이 없으면 작업공간 없는 채팅이고, `?new=work`는 ×로 뺄 수 있는 「새 작업공간」
//   칩을 세운다. `?work=`는 그 작업공간의 새 채팅 탭으로 간다(restart 02a-8 — 그 탭이 그 Work의 잠긴 칩을 세운다, `WorkNewChat`). 입력 글
//   씨앗(`?say=`)은 입력창에 넣기만 하고 보내는 것은 사람이다. 시작할 곳을 입력창
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
// - **로그인 · 설치 안내**(`GuideCard`, restart 01c-9)는 입력창 자리에 선다 — 흐름은 그대로 보이고, 쓰던 말은 카드가 걷히면 다시 선다. 상태는
//   Runtime마다다. 새 채팅은 고른 Runtime의 것이고 첫 말 전에는 다른 Runtime으로 바꾸는 단추가 선다. 선 채팅은 그 채팅의 Runtime 것이다.
// - **말은 Runtime 이름으로 선다**(`runtimeNameOf`) — 채팅은 Runtime 세션 하나라 흐름과 카드에 얼굴도 이름 줄도 없다. 모델 칩은 채팅의
//   값이다(§14).
// - **물어보는 정도**(v1 티켓 23 · S18) — 입력창 칩 · `/plan` · `/policy`가 고른다. 새 Thread에서는 첫 말과 함께 가고(그 정도로
//   첫 Session이 뜬다 — `?work=`로 열었으면 칩은 그 Work의 지금 정도를 보이고, 다르게 고르면 그 Work의 정도가 바뀐다), 선 Thread에서는
//   곧바로 바꾼다 — 바꾼 것은 흐름의 시스템 줄(「Policy를 … 바꿈」)로 남는다.
// - **요약 카드**(02 구현 스펙 §7 · Screen-Live — v1 Work 카드를 바꿨다, `SummaryCard`) — 판 오른쪽 위에 위 · 오른쪽 8 띄워 떠 있고 높이는
//   내용만큼이다. Work에 이은 Thread는 머리 · 변경 사항 · 결과물 · 소스, 보관된 Work의 Thread는 같은 카드에 「보관됨」, Work 없는 Thread는
//   결과물 · 소스만이다(지워진 Work의 Thread에는 카드도 토글도 없다). 창 머리의 요약 단추(「요약 카드」)가 여닫고 머리 줄 Work 이름이 연다.
//   **열림은 오른쪽 자리의 값이다**(restart 02a-9 · `right-place.ts`) — spec 패널과 한 자리를 나눠 쓰는 값 하나로, 작업공간의 채팅 탭은 작업공간
//   화면이 작업공간마다, 이 화면은 채팅마다 쥔다. 처음 열면 닫혀 있다(SummarySheet 표 첫 줄 — 한때 Thread마다 이 컴퓨터에 적었고 처음엔 열려
//   있었다, S22). 카드가 열린 동안 대화 열과 입력창은 카드 왼쪽 끝 16 앞에서 멈추도록 왼쪽으로 비켜나고, 열고 닫을 때
//   패널 박자(220ms 감속)로 미끄러진다(`Beside`). 카드 머리 「…」의 「이 작업공간에서 새 채팅」은 그 작업공간의 새 채팅 탭이다(restart 02a-8).
//   작업공간의 새 채팅 탭에도 같은 카드와 넓힌 카드가 선다(restart 02a-11 · `WorkNewChat`) — 소스는 그 작업공간의 읽는 범위이고, 문서 인용은
//   그 탭의 입력창으로 간다. 홈의 새 채팅에는 카드도 토글도 없다(02 S23).
// - **넓힌 카드**(v1 티켓 35 · §15 배치 1 · Layout-Expand 보드 — 02 §7 「넓힌 카드는 그대로다」) — 요약 카드의 줄 · 대화 속 문서 카드를
//   누르면 카드가 넓어진다. 대화는 왼쪽 480(`size-thread-beside` — 보드 `.p-open .chat{right:calc(100% - 480px)}`)에 남고, 카드가 그
//   오른쪽을 작은 카드와 같은 띄움 8까지 채운다. 넓어지면 spec 패널이 접히고(오른쪽 자리), 넓어 있는 동안 사이드바를 접고(적지 않는다 —
//   `showSidebar`) 작은 카드로 돌아오면 사이드바만 되돌린다. 넓힌 것도 오른쪽 자리의 값이라 작업공간 화면이 쥔다(restart 02a-9). 카드를
//   닫으면 넓힌 것도 걷힌다. 탭 줄이 없는 채팅(이 화면)에는 넓힌 카드가 없다 — 작은 카드만 쓴다(구현 스펙 「02a — 작업공간 밖 채팅」).
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
 * 새 Thread(`/`). `seed`는 주소가 말하는 처음 것이다 — 시작할 곳(작업공간 만들기 `/?new=work`는 「새 작업공간」, `/?new=thread`와 씨앗 없음은
 * 작업공간 없는 채팅 — `/?work=`는 그 작업공간의 새 채팅 탭으로 간다, restart 02a-8)과 범위, 입력 글(`?say=`). 첫 말 전의 이 화면에는 요약 카드도
 * 토글도 없다(02 S23) — 첫 말을 보내 Thread가 서면(`/threads/<id>`) 나타난다.
 */
export function NewThreadScreen({ seed = { link: null, say: null, service: null, project: null } }: { seed?: NewThreadSeed }) {
  const navigate = useNavigate();
  const router = useRouter();
  // 입력 글 씨앗(03 §5) — 입력창에 넣는다. 보내지 않는다 — 채운 입력칸이 포커스를 받고, 보내는 것은 사람이다(S16).
  useEffect(() => {
    if (seed.say !== null) fillDraft(NEW_THREAD, seed.say);
  }, [seed.say]);
  // 새 id의 주소로 갈아 선다. Thread 화면(나눠 받는 라우트 청크)이 서기 전에 「새 채팅」 · ⌘N으로 `/`에 다시 오면 이 화면이 그대로 남는다 — 같은
  // 주소의 같은 화면이라 새로 서지 않고, 「시작하는 중」에 멈춘다(02 티켓 13b 「앱의 틈」). 그때는 막 선 화면처럼 비운다 — 새 채팅을 새로 세운다.
  const [round, setRound] = useState(0);
  const started = (id: string) =>
    void navigate({ to: "/threads/$id", params: { id }, replace: true }).then(() => {
      if (router.state.location.pathname === "/") setRound((now) => now + 1);
    });
  return (
    <PlainFrame label="새 채팅">
      <ArrivalScope>
        <NewChat
          key={round}
          // 어디서 일할지는 주소가 말한다 — 씨앗이 없으면 작업공간 없는 채팅이다. 「새 작업공간」 칩의 ×는 주소를 그냥 새 채팅으로 바꾼다. 화면은
          // 그대로라 고른 범위 · 모드 · 쓴 글이 남는다(`newThreadKey`).
          link={startLink(seed.link)}
          hold={holdOf(seed)}
          draftKey={NEW_THREAD}
          onStarted={started}
          onDropNewWork={() => void navigate({ to: "/", search: withoutNewWork(seed), replace: true })}
        />
      </ArrivalScope>
    </PlainFrame>
  );
}

/**
 * **작업공간의 새 채팅 탭**(restart 02a-8 · 구현 스펙 「02a — 숨은 탭」) — 작업공간 화면이 새 채팅 탭의 본문 카드에 꽂는다. 홈의 새 채팅과 같은
 * 몸이고 다른 것은 셋이다.
 * - **작업공간은 탭에서 읽는다**(`work` — 그 탭이 선 묶음의 작업공간). 씨앗(`?work=`)이 아니다 — 주소에서 `?work=`를 뗐다.
 * - **글 열쇠가 탭마다다**(`draftKey` — `newChatKey`). 홈은 `NEW_THREAD`를 그대로 쓴다.
 * - **첫 말의 답이 오면 그 탭이 채팅이 된다**(`onStarted` — 작업공간 화면이 그 칸을 채팅 탭으로 바꾼다). 주소로 가지 않는다 — 그 탭이 꺼져 있으면
 *   주소는 그대로이고 사람을 그 탭으로 끌고 오지 않는다.
 *
 * **숨은 새 채팅 탭은 내리지 않는다** — 고른 Runtime · 모델 · 생각 깊이 · 모드 · 범위와 보내는 중인 상태가 이 안의 지역 상태다. 내리면 Codex를
 * 고른 탭이 Claude로 돌아온 채 보내지고 Runtime이 잠긴다. 작업공간 화면이 숨긴 채 둔다.
 *
 * **요약 카드와 넓힌 카드가 선다**(restart 02a-11 · 구현 스펙 「02a — 오른쪽 자리」) — 작업공간 화면이 쥔 오른쪽 자리(`card`)를 채팅 탭 몸처럼
 * 받아 그린다. 숨은 탭은 받지 않는다(`null`). 아직 채팅이 없어 카드는 작업공간의 것이다 — 읽는 범위는 작업공간으로 읽고, 넓힌 카드의 문서
 * 인용은 이 탭의 글 열쇠(`draftKey`)로 붙는다. 터미널에서 만들어 채팅이 없는 작업공간도 첫 말 전에 문서를 읽는다.
 */
export function WorkNewChat({
  work,
  draftKey,
  card,
  onStarted,
}: {
  work: string;
  draftKey: string;
  card: ChatCard | null;
  onStarted: (id: string) => void;
}) {
  const navigate = useNavigate();
  const link = useMemo<ThreadLink>(() => ({ kind: "work", slug: work }), [work]);
  const open = card?.open === true;
  const opened = open ? card.opened : null;
  return (
    <CardRoom
      open={open}
      expanded={opened !== null}
      card={
        card && (
          <WorkSummaryCard
            key={draftKey}
            draftKey={draftKey}
            slug={work}
            // 「이 작업공간에서 새 채팅」 — 그 작업공간의 새 채팅 탭으로 간다(restart 02a-8).
            onNewThread={() => void navigate(newChatDoor(work))}
            opened={opened}
            onOpen={card.onOpen}
            onClose={card.onClose}
          />
        )
      }
    >
      <ArrivalScope>
        <NewChat
          link={link}
          hold={holdOf({ link, service: null, project: null })}
          draftKey={draftKey}
          onStarted={onStarted}
          beside={open}
          toasts={opened === null}
        />
      </ArrivalScope>
    </CardRoom>
  );
}

/**
 * 새 채팅의 몸 — 물음 · 입력창 · 트레이다. 홈(`NewThreadScreen`)과 작업공간의 새 채팅 탭(`WorkNewChat`)이 함께 쓴다. 고른 범위 · 칩 · 보내는 중인
 * 상태가 이 안의 지역 상태다 — 첫 말을 보내면 엔진이 고른 것대로 Thread를 세우고 Session이 열릴 때까지 기다린다(`thread_start`). 새 id가 오면
 * 부르는 쪽에 건넨다(`onStarted`).
 */
function NewChat({
  link,
  hold: seedHold,
  draftKey,
  onStarted,
  onDropNewWork,
  beside = false,
  toasts = true,
}: {
  link: ThreadLink;
  /** 범위 칩이 처음 쥔 것 — 주소 씨앗(`?service=` · `?project=`)이다. */
  hold: ScopeHold;
  /** 입력 중인 글 · 첨부의 열쇠 — 홈은 `NEW_THREAD`, 새 채팅 탭은 탭마다다. */
  draftKey: string;
  onStarted: (id: string) => void;
  /** 「새 작업공간」 칩의 × — `?new=work`로 연 홈만 준다. */
  onDropNewWork?: () => void;
  /** 요약 카드가 열려 있나 — 물음 · 보낸 말 · 입력창의 열이 카드를 비켜난다(`Beside`). 카드는 작업공간의 새 채팅 탭에만 선다(restart 02a-11). */
  beside?: boolean;
  /** 안내 카드의 토스트가 이 몸 아래에 서나 — 넓힌 카드가 서 있으면 그 보기의 토스트 자리가 받는다(`ThreadBody`와 같다). */
  toasts?: boolean;
}) {
  const openWork = useOpenWork();
  const work = link.kind === "work" ? link.slug : null;
  // 주소로 받은 Work는 제목을 쥐지 않고 왔다 — 목록에서 읽는다(없으면 slug).
  const { data: works } = useWorks();
  const linked = works?.find((one) => one.slug === work);
  const title = linked?.title ?? null;
  // 읽을 곳(03 §5 · 티켓 06) — 범위 칩이 고르고 입력창이 쥐었다가 첫 말과 함께 간다. 작업공간의 새 채팅이면 칩은 그 Work의 Service를 보이고,
  // 바꾸면 첫 말을 보낼 때 그 Work에 적는다(S4). 범위 줄은 쥔 것으로 센 범위다.
  const [hold, setHold] = useState(seedHold);
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
  const [starting, setStarting] = useState<{ text: string; attachments: readonly Attachment[]; quote: Quote | null } | null>(null);
  // 아직 Thread가 없다 — 칩에서 고른 것은 첫 말과 함께 간다. 고르지 않은 칸은 null이다: 정도는 Work 없으면 「편집 자동」, 작업공간의 새 채팅이면
  // 그 Work의 지금 정도이고(`newThreadLevel`), 모델 · 생각 깊이는 Runtime의 기본값이다. Runtime(스토리 30)은 새 채팅에서만 고르고 첫 말과 함께 간다 —
  // 첫 말을 보내면 입력창이 칩을 잠근다(스토리 31). Runtime을 바꾸면 고른 모델과 생각 깊이를 비운다(`pickRuntime`).
  const [picks, setPicks] = useState<NewThreadPicks>(NO_PICKS);
  const runtime = picks.runtime;
  const workLevel = useWorkMode(work);
  const { shown: level, sent: mode } = newThreadLevel(picks.mode, work, workLevel, runtime);
  // 칩은 Runtime대로 선다 — 첫 말 전 Codex는 모델 칩 없이 기본 모드만 메뉴 없이 선다(Composer 「첫 말 전 Codex」).
  const chips = newThreadChips(runtime, picks, level);
  // 고른 Runtime을 쓸 수 있나(restart 01c-9 · 스토리 37 · 40) — 고른 순간에 확인한다(앱이 도는 동안 Runtime마다 한 번). 쓸 수 없으면 입력창
  // 자리에 그 Runtime의 카드가 선다. 확인은 최대 20초가 걸리고 그동안 보내기를 잠근다 — 보내면 Runtime이 잠겨 바꾸는 단추가 사라진다.
  const engine = useStore(threadEngineStore, (state) => engineOf(state, runtime));
  useEffect(() => checkEngineOnce(runtime), [runtime]);
  const guide = guideKind(engine, false);
  const pick = (next: Runtime) => setPicks((now) => pickRuntime(now, next));

  // 인용(`quote`)은 작업공간의 새 채팅 탭이 넓힌 카드의 문서에서 붙인 것이다(restart 02a-11) — 첫 말과 함께 간다. 틀리면 엔진이 채팅을 세우지
  // 않고 거절하고, 입력창이 쓰던 글 · 칩을 되돌린다(`sendDraft`).
  const start = async (text: string, attachments: readonly Attachment[], quote: Quote | null) => {
    setStarting({ text, attachments, quote });
    let id: string;
    try {
      id = await threadApi.start(text, attachments, link, { ...picks, mode, ...startScope(link, hold, shown) }, quote);
    } catch (error) {
      setStarting(null);
      throw error;
    }
    onStarted(id);
  };

  // 첫 말 전의 Work 칩은 시작할 곳이 세운다 — 작업공간 없는 채팅이면 없다. 보낸 뒤에는 잠긴 칩이다.
  const locked: ComposerTray["work"] = { kind: "locked", locked: lockedWork(work, title, link.kind === "new-work"), onOpen: openWork };
  const seeded: ComposerTray["work"] =
    link.kind === "new-work" && onDropNewWork ? { kind: "new-work", onDrop: onDropNewWork } : link.kind === "work" ? locked : undefined;
  const composer = (
    <ThreadComposer
      draftKey={draftKey}
      mode={withActions(chips.mode, (mode) => setPicks((now) => ({ ...now, mode })), () => {})}
      model={
        chips.model && {
          ...chips.model,
          runtime,
          onModel: (model) => setPicks((now) => ({ ...now, model })),
          onEffort: (effort) => setPicks((now) => ({ ...now, effort })),
        }
      }
      commands={[]}
      running={false}
      busy={starting !== null}
      checking={engine.checking}
      onSend={start}
      onNewThread={() => {}}
      runtime={{ value: runtime, onPick: pick }}
      card={
        guide && (
          // 첫 말 전에는 다른 Runtime으로 바꾸는 단추가 선다 — 입력창의 칩이 카드에 가려져 있다(스토리 40). 바꾼 Runtime도 쓸 수 없으면 그
          // Runtime의 카드로 갈아 선다. 쓰던 말은 입력창의 것이라 그대로다.
          <Arriving key={`guide-${runtime}-${guide}`} motion="card-rise">
            <GuideCard runtime={runtime} kind={guide} view={engine} onSwitch={starting === null ? pick : undefined} />
          </Arriving>
        )
      }
      // 트레이는 첫 말 전에 상자 아래에서 범위를 고르고, 씨앗이 있으면 그 앞에 Work 칩이 선다. 보낸 뒤 입력창이 바닥으로 내려가면 Thread 안의
      // 입력창처럼 상자 위에서 잠긴다. 범위 칩은 첫 말 뒤에 서지 않는다.
      tray={starting === null ? { at: "below", work: seeded, scope } : { at: "above", work: locked }}
      placeholder={startPlaceholder(link, title)}
    />
  );
  return (
    // 첫 화면과 첫 말을 보낸 뒤가 한 틀이다 — 입력창은 같은 자리(둘째 칸)에 남아 갈아 서지 않는다. 그래야 보내기 원이 ↑에서 스피너로
    // 모핑하고(02 §9 · Screen-Live 단계 1) 입력칸이 포커스를 지킨다. 첫 칸만 물음 ↔ 보낸 말로 바뀐다.
    // - 첫 화면: 가운데 묶음 — 물음 아래 28에 입력창 · 트레이다. 아래 210을 비우고 가운데에 선다: F1-Home의 아래 88(`main{padding:0
    //   16px 88px}`)에 짓지 않은 Service 제안 줄의 자리 122(위 22 + 줄 32 × 3 + 사이 2 × 2)를 더한 것이다 — 물음과 입력창이 시안의 그
    //   자리에 선다.
    // - 첫 말을 보낸 뒤: Session이 열려 그 채팅으로 갈아 서기까지 보낸 말과 「생각 중」이 서고, 입력창은 바닥으로 내려간다.
    // 열은 채팅 본문과 같은 칸(`Beside`)이다 — 요약 카드가 열려 있으면(새 채팅 탭) 물음 · 보낸 말 · 입력창이 함께 카드를 비켜난다.
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        starting === null && "items-center justify-center overflow-y-auto px-4 pb-52.5 scroll-quiet",
      )}
    >
      {starting === null ? (
        <div className="mb-7 w-full">
          <Beside open={beside}>
            <h1 className="text-center text-home">무엇을 만들까요?</h1>
          </Beside>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 scroll-quiet">
          <Beside open={beside}>
            <div className={`flex flex-col ${TURN_GAP} text-chat-body`}>
              <UserMessage text={starting.text} attachments={starting.attachments} quote={starting.quote} />
              <p className="think-shimmer text-sm">생각 중</p>
            </div>
          </Beside>
        </div>
      )}
      <div className={starting === null ? "w-full" : "px-5 pb-4"}>
        <Beside open={beside}>{composer}</Beside>
      </div>
      {/* 안내 카드의 「설치 안내」 · 「터미널에서 로그인」(셸 상한)이 알리는 자리 — 카드가 설 때만 둔다(화면마다 토스트 자리는 하나다, S14). */}
      {guide && toasts && <Toaster />}
    </div>
  );
}

/** 새 채팅의 처음 칩 — Claude Code, 고른 것 없음. */
const NO_PICKS: NewThreadPicks = { runtime: DEFAULT_RUNTIME, mode: null, model: null, effort: null };

/** 모드 칩의 값에 고르기를 붙인다 — 물어보는 정도는 `onLevel`, Codex 모드는 `onPick`이다. */
function withActions(
  mode: ReturnType<typeof threadChips>["mode"],
  onLevel: (level: AskLevel) => void,
  onPick: (mode: string) => void,
): ModeChoice | null {
  if (mode === null) return null;
  return mode.kind === "ask" ? { ...mode, onLevel } : { ...mode, onPick };
}

/** Thread 하나(`/threads/<id>`) — 작업공간 밖 채팅과, 작업공간이 보관되거나 지워져 읽기만 되는 채팅이다(restart 02a-4 — 살아 있는 작업공간의 채팅은 그 작업공간 화면의 채팅 탭에 선다). */
export function ThreadScreen({ thread }: { thread: string }) {
  const navigate = useNavigate();
  const { data: view, error, isPending } = useThread(thread);
  const rename = useRenameThread();
  const [renaming, setRenaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = view?.title || "채팅";
  const { gone, cardWork, hasCard } = cardSeatOf(view);
  // 오른쪽 자리(restart 02a-9) — 탭 줄이 없는 채팅은 그 채팅을 열쇠로 쥔다(`chatSeat`). 처음 열면 비어 있고 창 머리의 「요약 카드」가 연다.
  // 작은 카드만 쓴다 — 작업공간 밖 채팅에는 넓힐 곳이 없고(구현 스펙 「02a — 작업공간 밖 채팅」), 보관된 작업공간의 카드는 보이기만 한다.
  const [seat, move] = useRightSeat(chatSeat(thread), null);
  const card = smallCard(rightShown(seat, false).card, move);
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
          <HeadWork slug={cardWork} archived={gone === "archived"} onOpen={() => move({ kind: "show", place: "summary" })} />
        ) : crumb ? (
          <ServiceCrumb name={crumb.name} onOpen={() => void navigate({ to: "/services/$slug", params: { slug: crumb.slug } })} />
        ) : undefined
      }
      title={{ name, rename: renameName }}
      // ⋯는 제목 바로 뒤다(restart 02a-7 · 시안 MainLoose 창 머리) — 오른쪽 끝에는 요약 단추만 선다.
      menu={view ? <ThreadMenu key={thread} rename={renameName?.onStart ?? null} /> : undefined}
      end={hasCard ? <SummaryToggle open={card.open} onToggle={() => move({ kind: "toggle", place: "summary" })} /> : undefined}
    >
      <ThreadPane thread={thread} view={view} error={error} isPending={isPending} card={card} problem={problem} />
    </PlainFrame>
  );
}

/**
 * **작업공간 화면의 채팅 탭**(restart 02a-4 · 구현 스펙 「02a — 채팅 탭은 새로 짓는다」) — 작업공간 화면이 채팅 탭의 본문 카드에 꽂는다.
 * 머리 없이 본문만 선다: 머리 줄은 작업공간의 것이고, `PlainFrame`의 머리는 셸 머리 줄에 포털해 작업공간의 머리와 겹친다. 이름 바꾸기와
 * 「…」는 탭이 맡는다(02a-5).
 *
 * **오른쪽 자리는 작업공간 화면이 쥐어 건넨다**(restart 02a-9 — `card`, `useWorkRightPlace`) — 요약 단추도 작업공간 화면의 창 머리에 선다. 이
 * 몸은 받은 대로 대화 폭과 카드 자리를 그린다. 02a-4의 임시 단추(탭 몸 오른쪽 위)는 걷었다.
 *
 * **숨은 채팅 탭은 내려간다**(restart 02a-6) — 작업공간 화면은 켜진 채팅 탭 하나만 꽂는다. 기록 구독과 조각 그리기가 함께 멈추고,
 * 기록 · 글 · 첨부 · 인용은 스토어에 있어 남는다. 굴림 자리는 탭이 쥔다 — 돌아오면 쥔 자리(`place`)에서 서고, 내려갈 때 그 자리를
 * 건넨다(`onLeave`).
 */
export function WorkChat({ thread, card, place, onLeave }: { thread: string; card: ChatCard } & ChatPlace) {
  const { data: view, error, isPending } = useThread(thread);
  return (
    <ThreadPane
      thread={thread}
      view={view}
      error={error}
      isPending={isPending}
      card={card}
      problem={null}
      place={place}
      onLeave={onLeave}
    />
  );
}

/**
 * 채팅 본문이 받는 **오른쪽 자리**(restart 02a-9 · `right-place.ts`) — 요약 카드가 섰나, 넓힌 카드가 연 것, 그리고 넓히는 길들. 값의 주인은 부르는
 * 쪽이다: 작업공간의 채팅 탭은 작업공간 화면(`useWorkRightPlace`), `/threads/:id`의 채팅은 채팅 화면(`smallCard`)이다.
 */
export interface ChatCard {
  /** 요약 카드가 서 있나 — 오른쪽 자리가 `summary`다. */
  open: boolean;
  /** 넓힌 카드가 연 것 — 넓힐 수 있는 자리에서 넓어져 있을 때만 있다. */
  opened: Opened | null;
  /** 대화 속 문서 카드의 자리(스토리 102) — 그 작업공간의 spec 폴더와 문서를 넓힌 카드에서 여는 길. 넓힐 수 없는 자리는 `null`이라 카드가 서지 않는다. */
  docPlace: { specRoot: string; open: (path: string) => void } | null;
  /** PR 카드의 「변경 사항 보기」(v1 티켓 36). */
  onShowChanges: (pr: PrLine) => void;
  /** 카드의 줄 · 트리 · 문서 링크가 파일을 열었다 — 카드가 넓어져(이미 넓으면 그대로) 그것을 본다. */
  onOpen: (target: Opened) => void;
  /** 넓힌 카드의 × — 작은 카드로 돌아온다. */
  onClose: () => void;
}

/**
 * 작은 카드만 쓰는 자리의 오른쪽 자리 — `/threads/:id`의 채팅(작업공간 밖 · 보관된 작업공간)이다. 넓히는 길(PR의 「변경 사항 보기」 · 카드의 줄)은
 * 작은 카드를 열 뿐이고 대화의 문서 카드는 서지 않는다 — 열 곳이 없다(구현 스펙 「02a — 작업공간 밖 채팅」).
 */
function smallCard(open: boolean, move: (move: RightMove) => void): ChatCard {
  const show = () => move({ kind: "show", place: "summary" });
  return { open, opened: null, docPlace: null, onShowChanges: show, onOpen: show, onClose: () => move({ kind: "collapse" }) };
}

/**
 * **작업공간 화면의 오른쪽 자리**(restart 02a-9 · 구현 스펙 「02a — 오른쪽 자리」) — 그 작업공간의 값(`workSeat`)과 그것을 읽는 것 한 묶음이다:
 * spec 패널 열림 · 요약 카드 열림 · 넓힌 카드 · 넓은 동안 사이드바 접기, 그리고 채팅 탭 몸에 건넬 것(`card` — 대화의 문서 카드와 PR의 「변경
 * 사항 보기」가 넓히는 길). 작업공간 화면이 부르고 채팅 탭 몸(`WorkChat`) · 켜진 새 채팅 탭 몸(`WorkNewChat` — restart 02a-11)은 받은 대로
 * 그린다. 한때 이 묶음이 채팅 화면의 지역 상태였다 — spec 패널이 작업공간 화면에 있어 그 화면이 쥐어야 둘이 한 자리를 나눈다.
 *
 * - **처음 값은 spec 패널이다**(SummarySheet 표 첫 줄) — 분할인 채 들어오면 패널이 접혀 있다(`split` — 결정 88).
 * - **넓힌 카드는 카드가 서는 탭(채팅 탭 · 새 채팅 탭)이 본문에 서 있을 때만이다**(`chat`) — 셸 · 파일 탭 · 문서가 본문이면 카드가 없어 넓힌
 *   것도 없고, 접었던 사이드바가 돌아온다.
 * - **본문 탭이 바뀌면 표의 탭 줄대로 값을 바꾼다**(`tab` — restart 02a-10 · `followTab`) — 셸 · 파일 탭 · 문서가 켜지면 요약 카드가 닫히고, 다른
 *   채팅 탭이 켜지면 넓힌 카드가 작은 카드로 돌아온다. 모르는 한 틱(`undefined`)은 세지 않는다.
 */
export function useWorkRightPlace(
  work: WorkView | null,
  { split, chat, tab }: { split: boolean; chat: boolean; tab: BodyTab | undefined },
) {
  const slug = work?.slug ?? null;
  const key = slug === null ? null : workSeat(slug);
  const first = split ? null : "spec";
  const [seat, move] = useRightSeat(key, first);
  useEffect(() => {
    if (key !== null && tab !== undefined) followTab(key, first, tab);
    // 본문 탭이 바뀔 때만 잰다 — 처음 값(`first`)이 분할로 바뀌어도 탭은 그대로다(`useRightSeat`와 같다).
  }, [key, tab]);
  const shown = rightShown(seat, chat);
  useFoldSidebar(shown.opened !== null);
  // 대화 속 문서 카드(스토리 102)가 여는 길 — 그 작업공간의 spec 폴더(절대 경로)를 알아야 그 턴이 쓴 문서를 가린다.
  const { data: home } = useHomeDir();
  const specRoot = work && home ? expandHome(work.specDir, home) : null;
  const docPlace = useMemo(
    () =>
      specRoot === null
        ? null
        : { specRoot, open: (path: string) => move({ kind: "expand", target: { kind: "doc", path } }) },
    [specRoot, move],
  );
  // PR 카드의 「변경 사항 보기」(v1 티켓 36) — 카드를 열고, 그 PR의 Project에서 바뀐 첫 파일을 넓힌 카드에 연다. 변경은 카드의 「변경 사항」과
  // 같은 쿼리에서 읽는다(읽은 답이 있으면 다시 읽지 않는다).
  const queryClient = useQueryClient();
  const showChanges = useCallback(
    (pr: PrLine) => {
      if (slug === null) return;
      move({ kind: "show", place: "summary" });
      void queryClient
        .ensureQueryData({ queryKey: workChangesKey(slug), queryFn: () => worksApi.changes(slug) })
        .catch(() => undefined)
        .then((changes) => move({ kind: "expand", target: changesOf(pr.project, changes) }));
    },
    [slug, queryClient, move],
  );
  const card: ChatCard = {
    open: shown.card,
    opened: shown.opened,
    docPlace,
    onShowChanges: showChanges,
    onOpen: (target) => move({ kind: "expand", target }),
    onClose: () => move({ kind: "collapse" }),
  };
  return { panelOpen: shown.panel, summaryOpen: shown.card, move, card };
}

/**
 * 채팅의 요약 카드가 서는가와 그 카드의 갈래 — 읽기만 된 Thread(v1 티켓 38)는 이름을 바꾸지 못하고, 보관된 Work의 카드는 「보관됨」이며,
 * 지워진 Work에는 카드가 없다. 읽은 Thread면 Work가 없어도 카드가 선다(02 §7).
 */
function cardSeatOf(view: ThreadView | undefined) {
  const gone = view?.readOnly ?? null;
  const cardWork = gone === "removed" ? null : (view?.work ?? null);
  const hasCard = view !== undefined && gone !== "removed";
  return { gone, cardWork, hasCard };
}

/**
 * 채팅 탭이 쥔 굴림 자리(restart 02a-6) — 작업공간의 채팅 탭만 건넨다. `/threads/:id`의 채팅은 탭이 없어 늘 바닥에서 연다.
 */
interface ChatPlace {
  /** 돌아온 탭이 쥐고 있던 자리. 없으면 바닥이다(처음 여는 탭). */
  place?: ReadingPlace | null;
  /** 내려갈 때 그 자리를 건넨다. */
  onLeave?: (place: ReadingPlace) => void;
}

/**
 * 채팅의 본문 — 흐름 · 입력창과 요약 카드 자리다. 채팅 화면(`ThreadScreen`)은 `PlainFrame`의 본문 카드에, 작업공간의 채팅 탭(`WorkChat`)은
 * 작업공간 화면의 탭 본문 카드에 꽂는다. 오른쪽 자리는 받은 것(`card`)이다 — 대화 폭과 카드 자리를 그 값대로 그린다.
 */
function ThreadPane({
  thread,
  view,
  error,
  isPending,
  card,
  problem,
  place,
  onLeave,
}: {
  thread: string;
  view: ThreadView | undefined;
  error: Error | null;
  isPending: boolean;
  card: ChatCard;
  problem: string | null;
} & ChatPlace) {
  const navigate = useNavigate();
  const { gone, cardWork, hasCard } = cardSeatOf(view);
  const cardOpen = hasCard && card.open;
  // 넓힌 카드(v1 티켓 35) — 받은 것이 있고 넓힐 수 있는 카드(이은 Work가 살아 있다)일 때만이다. 보관된 Work · Work 없는 Thread의 카드는
  // 넓어지지 않는다.
  const expanded = cardOpen && card.opened !== null && cardWork !== null && gone !== "archived";
  if (!view) {
    return (
      <GuidePlace>
        <p className="text-chat-meta text-fg-tertiary">
          {isPending ? "채팅을 여는 중이에요" : `채팅을 열지 못했어요 — ${String(error)}`}
        </p>
      </GuidePlace>
    );
  }
  return (
    <CardRoom
      open={cardOpen}
      expanded={expanded}
      card={
        cardWork === null ? (
          <LooseSummaryCard key={thread} thread={thread} />
        ) : gone === "archived" ? (
          <ArchivedSummaryCard key={thread} slug={cardWork} />
        ) : (
          <WorkSummaryCard
            key={thread}
            thread={thread}
            draftKey={thread}
            slug={cardWork}
            // 「이 작업공간에서 새 채팅」 — 그 작업공간의 새 채팅 탭으로 간다(restart 02a-8).
            onNewThread={() => void navigate(newChatDoor(cardWork))}
            opened={expanded ? card.opened : null}
            onOpen={card.onOpen}
            onClose={card.onClose}
          />
        )
      }
    >
      <DocPlace.Provider value={card.docPlace}>
        <ThreadBody
          key={thread}
          view={view}
          problem={problem}
          beside={cardOpen}
          toasts={!expanded}
          onShowChanges={card.onShowChanges}
          place={place}
          onLeave={onLeave}
        />
      </DocPlace.Provider>
    </CardRoom>
  );
}

/**
 * **대화와 오른쪽 자리의 카드**(restart 02a-9 · 02a-11) — 채팅 본문(`ThreadPane`)과 작업공간의 새 채팅 탭(`WorkNewChat`)이 함께 쓰는 자리다.
 * 대화(`children`)는 판 폭 그대로이고 열 · 입력창이 카드를 비켜난다(`Beside` — 대화 쪽이 그린다). 카드가 넓으면 대화는 왼쪽 480
 * (`THREAD_BESIDE`)에 남고 카드가 그 오른쪽을 채운다.
 *
 * 대화는 늘 같은 자리(첫 자식)에 선다 — 카드가 서고 걷혀도 대화가 새로 서지 않는다(새 채팅 탭의 고른 Runtime · 보내는 중 상태가 대화 쪽의
 * 지역 상태다).
 */
function CardRoom({
  open,
  expanded,
  card,
  children,
}: {
  /** 요약 카드가 섰나. */
  open: boolean;
  /** 카드가 넓어져 있나 — 넓힐 수 있는 자리에서 연 것이 있을 때만이다. */
  expanded: boolean;
  card: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 폭은 두 갈래 모두 적어 둔다. 폭이 늘 길이라야 넓어지고 접히는 동안 패널 박자로 옮겨 간다. */}
      <div
        className={cn("flex min-h-0 flex-1 flex-col", PANEL_MOTION, "transition-[width] motion-reduce:transition-none")}
        style={{ width: expanded ? THREAD_BESIDE : "100%" }}
      >
        {children}
      </div>
      {/* 카드 자리 — 위 · 오른쪽 · 아래 8(Screen-Live `top: 8px; right: 8px`). 작은 카드는 그 오른쪽 위에 내용만큼 서고(`items-end`),
          넓어지면 자리가 왼쪽 480까지 자라 카드가 그것을 채운다. 자리 자체는 누름을 받지 않는다 — 카드 밑으로 보이는 흐름이 굴러야
          한다. 카드는 흐름 · 입력창 위에 선다(좁은 창에서 열의 끝을 덮는다). */}
      {open && (
        <div
          className={cn(
            "pointer-events-none absolute top-2 right-2 bottom-2 z-10 flex flex-col items-end",
            PANEL_MOTION,
            "transition-[left] motion-reduce:transition-none",
          )}
          style={{ left: expanded ? THREAD_BESIDE : `calc(100% - ${CARD_ROOM})` }}
        >
          {card}
        </div>
      )}
    </div>
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
 * 카드가 넓은 동안 사이드바를 접는다(§15 배치 1 · SummarySheet 표 「넓힌 카드」 · 「×」) — 열려 있었을 때만 접고, 작은 카드로 돌아오거나 넓힌
 * 카드가 내려가면(채팅이 본문에서 내려감 · 다른 작업공간 · 화면을 떠남) 되돌린다. 넓은 동안 사람이 사이드바를 다시 열었으면 그대로다. 작업공간
 * 화면의 오른쪽 자리가 부른다(`useWorkRightPlace` — restart 02a-9, 한때 채팅 화면의 것이었다).
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
  toasts,
  onShowChanges,
  place,
  onLeave,
}: {
  view: ThreadView;
  problem: string | null;
  /** 요약 카드가 열려 있나 — 흐름 · 입력창의 열이 카드를 비켜난다(`Beside`). */
  beside: boolean;
  /** 안내 카드의 토스트가 이 본문 아래에 서나 — 넓힌 카드가 서 있으면 그 보기의 토스트 자리(`ExpandedViewer`)가 받는다. */
  toasts: boolean;
  onShowChanges: (pr: PrLine) => void;
} & ChatPlace) {
  const navigate = useNavigate();
  const thread = view.id;
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread));
  // 다시 켠 뒤면 그 앞의 열린 턴 · 물음은 끝난 것으로 접힌다(`goneThrough`).
  const model: ThreadModel = foldOf(lines, view.live ? null : view.lastSeq);
  const lists = useMemo(() => chipLists(lines), [lines]);
  const chips = threadChips(view, lists);
  const change = useChangeChip();
  const setMode = useSetMode();
  const setCodexMode = useSetCodexMode();
  const reconnect = useReconnect(thread);
  const [chipProblem, setChipProblem] = useState<string | null>(null);
  const queue = useQueue(view);
  // 그 채팅의 Runtime을 쓸 수 없으면 입력창 자리에 안내 카드가 선다(restart 01c-9) — Runtime마다의 상태라 다른 Runtime의 로그인 끊김은 이 채팅에
  // 카드를 세우지 않는다. 확인은 세션을 열 때 Host가 하고 이벤트로 알린다. 읽기만인 채팅에는 열 세션이 없다.
  const engine = useStore(threadEngineStore, (state) => engineOf(state, view.runtime));
  const guide = view.readOnly ? null : guideKind(engine, awaitingLogin(lines));
  const { data: works } = useWorks();
  const linked = view.work ? (works?.find((one) => one.slug === view.work) ?? null) : null;
  // 트레이(03 §5) — 상자 위에 서고 Work 칩은 잠겨 있다. 이은 Work의 제목은 목록에서 읽는다(아직 없으면 slug). 범위는 대화로 바꾼다(스토리 14).
  const openWork = useOpenWork();
  const tray: ComposerTray = {
    at: "above",
    work: { kind: "locked", locked: lockedWork(view.work, linked?.title ?? null, view.newWork === true), onOpen: openWork },
  };

  const last = model.turns[model.turns.length - 1];
  // 알약이 세는 것 — 마지막 턴의 끝난 편집. 도는 동안에도 끝난 편집만큼 선다(Composer 보드 「작업 중 · … · 바뀐 파일」). 작업공간 밖
  // 채팅에는 서지 않는다 — 열 곳(넓힌 카드)이 없다(restart 02a-7 · 구현 스펙 「02a — 작업공간 밖 채팅」). 대화의 문서 카드도 같은 까닭으로
  // 서지 않는다 — 문서를 가릴 spec 폴더가 없어 `DocPlace`가 비어 있다(`ThreadPane`의 `docPlace`).
  const changes = last && view.work !== null ? changedFiles(last) : null;
  const turn = askTurn(model);
  const asking = turn?.current ?? null;
  const askingCwd = asking ? view.cwd : null;
  // 작업 중 점(02 §10 · 스토리 71) — Agent가 일하는 동안 「맨 아래로」 자리의 원 안에 선다. 입력창 자리에 카드가 서서 사람을 기다리면 서지
  // 않는다(Screen-Live 단계 4 — 일은 사람의 답을 기다리며 멎어 있다).
  const working = model.running && asking === null;
  const stopped = last?.end?.stopReason === "cancelled" && last.end.cancelledByUs;

  const scroller = useRef<HTMLDivElement>(null);
  // 바닥에 붙어 있나 · 위에서 굴린 거리. 돌아온 채팅 탭은 쥐었던 자리에서 선다(restart 02a-6) — 위로 올려 읽던 탭은 바닥을 따라가지
  // 않고 「맨 아래로」가 선 채로 그 자리에 서고, 바닥을 따라가던 탭과 처음 여는 채팅은 바닥이다(그사이 쌓인 줄의 끝).
  const stuck = useRef(place?.kind !== "at");
  const scrolled = useRef(place?.kind === "at" ? place.top : 0);
  const [away, setAway] = useState(place?.kind === "at");
  // 처음 설 때 한 번 그 자리로 굴리고, 내려갈 때(숨은 탭 · 다른 채팅 · 화면을 떠남) 그 자리를 쥔다. 아래 끝 따라가기보다 먼저 돈다 —
  // 위에서 읽던 자리를 바닥으로 끌어 내리지 않게. 줄어든 창에서 그 자리가 바닥에 닿았으면 바닥으로 읽는다. 쥘 자리는 굴릴 때마다 적은
  // 값이다 — 내려가는 순간의 상자를 읽지 않는다.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && place?.kind === "at") {
      el.scrollTop = place.top;
      const bottom = atBottom(el);
      stuck.current = bottom;
      setAway(!bottom);
    }
    return () => onLeave?.(leavingPlace(stuck.current, scrolled.current));
    // 돌아온 순간의 자리만 읽는다 — 선 뒤에 쥔 자리가 바뀌어도 다시 굴리지 않는다. 쥐는 길(`onLeave`)도 처음 받은 것이다 — 이 본문은
    // 채팅마다 새로 서고(`key`) 쥐는 길은 그 채팅의 탭을 그때 찾는다.
  }, []);
  // 맨 아래를 보던 흐름은 끝을 따라간다 — 기록 줄이 늘 때와 흐르는 글이 늘 때(`FollowTail`).
  const follow = useCallback(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(follow, [follow, lines]);

  // 읽은 자리(S38) — 요약이 정본이고(Thread 화면 밖에서도 요약 이벤트가 고친다), 방금 적으러 보낸 자리는 답이 오기 전에도 다시 보내지
  // 않는다. 안내 카드는 입력창 자리에 서므로 흐름은 그대로 보인다.
  const { data: threads } = useThreads();
  const lastRead = Math.max(view.lastRead, threads?.find((one) => one.id === thread)?.lastRead ?? 0);
  const { mutate: markRead } = useMarkRead();
  const marked = useRef(0);
  const read = useCallback(() => {
    const seq = !stuck.current ? null : readMark(lines, Math.max(lastRead, marked.current));
    if (seq === null) return;
    marked.current = seq;
    // 적지 못했으면 다음 기회(새 줄 · 바닥까지 굴림)에 다시 적는다 — 곧바로 다시 보내지 않는다.
    markRead({ thread, seq }, { onError: () => (marked.current = 0) });
  }, [lines, lastRead, markRead, thread]);
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

  // 안내 줄의 단추 — 읽기만인 채팅(v1 티켓 38)에는 채울 입력창도 다시 이을 Session도 없다. 값이 그대로여야 지금의 턴이 다시 그려지지 않는다(`ThreadFlow`의 `TurnView`).
  const { mutate: reopen, isPending: reconnecting, error: reconnectError, variables: reconnectedTurn } = reconnect;
  const lastKey = last?.key;
  const flowActions = useMemo<FlowActions | null>(
    () =>
      view.readOnly
        ? null
        : {
            fill: (text) => fillDraft(thread, text),
            reconnect: () => reopen(lastKey ?? ""),
            reconnecting,
            reconnectFailure: reconnectError && reconnectedTurn === lastKey ? String(reconnectError) : null,
          },
    [view.readOnly, thread, reopen, reconnecting, reconnectError, reconnectedTurn, lastKey],
  );

  const pickLevel = (mode: AskLevel) => {
    setChipProblem(null);
    setMode.mutate({ thread, mode }, { onError: (failure) => setChipProblem(String(failure)) });
  };

  const chip = (next: ChipChange) => {
    setChipProblem(null);
    change.mutate({ thread, change: next }, { onError: (failure) => setChipProblem(String(failure)) });
  };

  const pickCodexMode = (mode: string) => {
    setChipProblem(null);
    setCodexMode.mutate({ thread, mode }, { onError: (failure) => setChipProblem(String(failure)) });
  };
  const modelChoice: ModelChoice | null = chips.model && {
    ...chips.model,
    runtime: view.runtime,
    onModel: (value) => chip({ field: "model", value }),
    onEffort: (value) => chip({ field: "effort", value }),
  };

  // 화면이 선 뒤에 새로 선 줄 · 칩 · 카드만 들어서며 움직인다(v1 티켓 43 — `ArrivalScope`). 이 본문은 Thread마다 새로 선다(`key`).
  return (
    <ArrivalScope>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            const bottom = atBottom(el);
            stuck.current = bottom;
            scrolled.current = el.scrollTop;
            setAway(!bottom);
            if (bottom) read();
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
                      actions={flowActions}
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
              // 칩은 그 채팅의 Runtime대로 선다(`threadChips`) — Claude는 물어보는 정도, Codex는 채팅 파일의 Codex 모드와 Codex가 보낸 목록이다.
              mode={withActions(chips.mode, pickLevel, pickCodexMode)}
              model={modelChoice}
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
              tray={tray}
              // 턴이 시작된 채팅의 Runtime은 잠겨 있다(스토리 31) — 이름만 선다.
              runtime={{ value: view.runtime }}
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
                        runtime={view.runtime}
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
                ) : guide && isRuntime(view.runtime) ? (
                  // 안내 카드도 입력창 자리를 빌린다 — 쓰던 말은 입력창의 것이라 카드가 걷히면 그대로 다시 선다. 턴이 시작된 채팅이라 Runtime을
                  // 바꾸는 단추는 없다(스토리 31).
                  <Arriving key={`guide-${guide}`} motion="card-rise">
                    <GuideCard runtime={view.runtime} kind={guide} view={engine} />
                  </Arriving>
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
        {/* 안내 카드의 「설치 안내」 · 「터미널에서 로그인」(셸 상한)이 알리는 자리 — 카드가 설 때만 둔다(화면마다 토스트 자리는 하나다, S14). */}
        {guide && toasts && <Toaster />}
      </div>
    </ArrivalScope>
  );
}

