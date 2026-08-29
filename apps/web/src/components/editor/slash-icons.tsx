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
  paragraph: Type,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  ordered: ListOrdered,
  quote: Quote,
  code: Code,
  hr: Minus,
  image: Image,
  youtube: Video,
  og: Link,
};

export function SlashItemIcon({ id }: { id: string }) {
  const Icon = ICONS[id] ?? Type;
  return <Icon aria-hidden className="size-4" strokeWidth={1.8} />;
}
