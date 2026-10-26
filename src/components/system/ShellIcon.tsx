import type { ReactNode, SVGProps } from 'react';

type IconName = 'power' | 'restart' | 'lock' | 'unlock' | 'close' | 'cloud' | 'arrow';

type Props = SVGProps<SVGSVGElement> & { name: IconName };

export function ShellIcon({ name, ...props }: Props) {
  const paths: Record<IconName, ReactNode> = {
    power: (
      <>
        <path d="M12 2v10" />
        <path d="M6.1 5.6a9 9 0 1 0 11.8 0" />
      </>
    ),
    restart: (
      <>
        <path d="M20 11a8 8 0 0 0-14.7-4.4L3 9" />
        <path d="M3 3v6h6" />
        <path d="M4 13a8 8 0 0 0 14.7 4.4L21 15" />
        <path d="M15 15h6v6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 15v2" />
      </>
    ),
    unlock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 7.6-1.8" />
        <path d="M12 15v2" />
      </>
    ),
    close: <path d="M5 5l14 14M19 5 5 19" />,
    cloud: <path d="M7 19h10a5 5 0 0 0 .5-10A7 7 0 0 0 4 11a4 4 0 0 0 3 8Z" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
