import { SHARED_PATH } from "@miyulabmd/shared";
import {
  type LucideIcon,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Switch } from "../ui/Switch.tsx";

type Place = "drive" | "shared" | "shared-by-me";

const places: {
  value: Place;
  label: string;
  ariaLabel: string;
  path: string;
  icon: LucideIcon;
}[] = [
  {
    ariaLabel: "個人（マイドライブ）",
    icon: UserRound,
    label: "個人",
    path: "/",
    value: "drive",
  },
  {
    ariaLabel: "共有（共有されているアイテム）",
    icon: UsersRound,
    label: "共有",
    path: SHARED_PATH,
    value: "shared",
  },
  {
    ariaLabel: "管理（自分が共有済みのアイテム）",
    icon: Settings2,
    label: "管理",
    path: "/shared-by-me",
    value: "shared-by-me",
  },
];

export function DrivePlaceNav({ current }: { current: Place }) {
  const navigate = useNavigate();
  return (
    <Switch
      items={places.map(({ icon: Icon, ...place }) => ({
        ariaLabel: place.ariaLabel,
        label: (
          <>
            <Icon aria-hidden={true} className="size-4" />
            <span className="whitespace-nowrap max-[900px]:hidden">
              {place.label}
            </span>
          </>
        ),
        onClick: () => navigate(place.path),
        pressed: current === place.value,
        value: place.value,
      }))}
      label="場所"
      size="md"
    />
  );
}
