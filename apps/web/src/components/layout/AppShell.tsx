import { Link, Outlet } from "react-router";

export function AppShell() {
  return (
    <div>
      <header>
        <Link to="/">MiyulabMD</Link>
        <nav>
          <Link to="/settings">設定</Link>
          <a href="/auth/login">ログイン</a>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
