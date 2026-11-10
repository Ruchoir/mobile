/** The load hook of `typescript-packages.mjs`: a `.ts` file of `node_modules/@ruchoir`, types stripped. */
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") && url.includes("/node_modules/") && url.includes("/@ruchoir/")) {
    const source = await readFile(new URL(url), "utf8");
    return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true };
  }
  return nextLoad(url, context);
}
