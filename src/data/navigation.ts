export type NavItem = {
    id: string;
    label: string;
    shortLabel: string;
    description: string;
};

export const navigationItems: NavItem[] = [
    {
        id: 'home',
        label: 'Главная',
        shortLabel: 'Главная',
        description: 'Общий обзор дома и системы',
    },
    {
        id: 'devices',
        label: 'Устройства',
        shortLabel: 'Устройства',
        description: 'Комнаты, устройства и управление',
    },
    {
        id: 'explorer',
        label: 'Проводник',
        shortLabel: 'Файлы',
        description: 'Файлы и каталоги HC Storage Service',
    },
    {
        id: 'servers',
        label: 'Серверы',
        shortLabel: 'Серверы',
        description: 'HomeCloudBackend и системные службы',
    },
    {
        id: 'automation',
        label: 'Автоматизация',
        shortLabel: 'Сценарии',
        description: 'Сценарии, события и автоматические действия',
    },
    {
        id: 'settings',
        label: 'Настройки',
        shortLabel: 'Настройки',
        description: 'Параметры оболочки и профили устройств',
    },
];