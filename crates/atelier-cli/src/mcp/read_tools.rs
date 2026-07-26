//! 조회 도구 — 읽기 전용, 로컬 파일만 만진다.

use rmcp::tool_router;

use super::AtelierServer;

#[tool_router(router = read_router, vis = "pub")]
impl AtelierServer {}
