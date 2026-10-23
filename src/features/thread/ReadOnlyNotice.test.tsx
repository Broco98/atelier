import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReadOnlyNotice from "./ReadOnlyNotice";

// 읽기만 된 Thread의 입력창 자리(v1 티켓 38 · §11 「보관」) — 이은 Work가 보관됐거나 지워진 Thread는 입력창 대신 까닭 한 줄이 선다.
// 정적 마크업으로 글 · 보낼 칸이 없음 · 멈추기가 도는 동안만 서는지를 잰다.

const none = () => {};

describe("읽기만 된 Thread의 입력창 자리", () => {
  it("보관된 Work의 Thread는 「보관된 Work의 Thread는 읽기만 돼요」라고 말하고, 쓸 칸도 보낼 버튼도 없다", () => {
    const markup = renderToStaticMarkup(<ReadOnlyNotice gone="archived" running={false} onStop={none} />);
    expect(markup).toContain("보관된 Work의 Thread는 읽기만 돼요");
    expect(markup).toContain('role="status"');
    expect(markup).not.toMatch(/<textarea|<form|<input/);
    expect(markup).not.toContain("보내기");
    expect(markup).not.toContain("멈추기");
  });

  it("지워진 Work의 Thread는 「지워진 Work의 Thread는 읽기만 돼요」다", () => {
    const markup = renderToStaticMarkup(<ReadOnlyNotice gone="removed" running={false} onStop={none} />);
    expect(markup).toContain("지워진 Work의 Thread는 읽기만 돼요");
    expect(markup).not.toContain("보관된");
  });

  it("보관된 때 돌던 턴은 사람이 멈출 수 있다 — 턴이 도는 동안만 「멈추기」가 선다", () => {
    const markup = renderToStaticMarkup(<ReadOnlyNotice gone="archived" running onStop={none} />);
    expect(markup).toMatch(/<button[^>]*>멈추기<\/button>/);
  });
});
