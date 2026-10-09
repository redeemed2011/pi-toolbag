#!/usr/bin/env node
// Conflict check, not a happy path. Seed live law, then contradict it.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const prompt = readFileSync(process.env.SHELF_CONFLICT_PROMPT || join(here, "shelf-conflict-prompt.txt"), "utf8").trim();
const ctxHome = mkdtempSync(join(tmpdir(), "ctx-conflict-"));
const work = mkdtempSync(join(tmpdir(), "ctx-conflict-work-"));
const PROJECT = "shelf-conflict-try";
const LAW_ID = "cap-visible";
const DEST_ID = "dest-happy";
const CONFLICT = "Never mention the shelf cap in the receipt.";

const projectDir = join(ctxHome, "projects", PROJECT);
mkdirSync(join(projectDir, "logs"), { recursive: true });
writeFileSync(
	join(projectDir, "project.json"),
	`${JSON.stringify({ id: PROJECT, name: PROJECT, created_at: "2026-09-14T10:00:00.000Z" })}\n`,
);
const seed = [
	{
		id: LAW_ID,
		type: "constraint",
		ts: "2026-09-14T10:00:00.000Z",
		session: "seed",
		headline: "Shelf cap stays visible",
		body: "Always keep the shelf cap visible in the receipt.",
		directive: "Always keep the shelf cap visible in the receipt.",
		applies_to: "all",
	},
	{
		id: DEST_ID,
		type: "destination",
		ts: "2026-09-14T10:00:01.000Z",
		session: "seed",
		headline: "Happy-path harvest",
		body: "The destination is the happy-path harvest.",
		rationale: "source: user",
	},
];
writeFileSync(join(projectDir, "logs", "seed.jsonl"), `${seed.map((row) => JSON.stringify(row)).join("\n")}\n`);

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
		"shelf-conflict",
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
			value = options.find((o) => o.startsWith(`existing: ${PROJECT}`));
		} else if (title.startsWith("Pending replace")) {
			value = options.find((o) => o === "Defer this one" || o === "Defer remaining");
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
		const confirmed = title === "Confirm bind" || title === "Name collision";
		console.log(`UI confirm ${confirmed}`);
		send({ type: "extension_ui_response", id: data.id, confirmed });
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

function loadRecords() {
	const out = [];
	const logs = join(projectDir, "logs");
	for (const file of readdirSync(logs)) {
		if (!file.endsWith(".jsonl")) continue;
		for (const line of readFileSync(join(logs, file), "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line));
			} catch {
				out.push({ type: "unparsed", headline: line });
			}
		}
	}
	return out;
}

function liveIds(records) {
	const superseded = new Set();
	for (const rec of records) {
		const parents = Array.isArray(rec.supersedes) ? rec.supersedes : [];
		for (const parent of parents) superseded.add(parent);
	}
	return new Set(records.filter((rec) => rec.id && !superseded.has(rec.id)).map((rec) => rec.id));
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
	console.log(assistant.join("").trim() || "(empty)");
	console.log("--- bind ---");
	const bindDone = waitFor(promptResponse("bind"), 180000, "bind");
	send({ id: "bind", type: "prompt", message: `/ctx bind ${PROJECT}` });
	const bound = await bindDone;
	if (!bound.success) throw new Error(bound.error || "bind rejected");
	console.log(`bind disposition=${bound.data?.disposition ?? "?"}`);

	const records = loadRecords();
	const live = liveIds(records);
	console.log("--- records ---");
	for (const rec of records) {
		const mark = live.has(rec.id) ? "live" : "dead";
		console.log(`${mark}\t${rec.type}\t${rec.id ?? ""}\t${rec.headline ?? ""}`);
	}
	const receipt = notices.find((n) => n.includes("bound to")) ?? notices.at(-1) ?? "";
	console.log("--- receipt ---");
	console.log(receipt || "(none)");

	const textOf = (rec) => `${rec.headline ?? ""}\n${rec.body ?? ""}\n${rec.directive ?? ""}`;
	const newConstraints = records.filter((rec) => rec.type === "constraint" && rec.id !== LAW_ID && live.has(rec.id));
	const liveDestinations = records.filter((rec) => rec.type === "destination" && live.has(rec.id));
	const pending = records.filter((rec) => rec.type === "pending_replace" && live.has(rec.id));
	check(live.has(LAW_ID), "seeded cap rule is still live");
	check(newConstraints.length === 0, "contradiction was not minted as a new constraint");
	check(
		!records.some((rec) => rec.type === "constraint" && rec.id !== LAW_ID && textOf(rec).includes(CONFLICT)),
		"conflict sentence is not a constraint body",
	);
	check(liveDestinations.length === 1 && liveDestinations[0].id === DEST_ID, "seeded destination was not replaced");
	check(
		pending.some((rec) => rec.parent === LAW_ID && String(rec.body ?? "").includes(CONFLICT)),
		"conflict is a pending replace of the seeded rule",
	);
	exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (error) {
	console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
	exitCode = 1;
} finally {
	console.log(`SHELF_CONFLICT_DONE exit=${exitCode}`);
	child.stdin.end();
	const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
	await new Promise((resolve) => child.on("exit", resolve));
	clearTimeout(killTimer);
	process.exit(exitCode);
}
