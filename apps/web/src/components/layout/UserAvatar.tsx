import { initialFromName } from "../../lib/user-style.ts";

type Props = {
  name: string;
  color: string;
  title?: string;
};

export function UserAvatar({ name, color, title }: Props) {
  return (
    <span className="user-avatar" style={{ backgroundColor: color }} title={title ?? name}>
      {initialFromName(name)}
    </span>
  );
}
