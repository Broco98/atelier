import { useId, useState } from "react";
import { Copy, LogIn, RefreshCw, Repeat, Terminal } from "lucide-react";
import useGoToShell from "@/components/shell/useGoToShell";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { recheckEngine, type EngineView, type GuideKind } from "./engine-store";
import NoticeCard from "./NoticeCard";
import { RUNTIMES, runtimeNameOf } from "./runtime";
import { loginInTerminal } from "./terminal-login";
import type { Runtime } from "./types";

// 안내 카드(restart 01c-9 · 스토리 37 · 38 · 40 · 스펙 「01c — Codex」 Runtime 없음 · 로그인 필요) — 채팅의 Runtime을 쓸 수 없으면 **입력창
// 자리**에 서서 까닭과 할 일을 보인다. 흐름은 그대로 보이고, 입력창의 말은 스토어에 남아 카드가 걷히면 다시 선다. 카드는 그 Runtime의
// 것이다 — Codex를 쓸 수 없어도 Claude 채팅에는 서지 않는다(`engine-store.ts`).
//
// 단추는 스펙의 표대로다.
// - 「다시 찾기」 · 「다시 확인」 — 로그인 env를 새로 읽어 다시 찾고 로그인을 다시 본다. 되면 카드가 걷히고, 안 되면 까닭 줄이 그 결과로 바뀐다.
// - 「설치 안내」 — 빠진 것의 설치 명령을 복사하고 토스트로 알린다. 복사가 거절되면 거절 토스트다.
// - 「다른 Runtime으로 바꾸기」 — 첫 말 전에만 선다(`onSwitch`). 입력창의 칩이 카드에 가려져 있기 때문이다(스토리 40).
// - 「터미널에서 로그인」 — Terminal에 새 셸을 열어 그 Runtime의 로그인 명령을 친다(`terminal-login.ts`, restart 01c-10). 셸 상한이면 지금의
//   셸 상한 안내가 선다. 앱 안 로그인(로그인 · 취소 · 링크 복사)은 이것 하나로 바뀌었다. 로그인을 마치면 「다시 확인」이 기다리던 채팅을 다시 띄운다.
//
// 모양(Cards 보드 「Runtime 없음」 · Thread 보드 로그인 카드 — 승인 카드의 틀)은 restart 02b-5가 다듬는다. 지금은 안내 카드의 틀(`NoticeCard`)이다.

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
  const [opening, setOpening] = useState(false);
  const goToShell = useGoToShell();
  const name = runtimeNameOf({ runtime });
  const other = RUNTIMES.find((one) => one.value !== runtime);
  const missing = view.missing;

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
      reason={reason(kind, view)}
      problem={problem}
    >
      <div className="flex flex-wrap items-center gap-2 pb-3 pl-4 pr-3">
        {onSwitch && other && (
          <Button variant="ghost" className="px-3" onClick={() => onSwitch(other.value)}>
            <Repeat aria-hidden />
            {other.name}로 바꾸기
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="outline" className="px-3" disabled={view.checking} onClick={() => void recheckEngine(runtime)}>
          <RefreshCw aria-hidden />
          {kind === "missing" ? "다시 찾기" : "다시 확인"}
        </Button>
        {kind === "logged-out" && (
          <Button
            className="px-3"
            disabled={opening}
            onClick={() => {
              setOpening(true);
              void run(() => loginInTerminal(runtime, goToShell)).finally(() => setOpening(false));
            }}
          >
            <Terminal aria-hidden />
            터미널에서 로그인
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
 * 카드의 까닭 줄 — 무엇을 하면 되는지. 「다시 찾기」 · 「다시 확인」이 카드를 걷지 못했으면 그 결과(거절이면 그 글)를 말한다. 로그인은
 * Terminal의 셸에서 하고, 마친 뒤 「다시 확인」이 이 채팅을 잇는다(restart 01c-10 — 시안의 Thread 보드 로그인 카드의 말).
 */
function reason(kind: GuideKind, view: EngineView): string {
  const { again } = view;
  if (again?.refused) return `확인하지 못했어요 — ${again.refused}`;
  if (kind === "missing") {
    return again
      ? "다시 찾아봤지만 아직 없어요. 설치한 터미널과 같은 로그인 셸의 PATH에 있는지 봐 주세요."
      : "로그인 셸의 PATH에서 찾아봤어요. 설치한 뒤 「다시 찾기」를 눌러 주세요. 입력창의 말은 그대로 남아 있어요.";
  }
  if (again) return "다시 확인했지만 아직 로그인되지 않았어요. 터미널에서 로그인을 마친 뒤 「다시 확인」을 눌러 주세요.";
  return "터미널에서 로그인을 마치고 「다시 확인」을 누르면 이 채팅이 그대로 이어져요. 보내려던 말은 입력창에 남아 있어요.";
}

export default GuideCard;
