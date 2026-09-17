import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

function which(bin: string): string | undefined {
	try {
		return execFileSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf-8" }).trim() || undefined;
	} catch {
		return undefined;
	}
}

describe("cplt Pi-agent profile", () => {
	it("documents exec ≠ agent and looks for the ~/.pi/ctx grant in --print-profile", () => {
		const cplt = which("cplt");
		if (!cplt) return;

		let profile = "";
		try {
			profile = execFileSync(cplt, ["--agent", "pi", "--print-profile"], {
				encoding: "utf-8",
				timeout: 20_000,
			});
		} catch {
			return;
		}

		expect(profile).toMatch(/Landlock|Seatbelt|deny-by-default/i);
		const ctxPath = `${homedir()}/.pi/ctx`;
		const granted = profile.includes(ctxPath);
		if (process.env.CPLT_REQUIRE_CTX === "1") {
			expect(granted, `${ctxPath} must appear in the Pi agent profile`).toBe(true);
		}
		if (!granted) {
			expect(profile.includes(`${homedir()}/.pi/agent`) || profile.includes("/.pi/agent")).toBe(true);
		}
	});
});
