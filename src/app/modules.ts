import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  Clock3,
  Layers,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

export type ModuleId = "studio" | "queue" | "presets" | "history";

export interface NavItem {
  key: ModuleId | "dashboard" | "settings";
  path: string;
  icon: LucideIcon;
}

export interface ToolModule {
  id: ModuleId;
  path: string;
  icon: LucideIcon;
  /** false until the module is fully implemented and tested */
  available: boolean;
}

/** Sidebar order follows the product spec; `available` gates real functionality. */
export const TOOL_MODULES: ToolModule[] = [
  { id: "studio", path: "/studio", icon: Clapperboard, available: true },
  { id: "queue", path: "/queue", icon: Layers, available: false },
  { id: "presets", path: "/presets", icon: SlidersHorizontal, available: false },
  { id: "history", path: "/history", icon: Clock3, available: false },
];

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", path: "/", icon: LayoutDashboard },
  ...TOOL_MODULES.map((m) => ({ key: m.id, path: m.path, icon: m.icon })),
  { key: "settings", path: "/settings", icon: Settings },
];

export function moduleById(id: ModuleId): ToolModule {
  return TOOL_MODULES.find((m) => m.id === id)!;
}
