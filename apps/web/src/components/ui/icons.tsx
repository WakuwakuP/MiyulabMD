import {
  ChevronDown,
  Circle,
  EllipsisVertical,
  Eye,
  FileText,
  Folder,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Sun,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn.ts";

type IconProps = {
  className?: string;
};

export function EyeIcon({ className }: IconProps) {
  return <Eye aria-hidden className={cn("size-4", className)} />;
}

export function SunIcon({ className }: IconProps) {
  return <Sun aria-hidden className={cn("size-4", className)} />;
}

export function MoonIcon({ className }: IconProps) {
  return <Moon aria-hidden className={cn("size-4", className)} />;
}

export function BlackIcon({ className }: IconProps) {
  return (
    <Circle aria-hidden className={cn("size-4 fill-current", className)} />
  );
}

export function MonitorIcon({ className }: IconProps) {
  return <Monitor aria-hidden className={cn("size-4", className)} />;
}

export function PencilIcon({ className }: IconProps) {
  return <Pencil aria-hidden className={cn("size-4", className)} />;
}

export function ChevronDownIcon({ className }: IconProps) {
  return <ChevronDown aria-hidden className={cn("size-3", className)} />;
}

export function CloseIcon({ className }: IconProps) {
  return <X aria-hidden className={cn("size-4", className)} />;
}

export function MoreIcon({ className }: IconProps) {
  return <EllipsisVertical aria-hidden className={cn("size-5", className)} />;
}

export function FolderOutlineIcon({ className }: IconProps) {
  return <Folder aria-hidden className={cn("size-4", className)} />;
}

export function PlusIcon({ className }: IconProps) {
  return <Plus aria-hidden className={cn("size-4", className)} />;
}

export function ShareIcon({ className }: IconProps) {
  return <Share2 aria-hidden className={cn("size-4", className)} />;
}

export function RefreshIcon({ className }: IconProps) {
  return <RefreshCw aria-hidden className={cn("size-4", className)} />;
}

export function ArticleIcon({ className }: IconProps) {
  return <FileText aria-hidden className={cn("size-4", className)} />;
}

export function FolderIcon({ className }: IconProps) {
  return (
    <Folder
      aria-hidden
      className={cn("size-[22px] shrink-0 text-folder", className)}
    />
  );
}

export function MarkdownIcon({ className }: IconProps) {
  return (
    <FileText
      aria-hidden
      className={cn("size-[22px] shrink-0 text-note", className)}
    />
  );
}
