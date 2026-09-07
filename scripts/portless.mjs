import { fileURLToPath } from "node:url";

// Use standard ports so local URLs do not need a port suffix.
// HTTP needs no OpenSSL or certificate trust; HTTPS remains opt-in.
process.env.PORTLESS_HTTPS ??= "0";
process.env.PORTLESS_PORT ??= process.env.PORTLESS_HTTPS === "1" ? "443" : "80";
process.env.PORTLESS_SYNC_HOSTS ??= "0";
process.env.PORTLESS_LAN ??= "0";
process.env.PORTLESS_TLD ??= "localhost";

// Run the pinned portless CLI in this process to retain its signal handling.
const cli = new URL("./cli.js", import.meta.resolve("portless"));
process.argv[1] = fileURLToPath(cli);
await import(cli.href);
