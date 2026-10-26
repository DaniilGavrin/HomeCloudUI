# collect-app.ps1
# Коллектор проекта HSStorage
# Собирает frontend (Tauri + React) + документацию в один текстовый файл

$ErrorActionPreference = "Continue"

# ============================================
# НАСТРОЙКИ
# ============================================

$PROJECT_ROOT = $PSScriptRoot
if (-not $PROJECT_ROOT) { $PROJECT_ROOT = Get-Location }

# Имя файла с датой и временем
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$OUTPUT_FILE = Join-Path $PROJECT_ROOT "webos-export-$timestamp.txt"

# Формат: @{Name=""; Type=""; SourceDirs=@(); ConfigFiles=@()}
$PROJECTS = @(
    @{
        Name = "."
        Type = "tauri-react"
        SourceDirs = @("src", "src-tauri/src", "public")
        ConfigFiles = @("package.json", "vite.config.ts", "tsconfig.json", "tsconfig.node.json", "tailwind.config.js", "postcss.config.js", "index.html", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json")
    }
)

$EXCLUDE_DIRS = @(
    "node_modules", "target", ".git", "dist", "dist-ssr", "build", "out", ".next",
    ".env", ".env.local", ".vscode", ".idea", "gen", "bin", "tmp", "logs", "capabilities"
)

$EXCLUDE_FILES = @(
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock",
    ".DS_Store", "Thumbs.db"
)

$EXCLUDE_FILE_PATTERNS = @("*.log", "*.key", "*.pem", "*.exe", "*.dll", "*.so", "*.dylib", "*.app", "*.dmg")

$BINARY_EXTENSIONS = @(
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".ttf", ".eot", ".woff2",
    ".avif", ".mp4", ".mp3", ".wav", ".pdf",
    ".exe", ".dll", ".so", ".dylib", ".app", ".dmg",
    ".db", ".sqlite", ".sqlite3",
    ".zip", ".tar", ".gz", ".7z", ".rar"
)

# ============================================
# СЧЁТЧИКИ И МАССИВЫ
# ============================================

$script:processedCount = 0
$script:skippedCount = 0
$script:skippedBinary = @()
$script:skippedExcludedFile = @()
$script:skippedExcludedDir = @()
$script:skippedReadError = @()

# ============================================
# ФУНКЦИИ ПРОВЕРКИ ИСКЛЮЧЕНИЙ
# ============================================

function Test-ExcludedDir {
    param([string]$dirName)
    foreach ($ex in $EXCLUDE_DIRS) {
        if ($dirName -eq $ex) { return $true }
    }
    return $false
}

function Test-ExcludedFile {
    param([string]$fileName)
    foreach ($ex in $EXCLUDE_FILES) {
        if ($fileName -eq $ex) { return $true }
    }
    foreach ($pattern in $EXCLUDE_FILE_PATTERNS) {
        if ($fileName -like $pattern) { return $true }
    }
    return $false
}

function Test-Binary {
    param([string]$ext)
    $ext = $ext.ToLower()
    foreach ($bext in $BINARY_EXTENSIONS) {
        if ($ext -eq $bext) { return $true }
    }
    return $false
}

function Test-PathExcluded {
    param([string]$path)
    $parts = $path -split '[/\\]'
    foreach ($part in $parts) {
        foreach ($exDir in $EXCLUDE_DIRS) {
            if ($part -eq $exDir) { return $true }
        }
    }
    return $false
}

# ============================================
# ФОРМАТИРОВАНИЕ РАЗМЕРА
# ============================================

function Format-FileSize {
    param([long]$bytes)
    if ($bytes -lt 1024) {
        return "${bytes} B"
    } elseif ($bytes -lt 1048576) {
        return ("{0:N2} KB" -f ($bytes / 1024))
    } elseif ($bytes -lt 1073741824) {
        return ("{0:N2} MB" -f ($bytes / 1048576))
    } else {
        return ("{0:N2} GB" -f ($bytes / 1073741824))
    }
}

# ============================================
# ЗАПИСЬ В ФАЙЛ (через StreamWriter для скорости)
# ============================================

$script:writer = $null

function Open-OutputFile {
    $script:writer = [System.IO.StreamWriter]::new($OUTPUT_FILE, $false, [System.Text.UTF8Encoding]::new($false))
}

function Write-Output {
    param([string]$text)
    $script:writer.WriteLine($text)
}

function Close-OutputFile {
    if ($script:writer) {
        $script:writer.Close()
        $script:writer.Dispose()
    }
}

# ============================================
# ОБРАБОТКА ФАЙЛА
# ============================================

function Process-File {
    param(
        [string]$file,
        [string]$fileInfo
    )

    $ext = ""
    if ($file -match '\.') {
        $ext = [System.IO.Path]::GetExtension($file)
    }

    if (Test-Binary $ext) {
        $script:skippedBinary += $fileInfo
        return "BINARY"
    }

    $fileName = [System.IO.Path]::GetFileName($file)
    if (Test-ExcludedFile $fileName) {
        $script:skippedExcludedFile += $fileInfo
        return "EXCLUDED_FILE"
    }

    if (Test-PathExcluded $fileInfo) {
        $script:skippedExcludedDir += $fileInfo
        return "EXCLUDED_DIR"
    }

    Write-Output ""
    Write-Output "---------------------------------------------------------------------"
    Write-Output "[FILE] $fileInfo"
    Write-Output "---------------------------------------------------------------------"

    try {
        $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
        Write-Output $content
        return "PROCESSED"
    } catch {
        $script:skippedReadError += $fileInfo
        return "READ_ERROR"
    }
}

# ============================================
# ПОДСЧЁТ ФАЙЛОВ
# ============================================

function Get-TotalFileCount {
    param([string]$path)
    $count = 0

    $files = Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $relPath = $file.FullName.Substring($path.Length + 1)
        $fileName = $file.Name
        $ext = ""
        if ($file.Name -match '\.') {
            $ext = [System.IO.Path]::GetExtension($file.Name)
        }

        if (-not (Test-PathExcluded $relPath) -and
                -not (Test-ExcludedFile $fileName) -and
                -not (Test-Binary $ext)) {
            $count++
        }
    }
    return $count
}

# ============================================
# ДЕРЕВО (КРАТКОЕ)
# ============================================

function Write-DirectoryTree {
    param(
        [string]$path,
        [string]$prefix = "",
        [int]$depth = 0,
        [int]$maxDepth = 8
    )

    if ($depth -ge $maxDepth) { return }

    $dirs = Get-ChildItem -Path $path -Directory -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-ExcludedDir $_.Name) } |
            Sort-Object Name

    $count = $dirs.Count
    $i = 0

    foreach ($dir in $dirs) {
        $i++
        $isLast = ($i -eq $count)

        $connector = if ($isLast) { "+-- " } else { "|-- " }

        $fileCount = 0
        $dirCount = 0

        $subFiles = Get-ChildItem -Path $dir.FullName -File -ErrorAction SilentlyContinue
        foreach ($f in $subFiles) {
            $ext = ""
            if ($f.Name -match '\.') { $ext = [System.IO.Path]::GetExtension($f.Name) }
            if (-not (Test-ExcludedFile $f.Name) -and -not (Test-Binary $ext)) {
                $fileCount++
            }
        }

        $subDirs = Get-ChildItem -Path $dir.FullName -Directory -ErrorAction SilentlyContinue |
                Where-Object { -not (Test-ExcludedDir $_.Name) }
        $dirCount = $subDirs.Count

        $status = ""
        if ($fileCount -eq 0 -and $dirCount -eq 0) {
            $status = " [EMPTY]"
        } elseif ($fileCount -eq 0) {
            $status = " [$dirCount subdirs]"
        } else {
            $status = " [$fileCount files"
            if ($dirCount -gt 0) { $status += ", $dirCount subdirs" }
            $status += "]"
        }

        Write-Output "$prefix$connector$($dir.Name)/$status"

        $newPrefix = if ($isLast) { "$prefix    " } else { "$prefix|   " }

        Write-DirectoryTree -path $dir.FullName -prefix $newPrefix -depth ($depth + 1) -maxDepth $maxDepth
    }
}

# ============================================
# ДЕРЕВО (ПОЛНОЕ)
# ============================================

function Write-DirectoryTreeFull {
    param(
        [string]$path,
        [string]$prefix = "",
        [int]$depth = 0,
        [int]$maxDepth = 10
    )

    if ($depth -ge $maxDepth) { return }

    $dirs = Get-ChildItem -Path $path -Directory -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-ExcludedDir $_.Name) } |
            Sort-Object Name

    $files = Get-ChildItem -Path $path -File -ErrorAction SilentlyContinue |
            Where-Object {
                $ext = ""
                if ($_.Name -match '\.') { $ext = [System.IO.Path]::GetExtension($_.Name) }
                -not (Test-ExcludedFile $_.Name) -and -not (Test-Binary $ext)
            } |
            Sort-Object Name

    $allItems = @()
    foreach ($d in $dirs) { $allItems += [PSCustomObject]@{Type="dir"; Item=$d} }
    foreach ($f in $files) { $allItems += [PSCustomObject]@{Type="file"; Item=$f} }

    $count = $allItems.Count
    $i = 0

    foreach ($entry in $allItems) {
        $i++
        $isLast = ($i -eq $count)

        $connector = if ($isLast) { "+-- " } else { "|-- " }

        if ($entry.Type -eq "dir") {
            $dir = $entry.Item

            $fileCount = 0
            $dirCount = 0

            $subFiles = Get-ChildItem -Path $dir.FullName -File -ErrorAction SilentlyContinue
            foreach ($f in $subFiles) {
                $ext = ""
                if ($f.Name -match '\.') { $ext = [System.IO.Path]::GetExtension($f.Name) }
                if (-not (Test-ExcludedFile $f.Name) -and -not (Test-Binary $ext)) {
                    $fileCount++
                }
            }

            $subDirs = Get-ChildItem -Path $dir.FullName -Directory -ErrorAction SilentlyContinue |
                    Where-Object { -not (Test-ExcludedDir $_.Name) }
            $dirCount = $subDirs.Count

            $status = ""
            if ($fileCount -eq 0 -and $dirCount -eq 0) {
                $status = " [EMPTY]"
            } elseif ($fileCount -eq 0) {
                $status = " [$dirCount subdirs]"
            } else {
                $status = " [$fileCount files"
                if ($dirCount -gt 0) { $status += ", $dirCount subdirs" }
                $status += "]"
            }

            Write-Output "$prefix$connector$($dir.Name)/$status"

            $newPrefix = if ($isLast) { "$prefix    " } else { "$prefix|   " }

            Write-DirectoryTreeFull -path $dir.FullName -prefix $newPrefix -depth ($depth + 1) -maxDepth $maxDepth
        } else {
            $file = $entry.Item
            $sizeBytes = $file.Length

            $sizeStr = if ($sizeBytes -ge 1024) {
                "{0:N1}KB" -f ($sizeBytes / 1024)
            } else {
                "${sizeBytes}B"
            }
            Write-Output "$prefix$connector$($file.Name) [$sizeStr]"
        }
    }
}

# ============================================
# ОСНОВНАЯ ЛОГИКА
# ============================================

Open-OutputFile

Write-Output "====================================================================="
Write-Output "     WebOS - Project Export"
Write-Output "====================================================================="
Write-Output "Date: $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss')"
Write-Output "Projects: frontend (Tauri), docs"
Write-Output ""

foreach ($project in $PROJECTS) {
    $projectName = $project.Name
    $projectType = $project.Type
    $projectPath = Join-Path $PROJECT_ROOT $projectName

    if (-not (Test-Path $projectPath)) {
        Write-Host "[WARNING] Project $projectName not found, skipping" -ForegroundColor Yellow
        continue
    }

    Write-Output ""
    Write-Output "====================================================================="
    Write-Output "  PROJECT: $projectName"
    Write-Output "  Type: $projectType"
    Write-Output "====================================================================="

    foreach ($sourceDir in $project.SourceDirs) {
        if ([string]::IsNullOrWhiteSpace($sourceDir)) { continue }

        if ($sourceDir -eq ".") {
            $fullPath = $projectPath
            $displayDir = "(root)"
        } else {
            $fullPath = Join-Path $projectPath $sourceDir
            $displayDir = $sourceDir
        }

        if (Test-Path $fullPath) {
            Write-Output ""
            Write-Output "### DIRECTORY: $displayDir ###"

            $files = Get-ChildItem -Path $fullPath -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName

            foreach ($file in $files) {
                $relativePath = $file.FullName.Substring($projectPath.Length + 1)
                $relativePath = $relativePath -replace '\\', '/'
                $fileInfo = "$projectName/$relativePath"

                Write-Host "`r[...] Reading: $fileInfo" -ForegroundColor Cyan -NoNewline

                $result = Process-File -file $file.FullName -fileInfo $fileInfo

                switch ($result) {
                    "PROCESSED" {
                        $script:processedCount++
                        Write-Host "`r[OK] $fileInfo" -ForegroundColor Green -NoNewline
                    }
                    "BINARY" {
                        $script:skippedCount++
                        Write-Host "`r[SKIP BINARY] $fileInfo" -ForegroundColor DarkGray -NoNewline
                    }
                    "EXCLUDED_FILE" {
                        $script:skippedCount++
                        Write-Host "`r[SKIP EXCLUDED] $fileInfo" -ForegroundColor DarkGray -NoNewline
                    }
                    "EXCLUDED_DIR" {
                        $script:skippedCount++
                        Write-Host "`r[SKIP DIR] $fileInfo" -ForegroundColor DarkGray -NoNewline
                    }
                    "READ_ERROR" {
                        $script:skippedCount++
                        Write-Host "`r[ERROR] $fileInfo" -ForegroundColor Red
                    }
                }
            }
        }
    }

    if ($project.ConfigFiles.Count -gt 0) {
        Write-Output ""
        Write-Output "### CONFIG FILES ###"

        foreach ($configFile in $project.ConfigFiles) {
            if ([string]::IsNullOrWhiteSpace($configFile)) { continue }
            $fullPath = Join-Path $projectPath $configFile

            if (Test-Path $fullPath) {
                $fileInfo = "$projectName/$configFile"

                Write-Host "`r[...] Reading config: $fileInfo" -ForegroundColor Cyan -NoNewline

                Write-Output ""
                Write-Output "---------------------------------------------------------------------"
                Write-Output "[FILE] $fileInfo"
                Write-Output "---------------------------------------------------------------------"

                try {
                    $content = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)
                    Write-Output $content
                    $script:processedCount++
                    Write-Host "`r[OK] $fileInfo" -ForegroundColor Green -NoNewline
                } catch {
                    $script:skippedReadError += $fileInfo
                    $script:skippedCount++
                    Write-Host "`r[ERROR] $fileInfo" -ForegroundColor Red
                }
            }
        }
    }
}

Write-Host "`r" -NoNewline

# ============================================
# СТРУКТУРА ПРОЕКТА (КРАТКОЕ ДЕРЕВО)
# ============================================

Write-Output ""
Write-Output "====================================================================="
Write-Output "              PROJECT STRUCTURE"
Write-Output "====================================================================="
Write-Output ""

$rootDirs = Get-ChildItem -Path $PROJECT_ROOT -Directory -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-ExcludedDir $_.Name) } |
        Sort-Object Name

$rootCount = $rootDirs.Count
$i = 0

foreach ($dir in $rootDirs) {
    $i++
    $isLast = ($i -eq $rootCount)

    $connector = if ($isLast) { "+-- " } else { "|-- " }

    $fileCount = Get-TotalFileCount -path $dir.FullName

    $subDirs = Get-ChildItem -Path $dir.FullName -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-ExcludedDir $_.Name) }
    $dirCount = $subDirs.Count

    $status = ""
    if ($fileCount -eq 0 -and $dirCount -eq 0) {
        $status = " [EMPTY]"
    } elseif ($fileCount -eq 0) {
        $status = " [$dirCount subdirs]"
    } else {
        $status = " [$fileCount files"
        if ($dirCount -gt 0) { $status += ", $dirCount subdirs" }
        $status += "]"
    }

    Write-Output "$connector$($dir.Name)/$status"

    $newPrefix = if ($isLast) { "    " } else { "|   " }

    Write-DirectoryTree -path $dir.FullName -prefix $newPrefix -depth 1 -maxDepth 6
}

$rootFiles = Get-ChildItem -Path $PROJECT_ROOT -File -ErrorAction SilentlyContinue |
        Where-Object {
            $ext = ""
            if ($_.Name -match '\.') { $ext = [System.IO.Path]::GetExtension($_.Name) }
            -not (Test-ExcludedFile $_.Name) -and -not (Test-Binary $ext)
        } |
        Sort-Object Name

if ($rootFiles.Count -gt 0) {
    Write-Output ""
    Write-Output "# Root files:"
    foreach ($file in $rootFiles) {
        Write-Output "|-- $($file.Name)"
    }
}

# ============================================
# ПОЛНАЯ СТРУКТУРА (ВСЕ ФАЙЛЫ)
# ============================================

Write-Output ""
Write-Output "====================================================================="
Write-Output "          FULL STRUCTURE (ALL FILES)"
Write-Output "====================================================================="
Write-Output ""

$rootDirs2 = Get-ChildItem -Path $PROJECT_ROOT -Directory -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-ExcludedDir $_.Name) } |
        Sort-Object Name

$rootCount2 = $rootDirs2.Count
$i2 = 0

foreach ($dir in $rootDirs2) {
    $i2++
    $isLast = ($i2 -eq $rootCount2)

    $connector = if ($isLast) { "+-- " } else { "|-- " }

    $fileCount = Get-TotalFileCount -path $dir.FullName

    $subDirs = Get-ChildItem -Path $dir.FullName -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-ExcludedDir $_.Name) }
    $dirCount = $subDirs.Count

    $status = ""
    if ($fileCount -eq 0 -and $dirCount -eq 0) {
        $status = " [EMPTY]"
    } elseif ($fileCount -eq 0) {
        $status = " [$dirCount subdirs]"
    } else {
        $status = " [$fileCount files"
        if ($dirCount -gt 0) { $status += ", $dirCount subdirs" }
        $status += "]"
    }

    Write-Output "$connector$($dir.Name)/$status"

    $newPrefix = if ($isLast) { "    " } else { "|   " }

    Write-DirectoryTreeFull -path $dir.FullName -prefix $newPrefix -depth 1 -maxDepth 10
}

if ($rootFiles.Count -gt 0) {
    Write-Output ""
    Write-Output "# Root files:"
    $rfCount = $rootFiles.Count
    $rfI = 0
    foreach ($file in $rootFiles) {
        $rfI++
        $rfConnector = if ($rfI -eq $rfCount) { "+-- " } else { "|-- " }
        $sizeBytes = $file.Length

        $sizeStr = if ($sizeBytes -ge 1024) {
            "{0:N1}KB" -f ($sizeBytes / 1024)
        } else {
            "${sizeBytes}B"
        }
        Write-Output "$rfConnector$($file.Name) [$sizeStr]"
    }
}

# ============================================
# СПИСОК ПРОПУЩЕННЫХ ФАЙЛОВ
# ============================================

Write-Output ""
Write-Output "====================================================================="
Write-Output "          SKIPPED FILES LIST"
Write-Output "====================================================================="
Write-Output ""

$totalSkipped = 0

$binaryCount = $script:skippedBinary.Count
$totalSkipped += $binaryCount
Write-Output "---------------------------------------------------------------------"
Write-Output " BINARY files (images, fonts, archives, etc.): $binaryCount"
Write-Output "---------------------------------------------------------------------"
if ($binaryCount -gt 0) {
    $sorted = $script:skippedBinary | Sort-Object
    foreach ($f in $sorted) { Write-Output "   - $f" }
} else {
    Write-Output "   (none)"
}
Write-Output ""

$excludedFileCount = $script:skippedExcludedFile.Count
$totalSkipped += $excludedFileCount
Write-Output "---------------------------------------------------------------------"
Write-Output " EXCLUDED_FILE (by pattern: .pem, .key, lock-files, etc.): $excludedFileCount"
Write-Output "---------------------------------------------------------------------"
if ($excludedFileCount -gt 0) {
    $sorted = $script:skippedExcludedFile | Sort-Object
    foreach ($f in $sorted) { Write-Output "   - $f" }
} else {
    Write-Output "   (none)"
}
Write-Output ""

$excludedDirCount = $script:skippedExcludedDir.Count
$totalSkipped += $excludedDirCount
Write-Output "---------------------------------------------------------------------"
Write-Output " EXCLUDED_DIR (in node_modules, target, .git, etc.): $excludedDirCount"
Write-Output "---------------------------------------------------------------------"
if ($excludedDirCount -gt 0) {
    $sorted = $script:skippedExcludedDir | Sort-Object
    foreach ($f in $sorted) { Write-Output "   - $f" }
} else {
    Write-Output "   (none)"
}
Write-Output ""

$readErrorCount = $script:skippedReadError.Count
$totalSkipped += $readErrorCount
Write-Output "---------------------------------------------------------------------"
Write-Output " READ_ERROR (could not read): $readErrorCount"
Write-Output "---------------------------------------------------------------------"
if ($readErrorCount -gt 0) {
    $sorted = $script:skippedReadError | Sort-Object
    foreach ($f in $sorted) { Write-Output "   - $f" }
} else {
    Write-Output "   (none)"
}

Write-Output ""
Write-Output "---------------------------------------------------------------------"
Write-Output " TOTAL SKIPPED: $totalSkipped files"
Write-Output "---------------------------------------------------------------------"

# ============================================
# ИТОГОВАЯ СТАТИСТИКА
# ============================================

Close-OutputFile

$fileSize = (Get-Item $OUTPUT_FILE).Length
$fileSizeHuman = Format-FileSize -bytes $fileSize

# Добавляем статистику в конец файла
$statsContent = @"

=====================================================================
                    SUMMARY
=====================================================================
Processed files: $($script:processedCount)
Skipped files (total): $totalSkipped
  |- BINARY: $binaryCount
  |- EXCLUDED_FILE: $excludedFileCount
  |- EXCLUDED_DIR: $excludedDirCount
  |- READ_ERROR: $readErrorCount
Export size: $fileSize bytes ($fileSizeHuman)
"@

[System.IO.File]::AppendAllText($OUTPUT_FILE, $statsContent, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "[OK] Done! Result: $OUTPUT_FILE" -ForegroundColor Green
Write-Host "[OK] Processed: $($script:processedCount) files" -ForegroundColor Cyan
Write-Host "[WARNING] Skipped: $totalSkipped files" -ForegroundColor Yellow
Write-Host "  |- BINARY: $binaryCount" -ForegroundColor DarkGray
Write-Host "  |- EXCLUDED_FILE: $excludedFileCount" -ForegroundColor DarkGray
Write-Host "  |- EXCLUDED_DIR: $excludedDirCount" -ForegroundColor DarkGray
if ($readErrorCount -gt 0) {
    Write-Host "  |- READ_ERROR: $readErrorCount" -ForegroundColor Red
} else {
    Write-Host "  |- READ_ERROR: $readErrorCount" -ForegroundColor DarkGray
}
Write-Host "[SIZE] $fileSize bytes ($fileSizeHuman)" -ForegroundColor Cyan
Write-Host ""

if ($readErrorCount -gt 0) {
    Write-Host "[WARNING] ATTENTION: there are files with read errors!" -ForegroundColor Red
}