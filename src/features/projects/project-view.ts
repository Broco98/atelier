import { coreError } from "./core-errors";
import type { ProjectView } from "./types";

// Projects 목록 · 상세의 갈래(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail · F4-ProjMissing · F4-ProjDetailMissing · F4-KitProject).
// 화면(`ProjectsPage` · `ProjectDetail`)이 그리는 글 · 메뉴를 여기서 고른다 — 렌더 없이 L2가 잰다. 상세 머리의 ⋯도 목록 줄의 ⋯(`rowMenu`)
// 그대로다(restart 03-15c — 보드 PlaceSheet 표). 한때(03-2) 상세 ⋯에 「이름 바꾸기 · 설명 고치기」가 앞에 섰고 기준 브랜치 목록 · 그 아래 한 줄이 있었다.

/** 목록 줄 ⋯의 항목이 하는 일 — Finder에서 열기 · 경로 복사 · 제거…(제거 창 — 확인 창과 다른 따로 선 창이다, 03 결정 11). */
export type RowAct = "open-folder" | "copy-path" | "remove";

/** ⋯ 메뉴의 한 줄. */
export interface RowMenuItem {
  act: RowAct;
  label: string;
}

/**
 * 목록 줄과 상세 머리의 ⋯(스토리 96 · 102 · 보드 PlaceSheet 「⋯ 메뉴」 · Places `MENUS.projects`) — 「Finder에서 열기 · 경로 복사 · 제거…」. 세 줄이 같은 줄이다 —
 * 한때(캔버스 F1-Projects) 제거가 선 아래 빨강이었다. 제거는 메뉴 안에만 있고 창이 한 번 더 묻는다. 폴더를 찾을 수 없는 Project는 「제거…」만
 * 남는다 — 없는 폴더를 Finder에서 열려 하지 않는다(경로를 고치는 길은 줄 끝의 「재설정」이다).
 */
export function rowMenu(project: ProjectView): RowMenuItem[] {
  const remove = { act: "remove", label: "제거…" } as const;
  if (project.missing) return [remove];
  return [{ act: "open-folder", label: "Finder에서 열기" }, { act: "copy-path", label: "경로 복사" }, remove];
}

/** 찾기(시안 「Project 찾기」) — 이름 · slug · 경로 가운데 하나라도 그 글을 품으면 남는다(대소문자 무시). 빈 찾기는 모두다. */
export function shownProjects(projects: readonly ProjectView[], query: string): ProjectView[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...projects];
  return projects.filter((project) => [project.name, project.slug, project.path].some((one) => one.toLowerCase().includes(needle)));
}

/**
 * 폴더를 찾을 수 없는 Project의 상세 경고(restart 03-2 · 스토리 119 · 보드 PlaceSheet 「폴더를 찾을 수 없는 Project」) — 한 줄이고 끝에 「재설정」이
 * 선다. 경로는 바로 아래 카드가 든다. 한때(03) 「Project를 찾을 수 없어요」 머리와 경로 · 「이 Project를 쓰는 작업공간은 고칠 수 없어요」 두 줄 상자였다.
 */
export function missingNotice(): string {
  return "폴더를 찾을 수 없어요. 옮겼다면 재설정으로 새 경로를 알려 주세요.";
}

/**
 * 재설정이 거절된 까닭(스토리 127) — core의 거절 글(`relocate_project`)을 사람의 말로 옮긴다. 모르는 글(입출력 오류 등)은 그대로 보인다.
 * 거절의 갈래(`FolderMissing` · `NotGitRepo` · `NotRepoRoot` · `AlreadyRegistered`)는 core 글을 읽는 한 곳(`coreError`)이 가른다.
 */
export function relocateProblem(error: string): string {
  const hit = coreError(error);
  if (hit?.kind === "notRepoRoot") return `${hit.fields[1]} 저장소 안의 폴더예요 — 뿌리 폴더를 골라 주세요.`;
  if (hit?.kind === "notGitRepo") return `git 저장소가 아니에요 — ${hit.fields[0]}. git 저장소의 뿌리 폴더를 골라 주세요.`;
  if (hit?.kind === "alreadyRegistered") return `이미 다른 Project(${hit.fields[0]})로 추가된 폴더예요 — ${hit.fields[1]}`;
  if (hit?.kind === "folderMissing") return `폴더를 찾을 수 없어요 — ${hit.fields[0]}`;
  return error;
}
