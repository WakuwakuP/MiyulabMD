import { SHARED_PATH } from "@miyulabmd/shared";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";

type Place = "drive" | "shared";

type Props = {
  current: Place;
};

function itemClass(active: boolean): string {
  return cn(
    "border-0 bg-transparent p-0 font-inherit no-underline",
    active ? "cursor-default text-muted" : "cursor-pointer text-inherit",
  );
}

export function DrivePlaceNav({ current }: Props) {
  return (
    <nav
      className="mb-3 flex flex-wrap items-center gap-3 text-[0.9rem]"
      aria-label="場所"
    >
      <Link
        to="/"
        className={itemClass(current === "drive")}
        aria-current={current === "drive" ? "page" : undefined}
      >
        マイドライブ
      </Link>
      <Link
        to={SHARED_PATH}
        className={itemClass(current === "shared")}
        aria-current={current === "shared" ? "page" : undefined}
      >
        共有
      </Link>
    </nav>
  );
}
