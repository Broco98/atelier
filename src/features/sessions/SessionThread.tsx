import { useEffect, useMemo, useRef, useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Square, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import PermissionCard from "./PermissionCard";
import { toLines } from "./conversation";
import {
  useCancelSession,
  useLiveUpdates,
  usePromptSession,
  useSessionReplay,
} from "./hooks";
import type { SessionView } from "./types";

interface SessionThreadProps {
  session: SessionView;
}

function SessionThread({ session }: SessionThreadProps) {
  const live = useLiveUpdates(session.id);
  const { data: replayed = [] } = useSessionReplay(session.id, live.listening);
  const prompt = usePromptSession(session.id);
  const cancel = useCancelSession(session.id);
  const [draft, setDraft] = useState("");
  const foot = useRef<HTMLDivElement>(null);

  // 과거는 언제나 재생이 그리고, 라이브는 **재생분 이후만** 잇는다. 귀를 먼저 열어 둔 탓에
  // 재생에 이미 들어 있는 줄이 라이브로도 왔을 수 있으므로, 그 자리를 보고 잘라낸다.
  const lines = useMemo(
    () =>
      toLines([
        ...replayed,
        ...live.lines.filter((seen) => seen.index >= replayed.length).map((seen) => seen.line),
      ]),
    [replayed, live.lines],
  );

  // 에이전트가 나를 기다리는 중인가. 떠 있지 않은 세션의 답 없는 카드는 이미 지난 일이다.
  const awaiting =
    session.alive && lines.some((line) => line.kind === "permission" && line.answered === null);

  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [lines, prompt.running]);

  const send = async () => {
    const text = draft.trim();
    if (!text || prompt.running) return;
    setDraft("");
    try {
      // 내가 친 말도 기록을 거쳐 이벤트로 돌아온다 — 여기서 미리 그리지 않는다
      await prompt.send(text);
    } catch (e) {
      await message(`보내지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  const stop = async () => {
    try {
      // 턴은 여기서가 아니라 저쪽에서 끝난다 — 잠금이 풀리는 것은 `prompt.send`가 돌아올 때다
      await cancel.mutateAsync();
    } catch (e) {
      await message(`중단하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          {lines.length === 0 && (
            <p className="py-10 text-center text-[13.5px] text-tertiary">
              무엇을 시킬지 적어 보내면 응답이 흘러나와요.
            </p>
          )}
          {lines.map((line, at) =>
            line.kind === "permission" ? (
              <PermissionCard
                key={at}
                card={line}
                sessionId={session.id}
                alive={session.alive}
              />
            ) : line.kind === "tool" ? (
              <span
                key={at}
                className="flex items-center gap-2 font-mono text-[12px] text-tertiary"
              >
                <Wrench className="size-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 truncate">{line.text}</span>
              </span>
            ) : line.kind === "failed" ? (
              <span
                key={at}
                className="rounded-[10px] bg-red-500/10 px-3 py-2 text-[12.5px] leading-[1.6] text-red-600"
              >
                {line.text}
              </span>
            ) : (
              <div
                key={at}
                className={cn(
                  "whitespace-pre-wrap text-[14px] leading-[1.7]",
                  line.kind === "user"
                    ? "self-end max-w-[85%] rounded-[14px] bg-accent px-3.5 py-2.5"
                    : "text-foreground",
                )}
              >
                {line.text}
              </div>
            ),
          )}
          {prompt.running && (
            <span className="flex items-center gap-2.5">
              <span className="animate-pulse text-[13px] text-tertiary">
                {awaiting ? "답을 기다리는 중…" : "응답 중…"}
              </span>
              {/* 방향이 틀렸다고 판단했을 때 여기서 멈춘다. 세션은 그대로 살아 있다. */}
              <button
                type="button"
                onClick={() => void stop()}
                disabled={cancel.isPending}
                className="flex items-center gap-1.5 rounded-[8px] border px-2 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Square className="size-2.5 shrink-0 fill-current" strokeWidth={2} />
                중단
              </button>
            </span>
          )}
          <div ref={foot} />
        </div>
      </div>

      <div className="shrink-0 border-t px-6 py-3.5">
        <div className="mx-auto flex max-w-[760px] flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            // 턴이 도는 동안에만 잠긴다 — 중간에 끼어들지 않도록.
            // **떠 있지 않다고 잠그지 않는다.** 잠그면 죽은 세션에 이어 말할 길이 사라진다.
            disabled={prompt.running}
            rows={3}
            placeholder={
              session.alive ? "무엇을 시킬까요" : "이어 말하면 다시 띄워요"
            }
            className="w-full resize-none rounded-[12px] border bg-background px-3.5 py-2.5 text-[14px] leading-[1.6] outline-none placeholder:text-tertiary focus:border-primary disabled:opacity-50"
          />
          <span className="text-[11.5px] text-tertiary">
            {!session.alive
              ? "에이전트가 떠 있지 않아요. 보내면 그때 다시 띄워요."
              : awaiting
                ? "에이전트가 위 카드의 답을 기다리고 있어요."
                : prompt.running
                  ? "응답이 끝나면 다시 보낼 수 있어요."
                  : "Enter 로 보내고 Shift+Enter 로 줄을 바꿔요."}
          </span>
        </div>
      </div>
    </div>
  );
}

export default SessionThread;
