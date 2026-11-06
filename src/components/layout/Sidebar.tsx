import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clapperboard } from "lucide-react";
import { NAV_ITEMS } from "@/app/modules";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-grad shadow-card">
          <Clapperboard className="size-5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-text">Clip</div>
          <div className="text-xs text-text-secondary">Resizer</div>
        </div>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {NAV_ITEMS.map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              cn(
                "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                key === "settings" && "mt-auto",
                isActive
                  ? "bg-grad text-white shadow-card"
                  : "text-text-secondary hover:bg-card/60 hover:text-text",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("size-4", isActive ? "text-white" : "text-text-secondary group-hover:text-text")} />
                <span className="truncate">{t(`nav.${key}`)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
