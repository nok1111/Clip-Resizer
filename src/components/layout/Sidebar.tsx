import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clapperboard } from "lucide-react";
import { NAV_ITEMS } from "@/app/modules";
import { cn } from "@/lib/utils";

/** Icon rail: the Studio needs the width more than the labels do. */
export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-bg-secondary">
      <div className="py-4" title="Clip Resizer">
        <div className="flex size-9 items-center justify-center rounded-xl bg-grad shadow-card">
          <Clapperboard className="size-5 text-white" />
        </div>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col items-center gap-1 overflow-y-auto pb-4">
        {NAV_ITEMS.map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === "/"}
            title={t(`nav.${key}`)}
            aria-label={t(`nav.${key}`)}
            className={({ isActive }) =>
              cn(
                "group flex size-10 items-center justify-center rounded-lg transition-colors",
                key === "settings" && "mt-auto",
                isActive
                  ? "bg-grad text-white shadow-card"
                  : "text-text-secondary hover:bg-card/60 hover:text-text",
              )
            }
          >
            {({ isActive }) => (
              <Icon className={cn("size-[18px]", isActive ? "text-white" : "text-text-secondary group-hover:text-text")} />
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
