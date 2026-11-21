use crate::message::{self, Draft, Message, DEV_AGENT, ENG_LEAD};
use crate::state::{append_log, now_ts, BridgeError, Env, Result, SendState};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

pub struct SendArgs {
    pub kind: String,
    pub topic: String,
    pub body: Option<String>,
    pub body_file: Option<String>,
    pub reply_to: Option<String>,
    pub ctx: Vec<String>,
    pub commit: Option<String>,
    pub file: Option<String>,
    pub id: Option<String>,
    pub dry_run: bool,
}

struct Secrets {
    url: String,
    key: String,
}

fn load_secrets(path: &Path) -> Result<Secrets> {
    if !path.is_file() {
        return Err(BridgeError::new(3, format!("secrets file not found: {}", path.display())));
    }
    let invalid = || BridgeError::new(3, format!("secrets file is not valid JSON: {}", path.display()));
    let text = std::fs::read_to_string(path).map_err(|_| invalid())?;
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| invalid())?;
    let field = |name: &str| value.get(name).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let (url, key) = (field("url"), field("key"));
    if !url.starts_with("https://") || key.is_empty() || ["replace", "replace-me", "changeme"].contains(&key.to_lowercase().as_str()) {
        return Err(BridgeError::new(3, format!("secrets file needs an https url and a key: {}", path.display())));
    }
    Ok(Secrets { url, key })
}

pub fn redact(text: &str, key: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(key) = key.filter(|k| !k.is_empty()) {
        out = out.replace(key, "<redacted>");
    }
    let bearer = regex::Regex::new(r"(?i)(bearer)\s+\S+").expect("bearer pattern");
    let out = bearer.replace_all(&out, "$1 <redacted>").to_string();
    out.chars().take(300).collect()
}

fn read_body(args: &SendArgs) -> Result<String> {
    match (&args.body, &args.body_file) {
        (Some(body), None) => Ok(body.clone()),
        (None, Some(path)) if path == "-" => {
            let mut body = String::new();
            std::io::stdin().read_to_string(&mut body).map_err(|e| BridgeError::new(2, format!("cannot read stdin: {e}")))?;
            Ok(body)
        }
        (None, Some(path)) => std::fs::read_to_string(path)
            .map(|body| body.trim_start_matches('\u{feff}').to_string())
            .map_err(|e| BridgeError::new(2, format!("cannot read --body-file: {e}"))),
        _ => Err(BridgeError::new(2, "give exactly one of --body or --body-file")),
    }
}

fn post(secrets: &Secrets, msg: &Message) -> Result<u16> {
    let tls = ureq::tls::TlsConfig::builder().root_certs(ureq::tls::RootCerts::PlatformVerifier).build();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .max_redirects(0)
        .http_status_as_error(false)
        .tls_config(tls)
        .build()
        .into();
    let body = serde_json::to_string(msg).map_err(|e| BridgeError::new(2, e.to_string()))?;
    let key = secrets.key.as_str();
    let mut response = agent
        .post(&secrets.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Authorization", &format!("Bearer {key}"))
        .header("X-Automation-Key", key)
        .send(body)
        .map_err(|e| BridgeError::new(6, format!("webhook POST failed: {}", redact(&e.to_string(), Some(key)))))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let text = response.body_mut().read_to_string().unwrap_or_default();
        return Err(BridgeError::new(6, format!("webhook answered HTTP {status}: {}", redact(&text, Some(key)))));
    }
    Ok(status)
}

pub fn run(env: &Env, args: SendArgs) -> Result<String> {
    let msg = message::build(Draft {
        from: DEV_AGENT,
        to: ENG_LEAD,
        topic: args.topic.clone(),
        kind: args.kind.clone(),
        body: read_body(&args)?,
        reply_to: args.reply_to.clone(),
        ctx: args.ctx.clone(),
        commit: args.commit.clone(),
        file: args.file.clone(),
        id: args.id.clone(),
    });
    let errors = message::validate(&msg);
    if !errors.is_empty() {
        return Err(BridgeError::new(2, format!("invalid message: {}", errors.join("; "))));
    }
    let secrets_path = env.secrets_path();
    let carries_key = |key: &str| serde_json::to_string(&msg).unwrap_or_default().contains(key);
    if args.dry_run {
        let secrets = load_secrets(&secrets_path);
        if let Ok(secrets) = &secrets {
            if carries_key(&secrets.key) {
                return Err(BridgeError::new(2, "message contains the sender key; remove it"));
            }
        }
        let status = match secrets {
            Ok(_) => format!("secrets: ok ({})", secrets_path.display()),
            Err(error) => format!("secrets: {}", error.message),
        };
        return Ok(format!(
            "{}\nheaders: Authorization=Bearer <redacted>; X-Automation-Key=<redacted>\n{status}\ndry run: nothing sent or recorded",
            serde_json::to_string_pretty(&msg).unwrap_or_default()
        ));
    }
    let secrets = load_secrets(&secrets_path)?;
    if carries_key(&secrets.key) {
        return Err(BridgeError::new(2, "message contains the sender key; remove it"));
    }
    let state_file = env.state_dir()?.join("send-state.json");
    let mut state = SendState::load(&state_file);
    let now = now_ts();
    state.prune(now);
    state.check(&msg, now)?;
    let status = post(&secrets, &msg)?;
    state.record(&msg, now);
    state.save(&state_file)?;
    let entry = serde_json::json!({"logged_at": message::now_iso(), "direction": "to-engineering-lead", "status": status, "message": msg});
    let log = append_log(env, &entry)?;
    Ok(format!("sent {} kind={} topic={} http={status} log={}", msg.id, msg.kind, msg.topic, log.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_hides_the_key_and_any_bearer_value() {
        assert_eq!(redact("got k3y-123 and Bearer abc.def", Some("k3y-123")), "got <redacted> and Bearer <redacted>");
        assert_eq!(redact(&"x".repeat(400), None).len(), 300);
    }

    #[test]
    fn placeholder_or_http_secrets_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"url":"https://x","key":"changeme"}"#).unwrap();
        assert_eq!(load_secrets(&path).err().unwrap().code, 3);
        std::fs::write(&path, r#"{"url":"http://x","key":"real"}"#).unwrap();
        assert_eq!(load_secrets(&path).err().unwrap().code, 3);
        std::fs::write(&path, "\u{feff}{\"url\":\"https://x\",\"key\":\"real\"}").unwrap();
        assert_eq!(load_secrets(&path).unwrap().key, "real");
        assert_eq!(load_secrets(&dir.path().join("none.json")).err().unwrap().code, 3);
    }
}
