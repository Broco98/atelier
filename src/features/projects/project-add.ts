import type { FolderLook, NewProjectPlace } from "./types";

// Project 추가 창의 갈래(03 구현 스펙 §16 · 캔버스 F1-ProjectAdd · F1-ProjectNew · F4-ProjNoGit · F4-KitProject 「추가 창 — 소스 폴더」). 창이
// 그리는 글 · 단추를 여기서 고른다 — 창(`ProjectAddDialog`)은 이 답을 그리기만 한다. 렌더 없이 L2가 갈래마다 잰다.
//
// - 「이 컴퓨터의 폴더 추가」는 폴더를 고르는 순간 core가 살핀 갈래(`FolderLook`)로 글과 단추가 바뀐다 — 저장소 · git 아님 · 하위 폴더 · 이미
//   추가됨 · 폴더 없음.
// - 「새로 만들기」는 부모 아래 이름 폴더(`NewProjectPlace`)이고, 그 자리에 무엇이 있으면 그 폴더를 추가하는 길로 간다.

/** 「새로 만들기」의 부모 폴더 기본값(03 S18). 「위치 바꾸기」로 고른 것은 앱 설정(`projects.newParent`)에 남고, 고르기 전에는 이것이다. */
export const DEFAULT_NEW_PARENT = "~/MyProjects";

/** 소스 폴더 스위치 — 「이 컴퓨터의 폴더 추가」 · 「새로 만들기」. */
export type AddMode = "folder" | "new";

/** 창이 든 입력 — 스위치 · 이름 칸 · 고른 폴더. */
export interface AddDraft {
  mode: AddMode;
  /** 「Project 이름」 칸. */
  name: string;
  /** 사람이 이름을 쳤나 — 안 쳤으면 이름 칸이 고른 폴더 이름을 따라간다(스토리 106). */
  named: boolean;
  /** 「이 컴퓨터의 폴더 추가」로 고른 폴더. 고르기 전이면 null이다. */
  folder: string | null;
}

/** 안내 상자의 단추가 하는 일 — 뿌리 폴더로 바꾸기 · 그 Project 열기 · 그 폴더 추가(새로 만들기 → 폴더 추가). */
export type NoticeAct = "root" | "open" | "add-folder";

/** 소스 폴더 칸 아래의 안내 상자(시안 `.ntc`) — 경고(노랑)와 알림(파랑) 두 결이다. */
export interface AddNotice {
  tone: "warn" | "info";
  title: string;
  body: string;
  action: { label: string; act: NoticeAct } | null;
}

/** 창의 그림 — 소스 폴더 머리 · 고른 폴더 줄 · 새로 만들 자리 줄 · 안내 상자 · 오른쪽 아래 단추. */
export interface AddView {
  /** 소스 폴더 머리 — 굵은 앞(「이 컴퓨터」 · 「새 폴더」)과 나머지. */
  head: readonly [string, string];
  /** 고른 폴더 줄 — 경로 · 무엇인가 한 줄 · 기준 브랜치(저장소일 때). 고르기 전이면 null이다(「추가」 단추가 선다). */
  picked: { path: string; found: string; branch: string | null } | null;
  /** 새로 만들 자리 줄 — `<부모>/` 뒤에 폴더 이름(이름이 없으면 null — 흐린 「이름」), 아래 한 줄. */
  place: { prefix: string; folder: string | null; note: string } | null;
  notice: AddNotice | null;
  /** 오른쪽 아래 단추 — 추가 · git init 하고 추가 · 만들기. */
  submit: { label: string; enabled: boolean; act: "add" | "init" | "new" };
}

const NEW_NOTE = "빈 git 레포를 만들어요 · 기준 브랜치 main";

/** 경로의 마지막 마디 — 이름 칸을 채우고(스토리 106), 하위 폴더 안내가 저장소 이름을 말한다. */
export function folderName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** 원격 한 줄 — origin의 owner/repo, 없으면 첫 원격 이름, 그것도 없으면 「원격 없음」. */
const remoteLine = (remote: string | null | undefined) => `git 레포 · ${remote ? `원격 ${remote}` : "원격 없음"}`;

function pickedOf(look: FolderLook): NonNullable<AddView["picked"]> {
  switch (look.kind) {
    case "repo":
      return { path: look.path, found: remoteLine(look.git.remoteSlug ?? look.remotes[0]), branch: look.baseBranch };
    case "subfolder":
      return { path: look.path, found: `git 레포의 하위 폴더 · 뿌리 ${look.root}`, branch: look.baseBranch };
    case "notGit":
      return { path: look.path, found: "폴더 · git 저장소 아님", branch: null };
    case "registered":
      return {
        path: look.path,
        found: look.project.git ? remoteLine(look.project.git.remoteSlug) : "폴더 · git 저장소 아님",
        branch: look.project.baseBranch,
      };
    case "missing":
      return { path: look.path, found: "폴더를 찾을 수 없어요", branch: null };
  }
}

function noticeOf(look: FolderLook): AddNotice | null {
  switch (look.kind) {
    case "repo":
      return null;
    case "notGit":
      return {
        tone: "warn",
        title: "git 저장소가 아니에요",
        body: "「git init 하고 추가」를 누르면 이 폴더에 빈 레포를 만들고(기준 브랜치 main) 추가해요. 파일은 그대로예요.",
        action: null,
      };
    case "subfolder":
      return {
        tone: "info",
        title: `${folderName(look.root)} 저장소 안의 폴더예요`,
        body: `뿌리 폴더(${look.root})로 추가할까요? 그대로 두면 이 하위 폴더를 Project로 써요.`,
        action: { label: "뿌리 폴더로 바꾸기", act: "root" },
      };
    case "registered":
      return {
        tone: "info",
        title: `이미 추가된 Project예요 — ${look.project.name}`,
        body: "같은 폴더는 한 번만 추가돼요.",
        action: { label: "열기", act: "open" },
      };
    case "missing":
      return { tone: "warn", title: "폴더를 찾을 수 없어요", body: "지웠거나 옮긴 폴더예요. 다른 폴더를 골라 주세요.", action: null };
  }
}

/**
 * 창의 그림. `look`은 고른 폴더를 살핀 답(아직이면 null), `place`는 새로 만들 자리를 물은 답(아직이면 null), `parent`는 기억한 부모 폴더다
 * (자리를 묻기 전에 그 자리 줄이 선다).
 */
export function addView(draft: AddDraft, look: FolderLook | null, place: NewProjectPlace | null, parent: string): AddView {
  const named = draft.name.trim() !== "";
  if (draft.mode === "new") {
    const base = place?.parent ?? parent;
    const prefix = base.endsWith("/") ? base : `${base}/`;
    const folder = named && place?.path ? folderName(place.path) : null;
    const taken = folder !== null && place?.taken === true;
    return {
      head: ["새 폴더", " 만들기"],
      picked: null,
      place: { prefix, folder, note: taken ? "이 위치에 폴더가 이미 있어요" : NEW_NOTE },
      notice: taken
        ? {
            tone: "warn",
            title: `${place?.path} 폴더가 이미 있어요`,
            body: "새로 만들지 않고 그 폴더를 추가할 수 있어요.",
            action: { label: "그 폴더 추가", act: "add-folder" },
          }
        : null,
      submit: { label: "Project 만들기", enabled: folder !== null && !taken, act: "new" },
    };
  }
  const head = ["이 컴퓨터", "의 폴더 추가"] as const;
  if (draft.folder === null) {
    return { head, picked: null, place: null, notice: null, submit: { label: "Project 추가", enabled: false, act: "add" } };
  }
  if (look === null) {
    return {
      head,
      picked: { path: draft.folder, found: "", branch: null },
      place: null,
      notice: null,
      submit: { label: "Project 추가", enabled: false, act: "add" },
    };
  }
  const init = look.kind === "notGit";
  const addable = look.kind === "repo" || look.kind === "subfolder" || init;
  return {
    head,
    picked: pickedOf(look),
    place: null,
    notice: noticeOf(look),
    submit: { label: init ? "git init 하고 추가" : "Project 추가", enabled: addable && named, act: init ? "init" : "add" },
  };
}

/** 폴더를 골랐다 — 사람이 이름을 치지 않았으면 이름 칸이 그 폴더 이름을 따라간다. */
export function pickFolder(draft: AddDraft, folder: string): AddDraft {
  return { ...draft, folder, name: draft.named ? draft.name : folderName(folder) };
}

/** 고른 폴더를 뺐다(×) — 따라온 이름도 함께 비운다. */
export function unpickFolder(draft: AddDraft): AddDraft {
  return { ...draft, folder: null, name: draft.named ? draft.name : "" };
}

/** 이름 칸을 쳤다 — 다 지우면 다시 폴더 이름을 따라간다(「이름 칸이 비면 폴더 이름」). */
export function typeName(draft: AddDraft, name: string): AddDraft {
  return { ...draft, name, named: name.trim() !== "" };
}

/**
 * 끌어 놓은 경로들 가운데 추가 창이 열 것 — 첫 폴더다(03 S20). 폴더가 아닌 것(파일)은 건너뛰고, 폴더가 하나도 없으면 첫 경로다(창이 「폴더를
 * 찾을 수 없어요」를 말한다). 폴더인지는 core가 안다(`inspect`).
 */
export async function firstFolder(paths: readonly string[], inspect: (path: string) => Promise<FolderLook>): Promise<string | null> {
  for (const path of paths) {
    if ((await inspect(path)).kind !== "missing") return path;
  }
  return paths[0] ?? null;
}
