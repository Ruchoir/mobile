/**
 * Lets `node --test` load the packages of Ruchoir/core that ship their TypeScript source
 * (`@ruchoir/permissions-logic`): Node strips types from the repository's own files, never from
 * `node_modules`, so their `.ts` files are stripped here with Node's own `stripTypeScriptTypes`.
 * Registered by the `test` script (`--import`); Metro builds the app and needs none of this.
 */
import { register } from "node:module";

register(new URL("./typescript-packages-hooks.mjs", import.meta.url));
