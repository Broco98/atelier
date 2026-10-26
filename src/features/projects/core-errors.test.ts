/// <reference types="node" />
// Rust 소스를 읽어 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankedSources } from "@/blank-comments";
import { CORE_ERRORS, coreError, type CoreErrorKind } from "./core-errors";

// **core 오류 글 ↔ 화면의 갈래 읽기를 맞댄다**(03 코드 리뷰 D5 · 03 결정 10 · 11). 앱 명령은 core 오류를 표시 글로 납작하게 넘기고
// (`src-tauri/src/commands.rs`의 `err()`), 화면은 그 글을 정규식으로 다시 쪼개 사람의 말로 옮긴다(`relocateProblem` · `restoreProblem` ·
// `restoreSpaceProblem`). 두 쪽은 **글자로만** 이어져 있다 — core가 글을 한 글자 고치면 빌드도 타입 검사도 조용하고, 화면은 그날부터 core의
// 영어 글을 그대로 보인다. 그래서 정본(core `#[error("…")]` · 엔진 `HostError`의 `write!`)을 파일에서 읽어 그 틀로 지은 글이 화면의 정규식에
// 그 갈래 · 그 칸으로 걸리는지 잰다. 예로 넣는 값은 일부러 빈칸 · 괄호 · 따옴표 · 한글을 품는다(경로가 그렇다).

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (file: string) => readFileSync(join(root, file), "utf8");
const CORE = "crates/atelier-core/src/lib.rs";
const HOST = "crates/atelier-acp/src/host.rs";

/** core `Error`의 그 갈래가 적은 표시 글의 틀 — `#[error("…")]` 바로 뒤가 그 갈래 이름이다. 못 찾으면 `null`(아래가 빨갛다). */
function coreTemplate(variant: string): string | null {
  return read(CORE).match(new RegExp(`#\\[error\\("([^"]*)"\\)\\]\\s*${variant}\\b`))?.[1] ?? null;
}

/** 엔진 `HostError`의 그 갈래가 쓰는 표시 글의 틀 — `HostError::이름(…) => write!(f, "…")`. Space 되돌리기는 엔진을 지나 이 글로 온다. */
function hostTemplate(variant: string): string | null {
  return read(HOST).match(new RegExp(`HostError::${variant}\\b[^=\\n]*=>\\s*write!\\(f,\\s*"([^"]*)"`))?.[1] ?? null;
}

/** 화면이 읽는 갈래마다 그 정본 — 어느 파일의 어느 갈래인가. */
const SOURCES: Record<CoreErrorKind, { from: "core" | "host"; variant: string }[]> = {
  folderMissing: [{ from: "core", variant: "FolderMissing" }],
  notGitRepo: [{ from: "core", variant: "NotGitRepo" }],
  notRepoRoot: [{ from: "core", variant: "NotRepoRoot" }],
  alreadyRegistered: [{ from: "core", variant: "AlreadyRegistered" }],
  slugReused: [{ from: "core", variant: "SlugReused" }],
  projectNotFound: [{ from: "core", variant: "NotFound" }],
  // core의 글과 엔진의 글이 같아야 한다 — Space 되돌리기의 「없음」은 엔진이 제 갈래로 다시 지어 보낸다(`space_error`).
  spaceNotFound: [
    { from: "core", variant: "SpaceNotFound" },
    { from: "host", variant: "SpaceNotFound" },
  ],
};

/** 틀의 칸(`{0}` · `{path}`)에 넣는 값 — 칸 이름마다 하나. 정규식이 탐욕스럽게 넘치거나 모자라면 칸이 갈려 드러난다. */
const SAMPLE: Record<string, string> = {
  "0": "~/Work Notes/한글 (옛 폴더)",
  path: "~/Developer/web app/packages/ui (v2)",
  root: "~/Developer/web app",
  slug: "api-server's",
};

/** 틀에 값을 넣은 글과, 틀에 칸이 선 차례 그대로의 값들. */
function fill(template: string): { text: string; fields: string[] } {
  const fields: string[] = [];
  const text = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = SAMPLE[name];
    if (value === undefined) throw new Error(`예가 없는 칸 {${name}} — SAMPLE에 더한다`);
    fields.push(value);
    return value;
  });
  return { text, fields };
}

describe("core 오류 글과 화면의 갈래 읽기", () => {
  const kinds = Object.keys(CORE_ERRORS) as CoreErrorKind[];

  it("화면이 읽는 갈래마다 정본을 찾는다 — 갈래 이름이나 글의 꼴이 바뀌면 여기서 빨갛다", () => {
    expect(Object.keys(SOURCES).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      for (const source of SOURCES[kind]) {
        const template = source.from === "core" ? coreTemplate(source.variant) : hostTemplate(source.variant);
        expect(template, `${source.from} ${source.variant}`).not.toBeNull();
      }
    }
  });

  it("정본의 틀로 지은 글이 그 갈래 · 그 칸으로 걸린다", () => {
    for (const kind of kinds) {
      for (const source of SOURCES[kind]) {
        const template = (source.from === "core" ? coreTemplate(source.variant) : hostTemplate(source.variant))!;
        const { text, fields } = fill(template);
        expect(coreError(text), `${source.from} ${source.variant}: ${text}`).toEqual({ kind, fields });
      }
    }
  });

  it("다른 갈래의 글 · 모르는 글은 갈래가 아니다", () => {
    // 앵커: 정본에 있지만 화면이 읽지 않는 갈래(기준 브랜치 · 이미 있음)와 감싼 글(앞에 다른 말이 붙은 것)은 걸리지 않는다.
    const unread = fill(coreTemplate("BranchNotListed")!).text;
    expect(coreError(unread)).toBeNull();
    expect(coreError(fill(coreTemplate("AlreadyExists")!).text)).toBeNull();
    expect(coreError(`재설정하지 못했습니다: ${fill(coreTemplate("NotGitRepo")!).text}`)).toBeNull();
    expect(coreError("disk full")).toBeNull();
  });

  // **정규식은 한 곳이다** — 같은 글을 두 화면이 따로 쪼개면(되돌리기 둘의 `slug is in use again`) 한쪽만 고쳐지는 날 갈린다.
  it("core 오류 글을 쪼개는 자리는 이 모듈 하나다", () => {
    const phrases = kinds.map((kind) => CORE_ERRORS[kind].source.replace(/^\^/, "").split(/[(\\]/)[0].trim());
    expect(phrases).toContain("slug is in use again:");
    const found = blankedSources()
      .filter(({ file }) => file !== "src/features/projects/core-errors.ts")
      .flatMap(({ file, text }) => phrases.filter((phrase) => text.includes(phrase)).map((phrase) => `${file}: ${phrase}`));
    expect(found).toEqual([]);
  });
});
