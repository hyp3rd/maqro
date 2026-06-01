import { version } from "../package.json";

/** App version surfaced in Settings → About and the footer chip. Read
 *  from package.json at build time — single source of truth, no env-var
 *  juggling, no risk of drift between the deployed build and the chip
 *  the user is staring at. Next.js inlines the JSON import so the
 *  client bundle gets the literal string. */
export const APP_VERSION: string = version;
