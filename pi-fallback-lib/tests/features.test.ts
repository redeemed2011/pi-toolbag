import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFeatureDir } from "./bdd.js";
import "./steps.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "features");
runFeatureDir(dir);
