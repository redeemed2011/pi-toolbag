use crate::message::{self, Message};
use crate::state::{append_log, now_ts, write_atomic, BridgeError, Env, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

pub const LEASE_S: f64 = 30.0;
const UNREADABLE_GRACE_S: f64 = 60.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Lease {
    pub session: String,
    pub cwd: String,
    pub heartbeat: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Owner {
    pub session: String,
}

#[derive(Debug, Serialize)]
pub struct Delivered {
    pub id: String,
    pub kind: String,
    pub topic: String,
    pub text: String,
    pub message: Message,
}

#[derive(Debug, Serialize)]
pub struct Rejected {
    pub file: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct Taken {
    pub listener: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<Lease>,
    pub messages: Vec<Delivered>,
    pub rejected: Vec<Rejected>,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_atomic(path, serde_json::to_string(value).unwrap_or_default().as_bytes())
        .map_err(|e| BridgeError::new(7, format!("cannot write {}: {e}", path.display())))
}

struct Paths {
    inbox: PathBuf,
    lease: PathBuf,
    owner: PathBuf,
    delivered: PathBuf,
    rejected: PathBuf,
}

fn paths(env: &Env) -> Result<Paths> {
    let state = env.state_dir()?;
    let delivered = state.join("delivered");
    let rejected = state.join("rejected");
    for dir in [&delivered, &rejected] {
        fs::create_dir_all(dir).map_err(|e| BridgeError::new(7, format!("cannot create {}: {e}", dir.display())))?;
    }
    Ok(Paths { inbox: env.inbox(), lease: state.join("listener.json"), owner: state.join("owner.json"), delivered, rejected })
}

fn claim_marker(dir: &Path, id: &str, note: &str) -> Result<bool> {
    match OpenOptions::new().write(true).create_new(true).open(dir.join(id)) {
        Ok(mut file) => {
            let _ = file.write_all(note.as_bytes());
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(BridgeError::new(7, format!("cannot record {id} in {}: {error}", dir.display()))),
    }
}

fn may_hold(lease: Option<&Lease>, owner: Option<&Owner>, session: &str, now: f64) -> bool {
    match lease {
        None => true,
        Some(lease) => lease.session == session || now - lease.heartbeat > LEASE_S || owner.is_some_and(|o| o.session == session),
    }
}

pub fn listen(env: &Env, session: &str, cwd: &str) -> Result<String> {
    let p = paths(env)?;
    save_json(&p.owner, &Owner { session: session.to_string() })?;
    save_json(&p.lease, &Lease { session: session.to_string(), cwd: cwd.to_string(), heartbeat: now_ts() })?;
    Ok(format!("Engineering Lead messages now arrive in session {session} ({cwd})."))
}

pub fn release(env: &Env, session: &str) -> Result<String> {
    let p = paths(env)?;
    match read_json::<Lease>(&p.lease) {
        Some(lease) if lease.session == session => {
            let _ = fs::remove_file(&p.lease);
            Ok("released".to_string())
        }
        _ => Ok("not the listener".to_string()),
    }
}

pub fn status(env: &Env) -> Result<serde_json::Value> {
    let p = paths(env)?;
    let now = now_ts();
    let lease = read_json::<Lease>(&p.lease).filter(|lease| now - lease.heartbeat <= LEASE_S);
    let owner = read_json::<Owner>(&p.owner);
    let waiting = inbox_files(&p.inbox).into_iter().filter(|(id, _)| !p.delivered.join(id).exists() && !p.rejected.join(id).exists()).count();
    Ok(serde_json::json!({"listener": lease, "owner": owner, "inbox": p.inbox, "waiting": waiting}))
}

fn inbox_files(inbox: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(inbox) else { return Vec::new() };
    let mut files: Vec<(f64, String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".json")?.to_string();
            if !message::is_message_id(&id) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            let at = modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
            Some((at, id, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    files.into_iter().map(|(_, id, path)| (id, path)).collect()
}

fn age_s(path: &Path, now: f64) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| now - t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(now))
        .unwrap_or(f64::MAX)
}

pub fn take(env: &Env, session: &str, cwd: &str) -> Result<Taken> {
    let p = paths(env)?;
    let now = now_ts();
    let lease = read_json::<Lease>(&p.lease);
    let owner = read_json::<Owner>(&p.owner);
    if !may_hold(lease.as_ref(), owner.as_ref(), session, now) {
        return Ok(Taken { listener: false, holder: lease, messages: Vec::new(), rejected: Vec::new() });
    }
    save_json(&p.lease, &Lease { session: session.to_string(), cwd: cwd.to_string(), heartbeat: now })?;
    let mut taken = Taken { listener: true, holder: None, messages: Vec::new(), rejected: Vec::new() };
    for (id, file) in inbox_files(&p.inbox) {
        if p.delivered.join(&id).exists() || p.rejected.join(&id).exists() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&file) else { continue };
        let parsed = message::parse_incoming(raw.trim_start_matches('\u{feff}')).and_then(|msg| {
            if msg.id == id { Ok(msg) } else { Err(format!("the file name does not match its id {}", msg.id)) }
        });
        match parsed {
            Ok(msg) => {
                if !claim_marker(&p.delivered, &id, session)? {
                    continue;
                }
                let entry = serde_json::json!({"logged_at": message::now_iso(), "direction": "to-dev-agent", "via": "inbox", "session": session, "message": msg});
                let _ = append_log(env, &entry);
                taken.messages.push(Delivered { id: msg.id.clone(), kind: msg.kind.clone(), topic: msg.topic.clone(), text: message::frame(&msg), message: msg });
            }
            Err(reason) => {
                if reason == "the file is not valid JSON" && age_s(&file, now) < UNREADABLE_GRACE_S {
                    continue;
                }
                if claim_marker(&p.rejected, &id, &reason)? {
                    taken.rejected.push(Rejected { file: file.display().to_string(), reason });
                }
            }
        }
    }
    Ok(taken)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(dir: &Path) -> Env {
        let vars = HashMap::from([
            ("DEV_AGENT_BRIDGE_STATE".to_string(), dir.join("state").display().to_string()),
            ("DEV_AGENT_BRIDGE_INBOX".to_string(), dir.join("inbox").display().to_string()),
            ("DEV_AGENT_BRIDGE_LOG".to_string(), dir.join("log.jsonl").display().to_string()),
        ]);
        Env { home: dir.to_path_buf(), vars }
    }

    fn drop_message(dir: &Path, id: &str, kind: &str, body: &str) {
        fs::create_dir_all(dir.join("inbox")).unwrap();
        let msg = serde_json::json!({"v":1,"id":id,"from":"engineering-lead","to":"dev-agent","topic":"t","kind":kind,"reply_to":null,"body":body,"refs":{},"sent_at":"2026-11-21T13:20:00-06:00"});
        fs::write(dir.join("inbox").join(format!("{id}.json")), msg.to_string()).unwrap();
    }

    const A: &str = "aaaaaaaa-3899-4f2d-b1d3-f76908734e5b";
    const B: &str = "bbbbbbbb-3899-4f2d-b1d3-f76908734e5b";

    #[test]
    fn each_message_is_delivered_once_and_the_inbox_is_only_read() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path());
        drop_message(dir.path(), A, "note", "first");
        let first = take(&env, "s1", "/w").unwrap();
        assert!(first.listener);
        assert_eq!(first.messages.len(), 1);
        assert!(first.messages[0].text.contains("first"));
        assert!(dir.path().join("inbox").join(format!("{A}.json")).exists());
        assert!(take(&env, "s1", "/w").unwrap().messages.is_empty());
        drop_message(dir.path(), B, "ask", "second");
        let next = take(&env, "s1", "/w").unwrap();
        assert_eq!(next.messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec![B]);
        let log = fs::read_to_string(dir.path().join("log.jsonl")).unwrap();
        assert_eq!(log.lines().count(), 2);
    }

    #[test]
    fn a_second_session_waits_while_the_lease_is_fresh_and_the_owner_takes_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path());
        drop_message(dir.path(), A, "note", "one");
        assert!(take(&env, "s1", "/w").unwrap().listener);
        drop_message(dir.path(), B, "note", "two");
        let other = take(&env, "s2", "/x").unwrap();
        assert!(!other.listener);
        assert_eq!(other.holder.unwrap().session, "s1");
        listen(&env, "s2", "/x").unwrap();
        assert!(!take(&env, "s1", "/w").unwrap().listener);
        let owner = take(&env, "s2", "/x").unwrap();
        assert_eq!(owner.messages.len(), 1);
        let p = paths(&env).unwrap();
        save_json(&p.lease, &Lease { session: "s2".into(), cwd: "/x".into(), heartbeat: now_ts() - LEASE_S - 1.0 }).unwrap();
        assert!(take(&env, "s1", "/w").unwrap().listener);
    }

    #[test]
    fn bad_files_are_reported_once_and_a_partial_file_gets_a_grace_period() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path());
        drop_message(dir.path(), A, "reply", "no reply_to");
        fs::write(dir.path().join("inbox").join(format!("{B}.json")), "{partial").unwrap();
        fs::write(dir.path().join("inbox").join("notes.json"), "{}").unwrap();
        let first = take(&env, "s1", "/w").unwrap();
        assert!(first.messages.is_empty());
        assert_eq!(first.rejected.len(), 1);
        assert!(first.rejected[0].reason.contains("a reply needs"));
        assert!(take(&env, "s1", "/w").unwrap().rejected.is_empty());
    }

    #[test]
    fn a_file_whose_name_is_not_its_id_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path());
        drop_message(dir.path(), A, "note", "x");
        fs::rename(dir.path().join("inbox").join(format!("{A}.json")), dir.path().join("inbox").join(format!("{B}.json"))).unwrap();
        let taken = take(&env, "s1", "/w").unwrap();
        assert!(taken.messages.is_empty());
        assert!(taken.rejected[0].reason.contains("does not match"));
    }

    #[test]
    fn release_frees_the_lease_only_for_its_holder() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path());
        take(&env, "s1", "/w").unwrap();
        assert_eq!(release(&env, "s2").unwrap(), "not the listener");
        assert_eq!(release(&env, "s1").unwrap(), "released");
        assert!(take(&env, "s2", "/x").unwrap().listener);
    }
}
