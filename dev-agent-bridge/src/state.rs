use crate::message::Message;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const RATE_LIMIT: usize = 20;
pub const RATE_WINDOW_S: f64 = 3600.0;
pub const KEEP_STATE_S: f64 = 30.0 * 24.0 * 3600.0;

#[derive(Debug)]
pub struct BridgeError {
    pub code: i32,
    pub message: String,
}

impl BridgeError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

pub type Result<T> = std::result::Result<T, BridgeError>;

pub struct Env {
    pub home: PathBuf,
    pub vars: std::collections::HashMap<String, String>,
}

impl Env {
    pub fn current() -> Self {
        Self {
            home: std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/")),
            vars: std::env::vars().collect(),
        }
    }

    fn var(&self, name: &str) -> Option<PathBuf> {
        self.vars.get(name).filter(|v| !v.is_empty()).map(PathBuf::from)
    }

    pub fn share_root(&self) -> PathBuf {
        self.home.join("ResilioSync").join("BnBShare")
    }

    pub fn bridge_share(&self) -> PathBuf {
        self.share_root().join("grokbot").join("engineering-lead").join("dev-agent-bridge")
    }

    pub fn secrets_path(&self) -> PathBuf {
        self.var("DEV_AGENT_BRIDGE_SECRETS").unwrap_or_else(|| self.share_root().join("secrets").join("dev-agent-bridge-webhook.json"))
    }

    pub fn inbox(&self) -> PathBuf {
        self.var("DEV_AGENT_BRIDGE_INBOX").unwrap_or_else(|| self.bridge_share().join("inbox"))
    }

    pub fn shared_log(&self) -> PathBuf {
        self.var("DEV_AGENT_BRIDGE_LOG").unwrap_or_else(|| self.bridge_share().join("log.jsonl"))
    }

    pub fn state_dir(&self) -> Result<PathBuf> {
        let candidates = match self.var("DEV_AGENT_BRIDGE_STATE") {
            Some(dir) => vec![dir],
            None => vec![
                self.home.join(".cache").join("dev-agent-bridge"),
                self.var("XDG_STATE_HOME").unwrap_or_else(|| self.home.join(".local").join("state")).join("dev-agent-bridge"),
            ],
        };
        candidates
            .into_iter()
            .find(|dir| writable_dir(dir))
            .ok_or_else(|| BridgeError::new(7, "no writable state folder; set DEV_AGENT_BRIDGE_STATE"))
    }
}

fn writable_dir(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(format!(".probe-{}", std::process::id()));
    let ok = fs::write(&probe, b"x").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

pub fn now_ts() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sent {
    pub id: String,
    pub ts: f64,
    pub kind: String,
    pub reply_to: Option<String>,
    pub topic: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SendState {
    pub sent: Vec<Sent>,
}

impl SendState {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let text = serde_json::to_string_pretty(self).map_err(|e| BridgeError::new(7, e.to_string()))?;
        write_atomic(path, text.as_bytes()).map_err(|e| BridgeError::new(7, format!("cannot save {}: {e}", path.display())))
    }

    pub fn prune(&mut self, now: f64) {
        self.sent.retain(|s| now - s.ts < KEEP_STATE_S);
    }

    pub fn check(&self, msg: &Message, now: f64) -> Result<()> {
        for s in &self.sent {
            if s.id == msg.id {
                return Err(BridgeError::new(5, format!("message {} was already sent; not sending it again", msg.id)));
            }
            if msg.kind == "reply" && s.reply_to.is_some() && s.reply_to == msg.reply_to {
                return Err(BridgeError::new(5, format!("ask {} already has a reply; one reply per ask", msg.reply_to.as_deref().unwrap_or(""))));
            }
        }
        if self.sent.iter().filter(|s| now - s.ts < RATE_WINDOW_S).count() >= RATE_LIMIT {
            return Err(BridgeError::new(4, format!("rate cap: {RATE_LIMIT} messages in the last hour; try later")));
        }
        Ok(())
    }

    pub fn record(&mut self, msg: &Message, now: f64) {
        self.sent.push(Sent { id: msg.id.clone(), ts: now, kind: msg.kind.clone(), reply_to: msg.reply_to.clone(), topic: msg.topic.clone() });
    }
}

pub fn append_log(env: &Env, entry: &serde_json::Value) -> Result<PathBuf> {
    let line = format!("{entry}\n");
    let append = |path: &Path| -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())
    };
    let shared = env.shared_log();
    if append(&shared).is_ok() {
        return Ok(shared);
    }
    let local = env.state_dir()?.join("log.jsonl");
    append(&local).map_err(|e| BridgeError::new(7, format!("cannot write {}: {e}", local.display())))?;
    Ok(local)
}
