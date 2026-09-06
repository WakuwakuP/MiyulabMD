import type { LucideIcon } from "lucide-react";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
  Video,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  bullet: List,
  code: Code,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  hr: Minus,
  image: Image,
  og: Link,
  ordered: ListOrdered,
  paragraph: Type,
  quote: Quote,
  youtube: Video,
};

export function SlashItemIcon({ id }: { id: string }) {
  const Icon = ICONS[id] ?? Type;
  return <Icon aria-hidden={true} className="size-4" strokeWidth={1.8} />;
}
