"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useIsAdmin } from "@/hooks/use-user-role";
import { subscribeOpenCommandPalette } from "@/lib/command-palette-bus";
import * as React from "react";
import {
  Activity,
  Calculator,
  ChefHat,
  HelpCircle,
  LayoutGrid,
  LineChart,
  Moon,
  Package,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Sun,
  Utensils,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import type { ViewKey } from "./Sidebar";

type Props = {
  /** Switch the main app view. Mirrors AppShell's `onSelect`. */
  onSelectView: (key: ViewKey) => void;
};

type NavCommand = {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Optional alt keywords for fuzzy search — cmdk searches against
   *  `value` by default but our value is the route key. Adding
   *  keywords lets a user type "weight" or "graph" and still land
   *  on Progress. */
  keywords: string[];
};

const NAV_COMMANDS: NavCommand[] = [
  {
    key: "calculator",
    label: "Calculator",
    icon: Calculator,
    keywords: ["macros", "tdee", "bmr", "target", "home"],
  },
  {
    key: "plan",
    label: "Meal Plan",
    icon: Utensils,
    keywords: ["meals", "today", "log", "breakfast", "lunch", "dinner"],
  },
  {
    key: "progress",
    label: "Progress",
    icon: LineChart,
    keywords: ["weight", "graph", "trend", "plateau", "streak"],
  },
  {
    key: "foods",
    label: "My Foods",
    icon: Activity,
    keywords: ["catalog", "custom", "ingredients"],
  },
  {
    key: "recipes",
    label: "Recipes",
    icon: ChefHat,
    keywords: ["cookbook", "ingredients"],
  },
  {
    key: "templates",
    label: "Templates",
    icon: LayoutGrid,
    keywords: ["saved meals", "presets"],
  },
  {
    key: "shopping",
    label: "Shopping",
    icon: ShoppingCart,
    keywords: ["grocery", "list", "buy"],
  },
  {
    key: "pantry",
    label: "Pantry",
    icon: Package,
    keywords: ["inventory", "stock", "fridge", "on hand", "have"],
  },
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    keywords: [
      "account",
      "billing",
      "subscription",
      "notifications",
      "export",
      "import",
      "delete",
    ],
  },
];

/** Global command palette — Cmd-K / Ctrl-K to open. Surfaces:
 *    - Every nav destination as a typeable command
 *    - Theme toggle (light / dark / system)
 *    - Admin entry point (only when the caller is an admin)
 *
 *  We bind the keyboard shortcut at the document level so the
 *  user can summon it from anywhere — inside inputs included
 *  (Cmd-K is unambiguous; we don't fight VSCode for it). The
 *  cmdk-driven filtering handles fuzzy matching against `label`
 *  + `keywords`.
 *
 *  Mounted in [AppShell](./AppShell.tsx). */
export function CommandPalette({ onSelectView }: Props) {
  const [open, setOpen] = React.useState(false);
  const isAdmin = useIsAdmin();
  const { setTheme } = useTheme();
  const router = useRouter();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    // Also subscribe to the bus so the Topbar search-button (and
    // anything else) can open us programmatically.
    const unsub = subscribeOpenCommandPalette(() => setOpen(true));
    return () => {
      document.removeEventListener("keydown", onKey);
      unsub();
    };
  }, []);

  function runAndClose(action: () => void) {
    setOpen(false);
    // Defer the action so the dialog's close animation gets to start
    // before whatever heavy state change the action triggers.
    requestAnimationFrame(action);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {NAV_COMMANDS.map((cmd) => {
            const Icon = cmd.icon;
            return (
              <CommandItem
                key={cmd.key}
                value={`${cmd.label} ${cmd.keywords.join(" ")}`}
                onSelect={() => runAndClose(() => onSelectView(cmd.key))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{cmd.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          <CommandItem
            value="Help FAQ documentation guide explainer"
            onSelect={() => runAndClose(() => router.push("/help"))}
          >
            <HelpCircle className="mr-2 h-4 w-4" />
            <span>Help &amp; FAQ</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Appearance">
          <CommandItem
            value="Light theme"
            onSelect={() => runAndClose(() => setTheme("light"))}
          >
            <Sun className="mr-2 h-4 w-4" />
            <span>Light theme</span>
          </CommandItem>
          <CommandItem
            value="Dark theme"
            onSelect={() => runAndClose(() => setTheme("dark"))}
          >
            <Moon className="mr-2 h-4 w-4" />
            <span>Dark theme</span>
          </CommandItem>
          <CommandItem
            value="System theme"
            onSelect={() => runAndClose(() => setTheme("system"))}
          >
            <Sun className="mr-2 h-4 w-4" />
            <span>Match system</span>
          </CommandItem>
        </CommandGroup>

        {isAdmin && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Admin">
              <CommandItem
                value="Admin dashboard"
                onSelect={() => runAndClose(() => router.push("/admin"))}
              >
                <ShieldAlert className="mr-2 h-4 w-4 text-red-600 dark:text-red-400" />
                <span>Open admin dashboard</span>
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
