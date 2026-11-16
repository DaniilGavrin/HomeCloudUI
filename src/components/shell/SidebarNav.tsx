import { motion } from 'motion/react';
import {
  AirVent, Bell, BookOpen, Brush, CalendarDays, Camera, CarFront, CloudSun,
  Cpu, Droplets, Flame, FolderOpen, HeartPulse, House, KeyRound, Lightbulb,
  ListTodo, MonitorCog, Phone, Server, Settings, ShieldCheck, Sprout,
  Thermometer, Wallet, Workflow, Wind, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavItem } from '../../data/navigation';

const NAV_ICONS: Record<string, LucideIcon> = {
  home: House, devices: Cpu, explorer: FolderOpen, security: ShieldCheck,
  cameras: Camera, energy: Zap, heating: Thermometer, water: Droplets, gas: Flame,
  ventilation: Wind, 'air-conditioning': AirVent, locks: KeyRound, transport: CarFront,
  lighting: Lightbulb, irrigation: Sprout, cleaning: Brush, communication: Phone,
  'fire-system': Flame, calendar: CalendarDays, tasks: ListTodo, 'knowledge-base': BookOpen,
  finances: Wallet, medicine: HeartPulse, environment: CloudSun, notifications: Bell,
  servers: Server, automation: Workflow, system: MonitorCog, settings: Settings,
};

type SidebarNavProps = { items: NavItem[]; activeId: string; onChange: (id: string) => void };

export function SidebarNav({ items, activeId, onChange }: SidebarNavProps) {
  return (
    <aside className="homecloud-glass homecloud-sidebar w-16 shrink-0" aria-label="HomeCloud">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 justify-center px-2 pb-3 pt-3">
          <div className="homecloud-brand__orb h-9 w-9 shrink-0" aria-hidden="true" />
        </div>
        <nav className="hc-sidebar-nav-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto px-1.5 pb-3" aria-label="Основная навигация">
          {items.map((item, index) => {
            const active = item.id === activeId;
            const Icon = NAV_ICONS[item.id] ?? FolderOpen;
            return (
              <motion.button
                key={item.id} type="button" onClick={() => onChange(item.id)}
                aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined}
                initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, delay: index * 0.025 }}
                whileHover={{ scale: 1.035 }} whileTap={{ scale: 0.96 }}
                className={['homecloud-nav-item', active ? 'homecloud-nav-item--active' : '', 'justify-center px-0'].join(' ')}
              >
                <span className="homecloud-nav-item__icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
              </motion.button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
