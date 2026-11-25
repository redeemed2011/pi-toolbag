mod inbox;
mod message;
mod send;
mod state;

use clap::{Parser, Subcommand};
use state::{BridgeError, Env};
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "dev-agent-bridge", about = "Messages between Sam's dev agents and Engineering Lead (bb-file's Grok Bot).")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Send one message to Engineering Lead's webhook.
    Send {
        #[arg(long, value_parser = ["ask", "reply", "note"])]
        kind: String,
        #[arg(long)]
        topic: String,
        #[arg(long, conflicts_with = "body_file", required_unless_present = "body_file")]
        body: Option<String>,
        /// Read the body from this file, or from stdin with "-".
        #[arg(long)]
        body_file: Option<String>,
        #[arg(long)]
        reply_to: Option<String>,
        #[arg(long)]
        ctx: Vec<String>,
        #[arg(long)]
        commit: Option<String>,
        #[arg(long)]
        file: Option<String>,
        /// Reuse only to retry a send that failed.
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        dry_run: bool,
        /// The session sending, so Engineering Lead's reply and later notes on this topic go back to it. Defaults to DEV_AGENT_BRIDGE_SESSION.
        #[arg(long)]
        session: Option<String>,
    },
    /// Take Engineering Lead's new inbox messages for this session, as JSON. A message on a topic this session wrote on comes to it; the session holding the lease gets the rest.
    Take {
        #[arg(long)]
        session: String,
        #[arg(long, default_value = "")]
        cwd: String,
        /// Keep the lease without taking any message: for a session that is busy and will take them when its work is done.
        #[arg(long)]
        hold: bool,
    },
    /// Make this session the one that receives Engineering Lead's messages.
    Listen {
        #[arg(long)]
        session: String,
        #[arg(long, default_value = "")]
        cwd: String,
    },
    /// Give up the lease if this session holds it.
    Release {
        #[arg(long)]
        session: String,
    },
    /// Show which session receives messages and how many are waiting, as JSON.
    Status,
}

fn run(cli: Cli) -> Result<String, BridgeError> {
    let env = Env::current();
    match cli.command {
        Command::Send { kind, topic, body, body_file, reply_to, ctx, commit, file, id, dry_run, session } => {
            send::run(&env, send::SendArgs { kind, topic, body, body_file, reply_to, ctx, commit, file, id, dry_run, session })
        }
        Command::Take { session, cwd, hold } => {
            let taken = if hold { inbox::hold(&env, &session, &cwd)? } else { inbox::take(&env, &session, &cwd)? };
            Ok(serde_json::to_string(&taken).unwrap_or_default())
        }
        Command::Listen { session, cwd } => inbox::listen(&env, &session, &cwd),
        Command::Release { session } => inbox::release(&env, &session),
        Command::Status => Ok(inbox::status(&env)?.to_string()),
    }
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            let code = if error.use_stderr() { 2 } else { 0 };
            let _ = error.print();
            return ExitCode::from(code);
        }
    };
    match run(cli) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("dev-agent-bridge: {}", error.message);
            ExitCode::from(u8::try_from(error.code).unwrap_or(1))
        }
    }
}
