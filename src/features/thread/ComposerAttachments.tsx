import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { File, FileText, Folder, Image, X, type LucideIcon } from "lucide-react";
import { threadApi } from "./api";
import { Arriving } from "./arrival";
import { addAttachments, attachmentKind, attachmentName, attachmentSize, removeAttachment, type AttachmentKind } from "./attachments";
import type { Attachment } from "./types";

// 첨부의 부품(v1 티켓 06 · 구현 스펙 §14 S30 · restart 02b-2 · 시안 Composer 「첨부 · 언급」 · 「끌어다 놓는 중」 · 캔버스 Messages 보드 「첨부」)
// — 입력창의 칩, 끌어다 놓는 동안을 알리는 상태(입력창이 표시를 두른다 — `ThreadComposer`), 내 말풍선 위의 칩.
//
// - **경로는 Tauri가 준다.** 웹뷰의 HTML5 drop은 파일의 경로를 주지 않는다 — 창의 끌어다 놓기 이벤트(`onDragDropEvent`)의 `paths`를
//   쓴다. `+`는 OS 파일 고르기 창이다(파일 여럿). 폴더는 끌어다 놓아 붙인다.
// - **받은 경로는 엔진이 잰다**(`describe_attachments` — 크기 · 폴더인가). 칩은 그 답으로 서고, 보낼 때 엔진이 같은 판정으로 다시 잰다.
// - 내용은 읽지 않는다 — 그림도 칩(그림 아이콘 · 이름 · 크기)으로만 선다.

const ICONS: Record<AttachmentKind, LucideIcon> = { file: File, image: Image, folder: Folder };
/** 입력창 칩의 글리프 — 파일은 글 줄이 그어진 문서다(시안 Composer `ic-file-text`). */
const COMPOSER_ICONS: Record<AttachmentKind, LucideIcon> = { ...ICONS, file: FileText };

/** 받은 경로를 재서 그 입력창(`key`)의 칩으로 더한다. 거절되면 그 글로 실패한다(칩은 그대로다). */
export async function attachPaths(key: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  addAttachments(key, await threadApi.describeAttachments([...paths]));
}

/** `+` — OS 파일 고르기 창에서 고른 파일들의 경로. 닫으면 빈 목록이다. */
export async function pickFiles(): Promise<string[]> {
  const picked = await open({ multiple: true, directory: false, title: "첨부할 파일" });
  return picked ?? [];
}

/**
 * 창에 파일을 끌고 들어온 동안 참이다 — 놓으면 `onDrop`이 그 경로들로 불린다. `enabled`가 거짓이면(숨은 입력창 · 보내는 중 · 입력창 자리에 카드)
 * 듣지 않는다. 앱 안의 끌기(사이드바 줄 옮기기)는 경로가 없어 이 상태를 켜지 않는다.
 */
export function useAttachmentDrop(enabled: boolean, onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const dropped = useRef(onDrop);
  useEffect(() => {
    dropped.current = onDrop;
  });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let stop: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") setDragging(payload.paths.length > 0);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          if (payload.paths.length > 0) dropped.current(payload.paths);
        }
      })
      .then((unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, [enabled]);
  return enabled && dragging;
}

/**
 * 입력창 안의 칩 줄(시안 Composer 「첨부 · 언급」 `.ra-att`) — 28 높이 · 10 반경 · 옅은 면(`fill-soft`) · 12 `fg-secondary`의 글리프 14 · 이름 · ×12다.
 * 줄은 좌우 4 들어서고 칩 사이는 6이다. 크기는 칩에 서지 않고 가리키면 경로와 함께 보인다. 붙인 칩은 칩으로 나타난다(v1 티켓 43 · Motion 「칩이
 * 들어선다」).
 */
export function ComposerAttachmentChips({ draftKey, attachments }: { draftKey: string; attachments: readonly Attachment[] }) {
  return (
    <ul aria-label="첨부" className="flex flex-wrap gap-1.5 px-1">
      {attachments.map((attached) => {
        const name = attachmentName(attached);
        const size = attachmentSize(attached);
        const Icon = COMPOSER_ICONS[attachmentKind(attached)];
        return (
          <Arriving
            as="li"
            motion="chip-in"
            arrival={`attach:${attached.path}`}
            key={attached.path}
            title={size ? `${attached.path} · ${size}` : attached.path}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-fill-soft pr-0.5 pl-2 text-xs text-fg-secondary"
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{name}</span>
            {/* × — 이름 끝 6에 선 12 글리프다. 누를 자리는 글리프보다 크다(20). */}
            <button
              type="button"
              aria-label={`${name} 빼기`}
              onClick={() => removeAttachment(draftKey, attached.path)}
              className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors hover:text-fg focus-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Arriving>
        );
      })}
    </ul>
  );
}

/** 내 말풍선 위의 칩(보드 `.fchip` — 40 높이 · 떠 있는 면 · 그림 칸 24 · 이름 · 크기). 하나씩 한 줄에, 오른쪽에 붙는다. */
export function SentAttachments({ attachments }: { attachments: readonly Attachment[] }) {
  return (
    <ul aria-label="첨부" className="flex max-w-[78%] flex-col items-end gap-2 self-end">
      {attachments.map((attached) => {
        const size = attachmentSize(attached);
        const Icon = ICONS[attachmentKind(attached)];
        return (
          <li
            key={attached.path}
            title={attached.path}
            className="inline-flex h-10 max-w-full items-center gap-2 rounded-2xl bg-surface pr-3 pl-2.5 text-chat-meta shadow-hairline"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-fill-soft text-fg-secondary">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 truncate">{attachmentName(attached)}</span>
            {size && <span className="shrink-0 text-xs text-fg-tertiary">{size}</span>}
          </li>
        );
      })}
    </ul>
  );
}
