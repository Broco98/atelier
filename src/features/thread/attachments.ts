import { Store } from "@tanstack/react-store";
import { fileSize } from "@/features/code/file-size";
import type { Attachment } from "./types";

// 입력창 첨부(v1 티켓 06 · 구현 스펙 §14 S30) — `+`로 고르거나 끌어다 놓은 파일 · 폴더가 보내기 전까지 칩으로 쌓이는 자리와, 칩
// (입력창 · 말풍선 위)에 서는 글. 보내면 경로만 엔진에 가고(`thread_send` · `thread_start`의 `attachments`), 엔진이 본문 앞에 경로
// 목록으로 넣는다. 그림도 경로로만 간다 — 내용은 넘기지 않는다.
//
// **쌓인 칩은 입력 중인 글과 같은 열쇠로 산다**(Thread id, 새 Thread는 `NEW_THREAD`) — 다른 Thread로 갔다 와도 남고, 저장하지 않는다.

/** 칩 그림의 갈래 — 그림은 확장자로 가른다(보이기만 다르고 가는 것은 똑같이 경로다). */
export type AttachmentKind = "file" | "image" | "folder";

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|avif)$/i;

/** 이미 있는 경로는 빼고 뒤에 붙인다. 더해진 것이 없으면 `have` 그대로다(스토어가 같은 상태로 남는다). */
export function mergeAttachments(have: readonly Attachment[], incoming: readonly Attachment[]): readonly Attachment[] {
  const seen = new Set(have.map((attached) => attached.path));
  const added = incoming.filter((attached) => {
    if (seen.has(attached.path)) return false;
    seen.add(attached.path);
    return true;
  });
  return added.length === 0 ? have : [...have, ...added];
}

/** 칩의 이름 — 경로의 끝 조각. */
export function attachmentName({ path }: Attachment): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

export function attachmentKind({ path, folder }: Attachment): AttachmentKind {
  if (folder) return "folder";
  return IMAGE.test(path) ? "image" : "file";
}

/** 칩의 크기 글자 — 파일만. 폴더는 `null`이다. */
export function attachmentSize({ size }: Attachment): string | null {
  return size === null ? null : fileSize(size);
}

const NONE: readonly Attachment[] = [];

/** 입력창마다 쌓인 첨부 — 입력 중인 글과 같은 열쇠다. */
export const attachmentStore = new Store<Readonly<Record<string, readonly Attachment[]>>>({});

export const attachmentsOf = (state: Readonly<Record<string, readonly Attachment[]>>, key: string): readonly Attachment[] =>
  state[key] ?? NONE;

export function addAttachments(key: string, incoming: readonly Attachment[]): void {
  attachmentStore.setState((state) => {
    const have = attachmentsOf(state, key);
    const merged = mergeAttachments(have, incoming);
    return merged === have ? state : { ...state, [key]: merged };
  });
}

export function removeAttachment(key: string, path: string): void {
  attachmentStore.setState((state) => ({
    ...state,
    [key]: attachmentsOf(state, key).filter((attached) => attached.path !== path),
  }));
}

/** 다 걷거나(보냈다) 거절된 보내기의 첨부를 돌려놓는다. */
export function setAttachments(key: string, list: readonly Attachment[]): void {
  attachmentStore.setState((state) => ({ ...state, [key]: list }));
}
