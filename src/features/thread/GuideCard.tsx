import { useId, useState } from "react";
import { Copy, Link as LinkIcon, LogIn, RefreshCw, Repeat, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { threadApi } from "./api";
import { recheckEngine, type EngineView, type GuideKind } from "./engine-store";
import NoticeCard from "./NoticeCard";
import { RUNTIMES, runtimeNameOf } from "./runtime";
import type { Runtime } from "./types";

// 안내 카드(restart 01c-9 · 스토리 37 · 38 · 40 · 스펙 「01c — Codex」 Runtime 없음 · 로그인 필요) — 채팅의 Runtime을 쓸 수 없으면 **입력창
// 자리**에 서서 까닭과 할 일을 보인다. 흐름은 그대로 보이고, 입력창의 말은 스토어에 남아 카드가 걷히면 다시 선다. 카드는 그 Runtime의
// 것이다 — Codex를 쓸 수 없어도 Claude 채팅에는 서지 않는다(`engine-store.ts`).
//
// 단추는 스펙의 표대로다.
// - 「다시 찾기」 · 「다시 확인」 — 로그인 env를 새로 읽어 다시 찾고 로그인을 다시 본다. 되면 카드가 걷히고, 안 되면 까닭 줄이 그 결과로 바뀐다.
// - 「설치 안내」 — 빠진 것의 설치 명령을 복사하고 토스트로 알린다. 복사가 거절되면 거절 토스트다.
// - 「다른 Runtime으로 바꾸기」 — 첫 말 전에만 선다(`onSwitch`). 입력창의 칩이 카드에 가려져 있기 때문이다(스토리 40).
// - 로그인 단추 · 「명령 복사」는 앞 판의 앱 안 로그인 그대로다 — 「터미널에서 로그인」으로 바꾸는 것은 restart 01c-10이다.
//
// 모양(Cards 보드 「Runtime 없음」 — 승인 카드의 틀)은 restart 02b-5가 다듬는다. 지금은 안내 카드의 틀(`NoticeCard`)이다.

/** 그 Runtime의 로그인 명령 — 엔진이 띄우는 것과 같다(`login.rs`). 「명령 복사」가 터미널에서 직접 로그인하는 길이다. */
const LOGIN_COMMANDS: Readonly<Record<Runtime, string>> = {
  "claude-code": "claude auth login",
  codex: "codex login",
};

interface GuideCardProps {
  /** 카드가 말하는 Runtime — 채팅의 Runtime이거나 새 채팅에서 고른 것이다. */
  runtime: Runtime;
  kind: GuideKind;
  view: EngineView;
  /** 다른 Runtime으로 바꾸기 — 첫 말 전에만 온다. 고른 Runtime이 바뀌고 입력창의 말은 그대로다. */
  onSwitch?: (to: Runtime) => void;
}

/** 글자를 클립보드에 쓰고 토스트로 알린다 — 쓰기가 거절되면 거절 토스트다. */
export function copyWithToast(text: string, done: string): Promise<void> {
  return navigator.clipboard.writeText(text).then(
    () => showToast(done),
    () => showToast("복사하지 못했어요", "rejected"),
  );
}

function GuideCard({ runtime, kind, view, onSwitch }: GuideCardProps) {
  const titleId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const name = runtimeNameOf({ runtime });
  const other = RUNTIMES.find((one) => one.value !== runtime);
  const missing = view.missing;
  const login = view.login;
  const url = login?.state === "running" ? login.url : null;

  // 명령이 거절되면 그 글을 카드 안에 보인다(호스트의 거절은 화면에 보일 글이다).
  const run = (call: () => Promise<unknown>) => {
    setProblem(null);
    return call().catch((error: unknown) => setProblem(String(error)));
  };

  const title =
    kind === "missing"
      ? missing.length > 0
        ? `${missing.map((one) => one.name).join(" · ")}를 찾지 못했어요`
        : `${name}를 띄우는 데 드는 것을 찾지 못했어요`
      : kind === "logging-in"
        ? `${name}에 로그인하는 중이에요`
        : `${name}에 로그인이 안 돼 있어요`;
  // 못 찾음이면 빠진 것마다 설치 명령 한 줄이 「설치 안내」의 값이다.
  const install = kind === "missing" ? missing.map((one) => one.install).join("\n") : "";

  return (
    <NoticeCard
      titleId={titleId}
      icon={kind === "missing" ? Terminal : LogIn}
      head={name}
      title={title}
      subject={install}
      reason={reason(kind, view, url)}
      problem={problem}
    >
      <div className="flex flex-wrap items-center gap-2 pb-3 pl-4 pr-3">
        {onSwitch && other && (
          <Button variant="ghost" className="px-3" onClick={() => onSwitch(other.value)}>
            <Repeat aria-hidden />
            {other.name}로 바꾸기
          </Button>
        )}
        {kind === "logged-out" && (
          <Button
            disabled={starting}
            onClick={() => {
              setStarting(true);
              void run(() => threadApi.startLogin(runtime)).finally(() => setStarting(false));
            }}
            className="px-3"
          >
            <LogIn aria-hidden />
            로그인
          </Button>
        )}
        {kind === "logging-in" && (
          <Button variant="ghost" className="px-3" onClick={() => void run(() => threadApi.cancelLogin(runtime))}>
            취소
          </Button>
        )}
        {url && (
          <Button variant="ghost" className="px-3" onClick={() => void copyWithToast(url, "링크를 복사했어요")}>
            <LinkIcon aria-hidden />
            링크 복사
          </Button>
        )}
        {kind === "logged-out" && (
          <Button variant="ghost" className="px-3" onClick={() => void copyWithToast(LOGIN_COMMANDS[runtime], "명령을 복사했어요")}>
            <Copy aria-hidden />
            명령 복사
          </Button>
        )}
        <span className="flex-1" />
        {kind !== "logging-in" && (
          <Button variant="outline" className="px-3" disabled={view.checking} onClick={() => void recheckEngine(runtime)}>
            <RefreshCw aria-hidden />
            {kind === "missing" ? "다시 찾기" : "다시 확인"}
          </Button>
        )}
        {kind === "missing" && install && (
          <Button className="px-3" onClick={() => void copyWithToast(install, "설치 명령을 복사했어요")}>
            <Copy aria-hidden />
            설치 안내
          </Button>
        )}
      </div>
    </NoticeCard>
  );
}

/**
 * 카드의 까닭 줄 — 무엇을 하면 되는지. 「다시 찾기」 · 「다시 확인」이 카드를 걷지 못했으면 그 결과(거절이면 그 글)를 말하고, 로그인 명령이
 * 끝났는데 안 됐으면 그 exit code를 말한다(three-axes 결정 30).
 */
function reason(kind: GuideKind, view: EngineView, url: string | null): string {
  const { again, login } = view;
  if (again?.refused) return `확인하지 못했어요 — ${again.refused}`;
  if (kind === "missing") {
    return again
      ? "다시 찾아봤지만 아직 없어요. 설치한 터미널과 같은 로그인 셸의 PATH에 있는지 봐 주세요."
      : "로그인 셸의 PATH에서 찾아봤어요. 설치한 뒤 「다시 찾기」를 눌러 주세요. 입력창의 말은 그대로 남아 있어요.";
  }
  if (kind === "logging-in") {
    return url
      ? "브라우저에서 로그인을 마쳐 주세요. 브라우저가 열리지 않았으면 「링크 복사」로 직접 열어요."
      : "브라우저를 여는 중이에요. 로그인을 마치면 저절로 채팅으로 돌아가요.";
  }
  if (again) return "다시 확인했지만 아직 로그인되지 않았어요. 로그인을 마친 뒤 「다시 확인」을 눌러 주세요.";
  if (login?.state === "ended" && !login.cancelled) {
    const code = login.exitCode === null ? "" : `(exit code ${login.exitCode})`;
    return `로그인 명령이 끝났지만${code} 아직 로그인되지 않았어요. 다시 「로그인」을 누르거나 「명령 복사」로 터미널에서 해 보세요.`;
  }
  return "「로그인」을 누르면 브라우저가 열려요. 로그인을 마치면 저절로 채팅으로 돌아가요.";
}

export default GuideCard;
