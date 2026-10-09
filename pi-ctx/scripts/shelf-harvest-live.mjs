#!/usr/bin/env node
// One-shot live harvest. Isolated CTX_HOME, pi-unsafe RPC, bind answered here.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const prompt = readFileSync(join(here, "shelf-harvest-prompt.txt"), "utf8").trim();
const ctxHome = mkdtempSync(join(tmpdir(), "ctx-shelf-"));
const work = mkdtempSync(join(tmpdir(), "ctx-shelf-work-"));
const PROJECT = "shelf-harvest-try";

const child = spawn(
	"pi-unsafe",
	[
		"--mode",
		"rpc",
		"--no-tools",
		"--no-skills",
		"--no-context-files",
		"--no-prompt-templates",
		"--no-mcp",
		"--session-dir",
		join(work, "sessions"),
		"--name",
		"shelf-harvest",
	],
	{
		cwd: work,
		env: { ...process.env, CTX_HOME: ctxHome },
		stdio: ["pipe", "pipe", "pipe"],
	},
);

const notices = [];
const assistant = [];
let buf = Buffer.alloc(0);
const waiters = [];

function send(obj) {
	child.stdin.write(`${JSON.stringify(obj)}\n`);
}

function removeWaiter(w) {
	const i = waiters.indexOf(w);
	if (i >= 0) waiters.splice(i, 1);
}

function waitFor(match, ms, label) {
	return new Promise((resolve, reject) => {
		const w = {
			match,
			resolve: (data) => {
				clearTimeout(timer);
				removeWaiter(w);
				resolve(data);
			},
		};
		const timer = setTimeout(() => {
			removeWaiter(w);
			reject(new Error(`timeout waiting for ${label}`));
		}, ms);
		waiters.push(w);
	});
}

function answerUi(data) {
	if (data.type !== "extension_ui_request") return;
	const method = data.method;
	if (method === "notify") {
		const message = String(data.message ?? "");
		notices.push(message);
		console.log(`NOTIFY ${message}`);
		return;
	}
	if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") return;

	const title = String(data.title ?? "");
	const options = Array.isArray(data.options) ? data.options.map(String) : [];
	console.log(`UI ${method} ${title.split("\n")[0]}`);
	if (method === "select") {
		let value;
		if (title.startsWith("Bind ctx project")) {
			value = options.find((o) => o.startsWith(`new: ${PROJECT}`)) ?? options.find((o) => o.startsWith("new:"));
		} else if (title.startsWith("Pending replace")) {
			value = options.find((o) => o === "Keep live law" || o === "Keep all remaining");
		}
		if (!value) {
			console.log(`UI unanswered select options=${options.join(" | ")}`);
			send({ type: "extension_ui_response", id: data.id, cancelled: true });
			return;
		}
		console.log(`UI pick ${value}`);
		send({ type: "extension_ui_response", id: data.id, value });
		return;
	}
	if (method === "confirm") {
		const confirmed = title === "Confirm bind";
		console.log(`UI confirm ${confirmed}`);
		send({ type: "extension_ui_response", id: data.id, confirmed });
		return;
	}
	if (method === "input" && title === "Project name") {
		send({ type: "extension_ui_response", id: data.id, value: PROJECT });
		return;
	}
	send({ type: "extension_ui_response", id: data.id, cancelled: true });
}

function onLine(line) {
	let data;
	try {
		data = JSON.parse(line);
	} catch {
		console.log(`NONJSON ${line}`);
		return;
	}
	answerUi(data);
	if (data.type === "message_update" && data.assistantMessageEvent?.type === "text_delta") {
		assistant.push(String(data.assistantMessageEvent.delta ?? ""));
	}
	for (const w of [...waiters]) {
		if (w.match(data)) w.resolve(data);
	}
}

child.stdout.on("data", (chunk) => {
	buf = Buffer.concat([buf, chunk]);
	let idx;
	while ((idx = buf.indexOf(0x0a)) >= 0) {
		const line = buf.subarray(0, idx).toString("utf8").replace(/\r$/, "");
		buf = buf.subarray(idx + 1);
		if (line) onLine(line);
	}
});
child.stderr.on("data", (chunk) => {
	process.stderr.write(chunk);
});

function promptResponse(id) {
	return (data) => data.type === "response" && data.id === id;
}

const replyText = () => assistant.join("").trim();

function loadRecords() {
	const projects = join(ctxHome, "projects");
	const out = [];
	let names = [];
	try {
		names = readdirSync(projects);
	} catch {
		return out;
	}
	for (const id of names) {
		const logs = join(projects, id, "logs");
		let files = [];
		try {
			files = readdirSync(logs);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const text = readFileSync(join(logs, file), "utf8");
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				try {
					out.push(JSON.parse(line));
				} catch {
					out.push({ type: "unparsed", headline: line });
				}
			}
		}
	}
	return out;
}

function sourceOf(rec) {
	const rationale = String(rec.rationale ?? "");
	if (rationale.includes("source: assistant")) return "assistant";
	if (rationale.includes("source: user")) return "user";
	return "unknown";
}

const checks = [];
function check(ok, label) {
	checks.push({ ok, label });
	console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

let exitCode = 1;
try {
	console.log(`CTX_HOME=${ctxHome}`);
	console.log(`work=${work}`);
	const started = waitFor((data) => data.type === "agent_settled", 180000, "assistant reply");
	send({ id: "reply", type: "prompt", message: prompt });
	const accepted = await waitFor(promptResponse("reply"), 30000, "reply accept");
	if (!accepted.success) throw new Error(accepted.error || "reply rejected");
	console.log(`reply disposition=${accepted.data?.disposition ?? "?"}`);
	if (accepted.data?.disposition !== "handled") await started;
	console.log("--- assistant ---");
	console.log(replyText() || "(empty)");
	console.log("--- bind ---");
	const bindDone = waitFor(promptResponse("bind"), 180000, "bind");
	send({ id: "bind", type: "prompt", message: `/ctx bind ${PROJECT}` });
	const bound = await bindDone;
	if (!bound.success) throw new Error(bound.error || "bind rejected");
	console.log(`bind disposition=${bound.data?.disposition ?? "?"}`);

	const records = loadRecords();
	console.log("--- records ---");
	for (const rec of records) {
		console.log(`${rec.type}\t${sourceOf(rec)}\t${rec.headline ?? ""}`);
	}
	const receipt = notices.find((n) => n.includes("bound to")) ?? notices.at(-1) ?? "";
	console.log("--- receipt ---");
	console.log(receipt || "(none)");

	const has = (type, source) => records.some((r) => r.type === type && (source ? sourceOf(r) === source : true));
	check(records.some((r) => r.type === "constraint"), "user shelf rule stored as a constraint");
	check(!records.some((r) => r.type === "constraint" && /cap/i.test(String(r.headline ?? "") + String(r.directive ?? "") + String(r.body ?? ""))), "cap question was not stored as a constraint");
	check(has("destination"), "destination stored");
	check(has("out_of_scope"), "out of scope stored");
	check(has("question"), "question stored");
	check(has("fog", "user"), "user fog stored");
	check(has("decision", "assistant"), "assistant decision stored");
	check(has("finding", "assistant"), "assistant finding stored");
	check(has("fog", "assistant"), "assistant fog stored");
	check(!records.some((r) => r.type === "evidence"), "evidence skipped");
	check(/finding/i.test(receipt), "receipt names the finding");
	check(/cap 10/.test(receipt), "receipt mentions the shelf cap");
	exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (error) {
	console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
	exitCode = 1;
} finally {
	console.log(`SHELF_HARVEST_DONE exit=${exitCode}`);
	child.stdin.end();
	const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
	await new Promise((resolve) => child.on("exit", resolve));
	clearTimeout(killTimer);
	process.exit(exitCode);
}
