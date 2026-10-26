import { coreError } from "./core-errors";
import type { GitInfo, ProjectView } from "./types";

// Projects 목록 · 상세의 갈래(03 구현 스펙 §16 · 캔버스 F1-Projects · F1-ProjectDetail · F4-ProjMissing · F4-ProjDetailMissing · F4-ProjBranch ·
// F4-ProjRename · F4-KitProject). 화면(`ProjectsPage` · `ProjectDetail`)이 그리는 글 · 메뉴 · 묶음을 여기서 고른다 — 렌더 없이 L2가 잰다.

/** 목록 줄 ⋯의 항목이 하는 일 — Finder에서 열기 · 경로 복사 · 제거…(제거 창 — 확인 창과 다른 따로 선 창이다, 03 결정 11). */
export type RowAct = "open-folder" | "copy-path" | "remove";

/** ⋯ 메뉴의 한 줄 — `apart`면 앞에 구분선이 선다, `danger`면 빨강이다(시안 `.pi.red`). */
export interface RowMenuItem {
  act: RowAct;
  label: string;
  danger: boolean;
  apart: boolean;
}

/**
 * 목록 줄의 ⋯(스토리 96 · 102) — 「Finder에서 열기 · 경로 복사 · 제거…」. 제거는 메뉴 안에만 있어 실수로 누르지 않는다. 폴더를 찾을 수 없는
 * Project는 「제거…」만 남는다 — 없는 폴더를 Finder에서 열려 하지 않는다(경로를 고치는 길은 줄 끝의 「재설정」이다).
 */
export function rowMenu(project: ProjectView): RowMenuItem[] {
  const remove = { act: "remove", label: "제거…", danger: true } as const;
  if (project.missing) return [{ ...remove, apart: false }];
  return [
    { act: "open-folder", label: "Finder에서 열기", danger: false, apart: false },
    { act: "copy-path", label: "경로 복사", danger: false, apart: false },
    { ...remove, apart: true },
  ];
}

/** 찾기(시안 「Project 찾기」) — 이름 · slug · 경로 가운데 하나라도 그 글을 품으면 남는다(대소문자 무시). 빈 찾기는 모두다. */
export function shownProjects(projects: readonly ProjectView[], query: string): ProjectView[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...projects];
  return projects.filter((project) => [project.name, project.slug, project.path].some((one) => one.toLowerCase().includes(needle)));
}

/** 기준 브랜치 목록의 묶음 하나 — 머리 글과 그 브랜치들. */
export interface BranchGroup {
  label: string;
  branches: string[];
}

/**
 * 기준 브랜치 목록(스토리 119 · 시안 F4-ProjBranch) — 「로컬」, 그리고 원격마다 「원격 — origin」. 원격 브랜치는 원격 이름을 단 그대로라 고르면
 * 그 이름으로 적힌다(S19). 브랜치가 없는 묶음은 서지 않는다(fetch하지 않은 원격). 목록에 있는 것만 고른다 — 직접 적는 칸은 없다.
 */
export function branchGroups(git: GitInfo | null): BranchGroup[] {
  if (!git) return [];
  return [
    { label: "로컬", branches: git.localBranches },
    ...git.remoteBranches.map((remote) => ({ label: `원격 — ${remote.remote}`, branches: remote.branches })),
  ].filter((group) => group.branches.length > 0);
}

/**
 * 기준 브랜치 아래 한 줄(스토리 120 · 125) — 이 값이 무엇을 정하는지. 이 화면에서 방금 바꿨으면 그 뒤의 일(시안 F1-ProjectDetail)을, 폴더를
 * 찾을 수 없으면 왜 꺼졌는지를 말한다.
 */
export function baseNote(project: ProjectView, changed: boolean): string {
  if (project.missing) return "폴더를 찾아야 브랜치를 읽을 수 있어요";
  if (changed) return `바꿨어요 — 새 Work부터 ${project.baseBranch}에서 갈라져요`;
  return "새 Work의 브랜치가 여기서 갈라져요";
}

/** 제목을 고치는 동안 아래 한 줄(스토리 122 · 123) — 파일 이름은 slug라 이름을 바꿔도 그대로다. */
export function renameHint(project: ProjectView): string {
  return `↵ 저장 · esc 취소 — 파일 이름(${project.slug}.md)과 경로는 그대로예요`;
}

/** 폴더를 찾을 수 없는 Project의 상세 위 안내(스토리 124). */
export function missingNotice(project: ProjectView): { title: string; body: string } {
  return {
    title: "Project를 찾을 수 없어요",
    body: `${project.path}에 폴더가 없어요. 옮겼다면 재설정으로 새 위치를 골라 주세요. 이 Project를 쓰는 Work는 고칠 수 없어요.`,
  };
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
