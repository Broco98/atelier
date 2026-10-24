import { useId, useState } from "react";
import { Copy, Link as LinkIcon, LogIn, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { chatApi } from "./api";
import { AGENT_LABEL } from "./agents";
import ChatCard from "./ChatCard";
import { checkEngine, type EngineView, type GuideKind } from "./engine-store";
import type { Agent } from "./types";

// 안내 카드(three-axes 티켓 22, three-axes 결정 24 · 30) — 로그인이 안 됐거나 에이전트를 못 찾으면 대화창 자리(기록과 입력창 대신)에 서서
// 까닭과 할 일을 보인다. 모양은 캔버스 보드 「로그인 · 설치 안내 카드」(`Chat.dc.html`)다: 승인 카드와 같은 틀(`ChatCard` — r28 ·
// 입력창 그림자) · 위에 엔진 · 제목 · 명령 · 까닭, 아래 단추 줄은 왼쪽 정렬이고 「다시 확인」만 오른쪽 끝이다.
//
// 이 카드는 명령을 부르기만 한다. 로그인이 끝나 엔진이 「됨」이 되면 카드가 걷히고, 그 대화를 다시 띄우는 것은 호스트다(12).

/** 엔진마다의 로그인 명령 — 호스트가 띄우는 것과 같다(`login.rs`). 「명령 복사」가 터미널에서 직접 로그인하는 길이다(스토리 98). */
const LOGIN_COMMAND: Record<Agent, string> = { claude: "claude auth login", codex: "codex login" };

interface GuideCardProps {
  agent: Agent;
  kind: GuideKind;
  view: EngineView | undefined;
}

function GuideCard({ agent, kind, view }: GuideCardProps) {
  const titleId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const name = AGENT_LABEL[agent];
  const missing = view?.missing ?? [];
  const login = view?.login ?? null;
  const url = login?.state === "running" ? login.url : null;

  // 명령이 거절되면 그 글을 카드 안에 보인다(호스트의 거절은 화면에 보일 글이다).
  const run = (call: () => Promise<unknown>) => {
    setProblem(null);
    return call().catch((error: unknown) => setProblem(String(error)));
  };
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => showToast(done),
      () => showToast("복사하지 못했어요", "rejected"),
    );
  };

  const title =
    kind === "missing"
      ? missing.length > 0
        ? `${missing.map((one) => one.name).join(" · ")}를 찾지 못했어요`
        : `${name}를 띄우는 데 드는 것을 찾지 못했어요`
      : kind === "logging-in"
        ? `${name}에 로그인하는 중이에요`
        : `${name}에 로그인이 안 돼 있어요`;
  // 못 찾음이면 설치 명령(빠진 것마다 한 줄), 로그인이면 그 엔진의 로그인 명령이 「명령 복사」의 값이다.
  const install = kind === "missing" ? missing.map((one) => one.install).join("\n") : "";
  const copyable = kind === "missing" ? install : LOGIN_COMMAND[agent];

  return (
    <ChatCard
      as="section"
      titleId={titleId}
      icon={kind === "missing" ? Terminal : LogIn}
      head={name}
      title={title}
      subject={install}
      reason={reason(kind, url, login)}
      problem={problem}
    >
      <div className="flex flex-wrap items-center gap-2 pb-3 pl-4 pr-3">
        {kind === "logged-out" && (
          <Button
            disabled={starting}
            onClick={() => {
              setStarting(true);
              void run(() => chatApi.startLogin(agent)).finally(() => setStarting(false));
            }}
            className="px-3"
          >
            <LogIn aria-hidden />
            로그인
          </Button>
        )}
        {kind === "logging-in" && (
          <Button variant="ghost" className="px-3" onClick={() => void run(() => chatApi.cancelLogin(agent))}>
            취소
          </Button>
        )}
        {url && (
          <Button variant="ghost" className="px-3" onClick={() => copy(url, "링크를 복사했어요")}>
            <LinkIcon aria-hidden />
            링크 복사
          </Button>
        )}
        {copyable && (
          <Button variant="ghost" className="px-3" onClick={() => copy(copyable, "명령을 복사했어요")}>
            <Copy aria-hidden />
            명령 복사
          </Button>
        )}
        <span className="flex-1" />
        {kind !== "logging-in" && (
          <Button
            variant="outline"
            className="px-3"
            disabled={view?.checking === true}
            onClick={() => void run(() => checkEngine(agent, true))}
          >
            <RefreshCw aria-hidden />
            다시 확인
          </Button>
        )}
      </div>
    </ChatCard>
  );
}

/** 카드의 까닭 줄 — 무엇을 하면 되는지. 로그인 명령이 끝났는데 안 됐으면 그 exit code를 말한다(three-axes 결정 30). */
function reason(kind: GuideKind, url: string | null, login: EngineView["login"]): string {
  if (kind === "missing") return "로그인 셸의 PATH에서 찾아봤어요. 설치한 뒤 「다시 확인」을 눌러 주세요.";
  if (kind === "logging-in") {
    return url
      ? "브라우저에서 로그인을 마쳐 주세요. 브라우저가 열리지 않았으면 「링크 복사」로 직접 열어요."
      : "브라우저를 여는 중이에요. 로그인을 마치면 저절로 대화로 돌아가요.";
  }
  if (login?.state === "ended" && !login.cancelled) {
    const code = login.exitCode === null ? "" : `(exit code ${login.exitCode})`;
    return `로그인 명령이 끝났지만${code} 아직 로그인되지 않았어요. 다시 「로그인」을 누르거나 「명령 복사」로 터미널에서 해 보세요.`;
  }
  return "「로그인」을 누르면 브라우저가 열려요. 로그인을 마치면 저절로 대화로 돌아가요.";
}

export default GuideCard;
