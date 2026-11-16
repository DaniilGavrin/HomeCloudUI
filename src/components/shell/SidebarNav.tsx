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
  compact?: boolean;
};

export function SidebarNav({
  items,
  activeId,
  onChange,
  compact = false,
}: SidebarNavProps) {
  return (
    <aside
      className={[
        'homecloud-glass homecloud-sidebar shrink-0',
        compact ? 'w-[64px]' : 'w-[196px]',
      ].join(' ')}
    >
      <div className="flex h-full flex-col">
        <div className={compact ? 'px-2 pb-4 pt-5' : 'px-4 pb-4 pt-5'}>
          <div className="homecloud-brand">
            <div
              className="homecloud-brand__orb shrink-0"
              style={compact ? undefined : { width: 34, height: 34 }}
            />
            {!compact && (
              <div className="min-w-0">
                <div className="homecloud-brand__title">HomeCloud</div>
                
              </div>
            )}
          </div>
        </div>

        <nav className={[
          'min-h-0 flex-1 space-y-2 overflow-y-auto pb-4',
          compact ? 'px-1.5' : 'px-2',
        ].join(' ')}>
          {items.map((item, index) => {
            const active = item.id === activeId;
            const Icon = NAV_ICONS[item.id] ?? FolderOpen;

            return (
              <motion.button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                className={[
                  'homecloud-nav-item',
                  active ? 'homecloud-nav-item--active' : '',
                  compact ? 'justify-center px-0' : 'gap-2 px-2',
                ].join(' ')}
              >
                <span className="homecloud-nav-item__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.8} />
                </span>

                {!compact && (
                  <div className="min-w-0 text-left">
                    <div className="truncate text-[14px] font-medium text-white">
                      {item.label}
                    </div>
                  </div>
                )}
              </motion.button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
