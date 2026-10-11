import type { Conversation, RecordLine } from "@/features/chat/types";
import type { WorkView } from "@/features/works/types";
import { expect, type Locator, type Page } from "./evidence";
import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend } from "./harness";

// 대화창 L3의 화면 손(three-axes 코드 리뷰) — 작업 화면의 레일 · 작업 패널 · 입력칸 · 대화 탭 위치자와, 대화창을 여는 손 · 알림
// 자리를 세는 손. 대화 spec마다 다시 짓던 것을 여기 한 벌로 둔다: 「레일」 묶음이나 「대화 알림」 자리의 이름이 바뀌면 이 파일만
// 고친다. 기록 자료는 `chat-records.ts`의 몫이다.

/** 레일 — 작업 화면 오른쪽 끝의 칸 묶음. */
export const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
/** 레일 칸 — 탭 줄의 칸과 이름이 갈리도록 레일 묶음 안에서 집는다. */
export const 레일칸 = (page: Page, name: "spec" | "chat" | "info") => 레일(page).getByRole("button", { name, exact: true });
export const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
export const 입력칸 = (page: Page) => 작업패널(page).getByRole("textbox", { name: "보낼 말", exact: true });
export const 대화탭줄 = (page: Page) => 작업패널(page).getByRole("group", { name: "대화 탭", exact: true });
/** 대화 탭 — 이름 버튼. 상태가 있으면 그 이름이 「이름 — 상태」다(스토리 118). */
export const 대화탭 = (page: Page, name: string) => 대화탭줄(page).getByRole("button", { name, exact: true });

/** 대화창을 여는 손의 고를 것들. */
export interface OpenChatOptions {
  /** 연 work — 기본은 고정 표의 둘째 work다. */
  work?: WorkView;
  /** 대화 목록 · 기록 읽기 밖에서 이 시나리오가 덮을 답(`list_works` · `read_spec_file` 따위). */
  answers?: Record<string, unknown>;
  /** 스펙 창에 열 파일 — 주소의 `?file=`로 연다. */
  file?: string;
  /** 대화창이 섰다고 볼 표식 — 기본은 입력칸이다. 답하지 않은 권한 물음까지 읽은 대화는 입력칸 대신 승인 카드가 선다. */
  ready?: (page: Page) => Locator;
}

/**
 * 그 work의 대화창을 연다 — 대화 목록은 `rows`, 기록 읽기는 대화 id마다 `reads`다. 맨 앞 대화가 켜진다. 작업 화면을 연 뒤 레일
 * `chat`을 누르고 `ready`가 설 때까지 기다린다. **기본 5초가 아니다** — 워커의 첫 페이지는 dev 서버가 작업 화면을 처음 변환하는
 * 것을 기다린다.
 */
export async function openWorkChat(
  page: Page,
  rows: readonly Conversation[],
  reads: Readonly<Record<string, readonly RecordLine[]>>,
  { work = WORKS[1], answers = {}, file, ready = 입력칸 }: OpenChatOptions = {},
): Promise<void> {
  await installFixtureBackend(page, {
    ...answers,
    chat_list: answerByArg("work", { [work.slug]: [...rows] }, { otherwise: [] }),
    chat_read_record: answerByArg(
      "conversation",
      Object.fromEntries(Object.entries(reads).map(([id, lines]) => [id, [...lines]])),
    ),
  });
  await page.goto(file ? `/works/${work.slug}?file=${encodeURIComponent(file)}` : `/works/${work.slug}`);
  await 레일칸(page, "chat").click();
  await expect(ready(page)).toBeVisible({ timeout: 20_000 });
}

/** 알림 자리에 새로 선 알림을 센다 — 쏘기 전에 붙인다. 알림은 새 줄로 갈아 끼워 서므로 더해진 요소 수가 알림 수다. */
export async function countAnnouncements(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"][aria-label="대화 알림"]');
    if (!region) throw new Error("대화 알림 자리가 없다");
    const seen: string[] = [];
    (window as unknown as { __CHAT_ANNOUNCED__: string[] }).__CHAT_ANNOUNCED__ = seen;
    new MutationObserver((records) => {
      for (const one of records) {
        for (const node of one.addedNodes) if (node.textContent) seen.push(node.textContent);
      }
    }).observe(region, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => [...(window as unknown as { __CHAT_ANNOUNCED__: string[] }).__CHAT_ANNOUNCED__]);
}
