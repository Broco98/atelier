mod mcp;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "atelier", version, about = "Atelier MCP 서버")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// MCP 서버 — 인자 없이 실행하면 표준입출력 서버가 뜬다
    Mcp {
        #[command(subcommand)]
        command: Option<McpCmd>,
    },
}

#[derive(Subcommand)]
enum McpCmd {
    /// MCP 호스트에 이 서버를 등록하고 유령 스킬을 정리
    Install,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Mcp { command: None } => mcp::run(),
        Command::Mcp { command: Some(McpCmd::Install) } => mcp::install::run(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
