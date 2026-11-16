import { useState } from 'react';
import { motion } from 'motion/react';
import { Cpu, FolderOpen, House, Server, Settings, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavItem } from '../../data/navigation';

const NAV_ICONS: Record<string, LucideIcon> = {
  home: House,
  devices: Cpu,
  explorer: FolderOpen,
  servers: Server,
  automation: Workflow,
  settings: Settings,
};

type SidebarNavProps = {
  items: NavItem[];
  activeId: string;
  onChange: (id: string) => void;
};

export function SidebarNav({ items, activeId, onChange }: SidebarNavProps) {
  const [hintedItemId, setHintedItemId] = useState<string | null>(null);

  return (
    <aside className="homecloud-glass homecloud-sidebar w-[68px] shrink-0" aria-label="HomeCloud">
      <div className="flex h-full flex-col">
        <div className="flex justify-center px-2 pb-4 pt-5">
          <div className="homecloud-brand__orb h-9 w-9 shrink-0" aria-hidden="true" />
        </div>

        <nav
          className="homecloud-sidebar__nav min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-3"
          aria-label="Основная навигация"
        >
          {items.map((item, index) => {
            const active = item.id === activeId;
            const Icon = NAV_ICONS[item.id] ?? FolderOpen;

            return (
              <motion.button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id);
                  setHintedItemId(item.id);
                }}
                onPointerEnter={() => setHintedItemId(item.id)}
                onPointerLeave={(event) => {
                  // Touch has no hover state: keep the last tapped section visible.
                  if (event.pointerType !== 'touch') {
                    setHintedItemId(null);
                  }
                }}
                onFocus={() => setHintedItemId(item.id)}
                onBlur={() => setHintedItemId(null)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, delay: index * 0.025 }}
                whileHover={{ scale: 1.035 }}
                whileTap={{ scale: 0.96 }}
                className={[
                  'homecloud-nav-item',
                  active ? 'homecloud-nav-item--active' : '',
                  'justify-center px-0',
                ].join(' ')}
              >
                <span className="homecloud-nav-item__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                {hintedItemId === item.id && (
                  <span className="homecloud-sidebar__hint" role="tooltip">
                    {item.label}
                  </span>
                )}
              </motion.button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
