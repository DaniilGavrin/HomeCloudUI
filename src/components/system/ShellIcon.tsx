import {
  ArrowRight,
  Cloud,
  Lock,
  Power,
  RotateCcw,
  Unlock,
  X,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconName = 'power' | 'restart' | 'lock' | 'unlock' | 'close' | 'cloud' | 'arrow';

type Props = Omit<LucideProps, 'ref'> & { name: IconName };

const icons = {
  power: Power,
  restart: RotateCcw,
  lock: Lock,
  unlock: Unlock,
  close: X,
  cloud: Cloud,
  arrow: ArrowRight,
} satisfies Record<IconName, typeof Power>;

export function ShellIcon({ name, size = 22, strokeWidth = 1.7, ...props }: Props) {
  const Icon = icons[name];
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" {...props} />;
}
