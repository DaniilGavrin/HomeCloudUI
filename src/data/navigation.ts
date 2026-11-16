export type NavItem = {
    id: string;
    label: string;
    shortLabel: string;
    description: string;
    defaultEnabled?: boolean;
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
        id: 'security',
        label: 'Безопасность',
        shortLabel: 'Безопасность',
        description: 'Безопасность и защита дома',
        defaultEnabled: false,
    },
    {
        id: 'cameras',
        label: 'Камеры',
        shortLabel: 'Камеры',
        description: 'Камеры видеонаблюдения',
        defaultEnabled: false,
    },
    {
        id: 'energy',
        label: 'Электроэнергия',
        shortLabel: 'Энергия',
        description: 'Электроснабжение и энергопотребление',
        defaultEnabled: false,
    },
    {
        id: 'heating',
        label: 'Отопление',
        shortLabel: 'Отопление',
        description: 'Система отопления дома',
        defaultEnabled: false,
    },
    {
        id: 'water',
        label: 'Водоснабжение',
        shortLabel: 'Вода',
        description: 'Водоснабжение и контроль воды',
        defaultEnabled: false,
    },
    {
        id: 'gas',
        label: 'Газоснабжение',
        shortLabel: 'Газ',
        description: 'Газоснабжение и контроль газа',
        defaultEnabled: false,
    },
    {
        id: 'environment',
        label: 'Погода и окружающая среда',
        shortLabel: 'Погода',
        description: 'Погода и параметры окружающей среды',
        defaultEnabled: false,
    },
    {
        id: 'notifications',
        label: 'Центр уведомлений',
        shortLabel: 'Уведомления',
        description: 'События и уведомления HomeCloud',
        defaultEnabled: false,
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
        id: 'system',
        label: 'Система',
        shortLabel: 'Система',
        description: 'Состояние и параметры системы HomeCloud',
        defaultEnabled: false,
    },
    {
        id: 'settings',
        label: 'Настройки',
        shortLabel: 'Настройки',
        description: 'Параметры оболочки и профили устройств',
    },
];
