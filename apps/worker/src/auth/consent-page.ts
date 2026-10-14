import type { SessionUser } from "@miyulabmd/shared";

const THEME_BOOT = `(() => {
  try {
    const stored = localStorage.getItem("miyulabmd:theme") ?? "";
    const root = document.documentElement;
    if (stored === "black") {
      root.dataset.theme = "black";
      root.style.colorScheme = "dark";
    } else {
      delete root.dataset.theme;
      let colorScheme = "light dark";
      if (stored === "light") colorScheme = "light";
      else if (stored === "dark") colorScheme = "dark";
      root.style.colorScheme = colorScheme;
    }
  } catch {
    /* ignore */
  }
})();`;

export function consentPageHtml(input: {
  clientName: string;
  redirectHost: string;
  switchAccountHref: string;
  user: SessionUser;
  hiddenFields: string;
}): string {
  const name = escapeHtml(input.clientName);
  const host = escapeHtml(input.redirectHost);
  const switchHref = escapeHtml(input.switchAccountHref);
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${name} への接続 · MiyulabMD</title>
    <script>${THEME_BOOT}</script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=M+PLUS+2:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <header class="bar">MiyulabMD</header>
    <main>
      <section class="card" aria-labelledby="consent-title">
        <p class="eyebrow">接続の確認</p>
        <h1 id="consent-title">${name}</h1>
        <p class="lead">下のアカウントのノートを読み書きします。</p>
        ${accountCard(input.user)}
        <p class="switch"><a href="${switchHref}">別のアカウントでログイン</a></p>
        <ul>
          <li>ノートを読む</li>
          <li>ノートを作成・更新する</li>
        </ul>
        <p class="return">許可すると <code>${host}</code> に戻ります。</p>
        <form method="POST" action="/oauth/authorize">
          ${input.hiddenFields}
          <button class="deny" type="submit" name="decision" value="deny">
            拒否する
          </button>
          <button class="allow" type="submit" name="decision" value="allow">
            許可する
          </button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function accountCard(user: SessionUser): string {
  const name = user.displayName?.trim() || user.email;
  const email =
    name === user.email
      ? ""
      : `<p class="who-email">${escapeHtml(user.email)}</p>`;
  return `<section class="who" aria-label="ログイン中のアカウント">
          <p class="who-label">ログイン中</p>
          <div class="who-row">
            <span class="avatar" style="background:${accountColor(user.email)}">${escapeHtml(accountInitial(name))}</span>
            <div>
              <p class="who-name">${escapeHtml(name)}</p>
              ${email}
            </div>
          </div>
        </section>`;
}

function accountColor(email: string): string {
  const colors = [
    "#2563eb",
    "#4f46e5",
    "#7c3aed",
    "#c026d3",
    "#db2777",
    "#e11d48",
    "#ea580c",
    "#d97706",
    "#16a34a",
    "#0d9488",
    "#0891b2",
    "#0284c7",
  ];
  let hash = 2166136261;
  const seed = email.trim().toLowerCase();
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return colors[(hash >>> 0) % colors.length] ?? "#2563eb";
}

function accountInitial(label: string): string {
  const first = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      label.trim(),
    ),
  ][0];
  return (first?.segment ?? "?").toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --canvas: Canvas;
  --ink: CanvasText;
  --muted: color-mix(in srgb, CanvasText 55%, transparent);
  --border: color-mix(in srgb, CanvasText 18%, transparent);
  --surface: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  --fill: color-mix(in srgb, CanvasText 8%, Canvas);
  --fill-hover: color-mix(in srgb, CanvasText 12%, Canvas);
  --accent: #2563eb;
  --shadow: 0 16px 48px color-mix(in srgb, CanvasText 16%, transparent);
}
html[data-theme="black"] {
  --canvas: #000;
  --ink: #c2c2c2;
  --muted: #7a7a7a;
  --border: #1a1a1a;
  --surface: #000;
  --fill: #101010;
  --fill-hover: #181818;
  --accent: #6b8fc4;
  --shadow: none;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  display: flex;
  flex-direction: column;
  margin: 0;
  min-height: 100dvh;
  font-family: "M PLUS 2", "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif;
  line-height: 1.5;
  color: var(--ink);
  background: var(--canvas);
}
.bar {
  display: flex;
  align-items: center;
  min-height: 3.25rem;
  padding: 0.4rem 0.9rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-weight: 700;
}
main {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 1.5rem 1rem 2.5rem;
}
.card {
  width: min(26rem, 100%);
  margin: 0 auto;
  padding: 1.25rem 1.25rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--canvas);
  box-shadow: var(--shadow);
}
.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 500;
}
h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.lead { margin: 0.45rem 0 0; }
.who {
  margin: 1rem 0 0;
  padding: 0.85rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 0.9rem;
  background: var(--surface);
}
.who-label {
  margin: 0 0 0.55rem;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.who-row { display: flex; align-items: center; gap: 0.75rem; }
.who p { margin: 0; }
.avatar {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  color: #fff;
  font-weight: 700;
  flex: none;
}
.who-name { font-weight: 700; overflow-wrap: anywhere; }
.who-email {
  color: var(--muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.switch { margin: 0.55rem 0 0; font-size: 0.9rem; }
.switch a { color: var(--accent); }
ul {
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
}
li {
  position: relative;
  padding: 0.2rem 0 0.2rem 1.15rem;
}
li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.72em;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--accent);
}
.return {
  margin: 0.9rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}
code {
  font-family: "IBM Plex Mono", Consolas, monospace;
  font-size: 0.85em;
}
form {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.15rem;
}
button {
  min-height: 2.25rem;
  padding: 0.28rem 0.95rem;
  border-radius: 999px;
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
}
.deny {
  border: 1px solid var(--border);
  background: var(--fill);
  color: var(--ink);
}
.deny:hover { background: var(--fill-hover); }
.allow {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
}
.allow:hover { filter: brightness(1.05); }
@media (max-width: 640px) {
  .bar { padding-inline: 0.75rem; }
  main { padding-inline: 0.75rem; }
  form { flex-wrap: wrap; }
  button { flex: 1; }
}
`;
