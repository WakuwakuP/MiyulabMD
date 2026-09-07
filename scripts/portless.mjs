import { fileURLToPath } from "node:url";

// Cross-platform defaults: no OpenSSL, certificate trust, hosts edits or sudo.
// Explicit environment variables still allow opting into HTTPS.
process.env.PORTLESS_HTTPS ??= "0";
process.env.PORTLESS_PORT ??= "1355";
process.env.PORTLESS_SYNC_HOSTS ??= "0";
process.env.PORTLESS_LAN ??= "0";
process.env.PORTLESS_TLD ??= "localhost";

// Run the pinned portless CLI in this process to retain its signal handling.
const cli = new URL("./cli.js", import.meta.resolve("portless"));
process.argv[1] = fileURLToPath(cli);
await import(cli.href);
