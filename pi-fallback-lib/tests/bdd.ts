import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

export type World = Record<string, unknown>;

type StepFn = (world: World, ...args: string[]) => void | Promise<void>;

type StepDef = { pattern: RegExp; fn: StepFn };

const defs: StepDef[] = [];

export function Given(pattern: string | RegExp, fn: StepFn): void {
  defs.push({ pattern: asRe(pattern), fn });
}
export const When = Given;
export const Then = Given;
export const And = Given;

function asRe(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{string\\\}/g, '"([^"]*)"');
  return new RegExp(`^${escaped}$`);
}

export type Step = { keyword: string; text: string };

export type Scenario = { name: string; steps: Step[] };

export type Feature = { name: string; background: Step[]; scenarios: Scenario[] };

function tokenizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => !/^\s*#/.test(line));
}

function parseTable(rows: string[]): string[][] {
  return rows
    .map((row) => row.trim())
    .filter((row) => row.startsWith("|"))
    .map((row) =>
      row
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

function substitute(text: string, headers: string[], values: string[]): string {
  let out = text;
  for (let i = 0; i < headers.length; i++) {
    out = out.replaceAll(`<${headers[i]}>`, values[i] ?? "");
  }
  return out;
}

export function parseFeature(text: string): Feature {
  const lines = tokenizeLines(text);
  let name = "Feature";
  const background: Step[] = [];
  const scenarios: Scenario[] = [];
  let mode: "none" | "background" | "scenario" | "outline" | "examples" = "none";
  let current: Scenario | undefined;
  let outlineSteps: Step[] = [];
  let outlineName = "";
  let exampleHeaders: string[] = [];
  let exampleRows: string[][] = [];

  const flushOutline = (): void => {
    if (mode !== "examples" && mode !== "outline") return;
    if (exampleHeaders.length && exampleRows.length) {
      for (const [index, values] of exampleRows.entries()) {
        scenarios.push({
          name: `${outlineName} [${values.join(" | ") || index}]`,
          steps: outlineSteps.map((step) => ({
            keyword: step.keyword,
            text: substitute(step.text, exampleHeaders, values),
          })),
        });
      }
    }
    outlineSteps = [];
    outlineName = "";
    exampleHeaders = [];
    exampleRows = [];
  };

  const pushStep = (keyword: string, text: string): void => {
    const step = { keyword, text };
    if (mode === "background") background.push(step);
    else if (mode === "scenario" && current) current.steps.push(step);
    else if (mode === "outline") outlineSteps.push(step);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const feature = /^Feature:\s*(.*)$/.exec(line);
    if (feature) {
      name = feature[1] || "Feature";
      continue;
    }
    if (/^Background:/.test(line)) {
      flushOutline();
      mode = "background";
      continue;
    }
    const outline = /^Scenario Outline:\s*(.*)$/.exec(line);
    if (outline) {
      flushOutline();
      if (current) scenarios.push(current);
      current = undefined;
      mode = "outline";
      outlineName = outline[1] || "outline";
      outlineSteps = [];
      continue;
    }
    const scenario = /^Scenario:\s*(.*)$/.exec(line);
    if (scenario) {
      flushOutline();
      if (current) scenarios.push(current);
      current = { name: scenario[1] || "scenario", steps: [] };
      mode = "scenario";
      continue;
    }
    if (/^Examples:/.test(line)) {
      mode = "examples";
      exampleHeaders = [];
      exampleRows = [];
      continue;
    }
    if (mode === "examples" && line.startsWith("|")) {
      const [row] = parseTable([line]);
      if (!row) continue;
      if (exampleHeaders.length === 0) exampleHeaders = row;
      else exampleRows.push(row);
      continue;
    }
    const step = /^(Given|When|Then|And|But)\s+(.*)$/.exec(line);
    if (step) {
      pushStep(step[1], step[2]);
    }
  }
  flushOutline();
  if (current) scenarios.push(current);
  return { name, background, scenarios };
}

function matchStep(text: string): { fn: StepFn; args: string[] } {
  for (const def of defs) {
    const match = def.pattern.exec(text);
    if (match) return { fn: def.fn, args: match.slice(1) };
  }
  throw new Error(`Undefined step: ${text}`);
}

export function runFeature(feature: Feature, file: string): void {
  describe(`${feature.name} (${file})`, () => {
    for (const scenario of feature.scenarios) {
      it(scenario.name, async () => {
        const world: World = {};
        const steps = [...feature.background, ...scenario.steps];
        for (const step of steps) {
          const matched = matchStep(step.text);
          await matched.fn(world, ...matched.args);
        }
      });
    }
  });
}

export function runFeatureDir(dir: string): void {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".feature"))
    .sort();
  for (const file of files) {
    const feature = parseFeature(readFileSync(join(dir, file), "utf8"));
    runFeature(feature, file);
  }
}
