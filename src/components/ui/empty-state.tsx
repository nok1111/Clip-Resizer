import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      <Icon className="size-8 text-text-secondary/60" />
      <p className="text-sm font-medium text-text">{title}</p>
      {body && <p className="max-w-sm text-xs text-text-secondary">{body}</p>}
      {children}
    </div>
  );
}
