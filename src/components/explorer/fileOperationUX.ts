/**
 * Dialog returns native Windows paths (C:\foo\bar.txt). HC SS paths are
 * always root-relative POSIX segments, never host filesystem paths.
 */
export function uploadNameFromLocalPath(localPath:string):string{
 const normalized=localPath.replace(/\\/g,'/');
 return normalized.slice(normalized.lastIndexOf('/')+1);
}
export function friendlyFileError(raw:string,operation:string):string{
 if(raw.includes('TARGET_EXISTS'))return 'Файл или папка с таким именем уже существует. Переименование/перезапись не выполняется автоматически.';
 if(raw.includes('WRITE_FORBIDDEN'))return 'HC SS запрещает запись в выбранное хранилище (allow_write: false).';
 if(raw.includes('DELETE_FORBIDDEN'))return 'HC SS запрещает удаление в этом хранилище (allow_delete: false).';
 if(raw.includes('COPY_FORBIDDEN'))return 'Для копирования HC SS нужны права чтения и записи выбранного root.';
 if(raw.includes('PERMISSION_DENIED'))return 'Файловая система отказала в доступе. Проверь права каталога и учётной записи HC SS.';
 if(raw.includes('INVALID_PATH')||raw.includes('Недопустимый путь'))return 'Недопустимый путь файла. Проверь имя и выбранную папку.';
 if(raw.includes('NOT_FOUND'))return 'Файл или каталог не найден. Обнови проводник и повтори операцию.';
 if(raw.includes('Тайм-аут')||raw.includes('timeout'))return 'Превышено время ожидания HC SS. Проверь сетевое соединение и состояние службы.';
 if(raw.includes('FILE_OPERATION_FAILED')&&operation==='delete')return 'Удаление не удалось. Непустые каталоги пока нельзя удалять рекурсивно.';
 return raw;
}
