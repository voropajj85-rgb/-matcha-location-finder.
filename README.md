# Matcha Bar Workspace

Рабочий репозиторий проекта запуска Matcha Bar в Мюнхене: desktop-приложение, поиск помещения, поставщики, оснащение, меню, экономика и план запуска.

## DESKTOP BASELINE

Новый baseline — компьютерная версия **Matcha Bar Workspace**. Phase 3C.4 Location Finder сохранён внутри приложения как модуль «Помещения», а не удалён или упрощён.

Основные модули:
- **Обзор** — состояние проекта, прогресс и ближайшие действия;
- **Помещения** — Market / Suitable / Best, фильтры, детали и ручные лиды;
- **Поставщики** — shortlist Matcha, упаковки, сиропов и оборудования со статусами;
- **Оснащение** — пилотный комплект, оборудование точки и расходники;
- **Меню и маржа** — 5 стартовых напитков и редактируемая модель себестоимости;
- **Запуск** — локальный чек-лист и рабочие заметки.

Desktop UI рассчитан на ноутбук/ПК. Мобильная компоновка больше не является целевым baseline.

## Windows-приложение

Приложение упаковывается через Electron и само поднимает HTTP-сервер только на `127.0.0.1` на случайном свободном порту. Внутренний UI не требует отдельного запуска Node/Express пользователем.

Локальный запуск для разработки:

```bash
npm install
npm start
```

Проверка конфигурации:

```bash
npm run check
```

Windows installer + portable EXE:

```bash
npm run dist:win
```

GitHub Actions workflow `.github/workflows/windows-build.yml` собирает Windows artifacts для desktop pull request и может публиковать tagged release по тегу `desktop-v*`.

### Offline / local fallback

- основной источник объявлений остаётся Supabase;
- при запуске на localhost/Electron и недоступном Supabase разрешён fallback на `data/listings.json`;
- интерфейс явно маркирует такой режим как **«Локальный резервный снимок»**;
- на GitHub Pages silent fallback не включается;
- статусы поставщиков, выбранное оснащение, экономические допущения, launch checklist и заметки хранятся локально в браузерном storage этого компьютера.

## Правило изменений

Desktop-компоновка и визуальная система теперь являются текущим baseline. Логику верификации помещений, семантику Market / Suitable / Best и ограничения production ingestion нельзя ослаблять ради красивых цифр.

## Источник истины

Перед любым следующим изменением сначала читать актуальные файлы из этого репозитория и работать от них, а не от старых файлов из чата.

## Структура проекта

```text
matcha-location-finder/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── filters.js
│   ├── listings.js
│   └── storage.js
├── data/
│   ├── listings.json
│   ├── project-config.json
│   └── workspace.json
├── electron/
│   └── main.cjs
├── package.json
├── scripts/
│   ├── check-listings.js
│   └── ingest/
├── supabase/
│   └── migrations/
├── assets/
│   └── images/
├── README.md
└── .github/
    └── workflows/
        └── pages.yml
```

### Назначение файлов

- `index.html` — desktop shell и DOM-каркас всех модулей.
- `css/styles.css` — desktop visual system.
- `js/workspace.js` — навигация workspace, suppliers/equipment/menu/launch и local state.
- `js/app.js` — модуль помещений и управление Market / Suitable / Best.
- `js/config.js` — public Supabase URL и publishable key для браузера.
- `js/supabase.js` — создание read-only Supabase client.
- `js/data/listings-repository.js` — data access layer и DB → domain mapper.
- `js/listings.js` — карточки объявлений, Matcha Score и breakdown.
- `js/filters.js` — фильтрация и сортировка.
- `js/storage.js` — локально добавленные пользователем объекты.
- `data/listings.json` — development fixture и migration/import source, не production database.
- `data/project-config.json` — централизованные критерии помещения.
- `data/workspace.json` — поставщики, оснащение, 5 напитков, экономические допущения и launch tasks.
- `electron/main.cjs` — Electron window + loopback-only static server.
- `package.json` — pinned desktop dependencies and Windows build configuration.
- `scripts/ingest/` — discovery → normalization → dedupe → verification → Supabase upsert pipeline.
- `supabase/migrations/` — SQL migrations для production schema.
- `assets/images/` — будущие изображения и превью.

## Данные

Production source of truth для объявлений — Supabase `public.listings`.

Архитектура:

- GitHub — код, migrations, fixtures и история разработки.
- GitHub Pages — frontend.
- Supabase — production listings data.
- Codex — development workflow.
- `scripts/check-listings.js` — availability verification pipeline.

`data/listings.json` остаётся как fixture/migration source. Runtime frontend читает объявления через `fetchListings()` из `js/data/listings-repository.js`; repository обращается к Supabase и мапит snake_case DB rows в camelCase domain model.

Обновление `data/listings.json` не должно требовать изменения `index.html` или CSS.

### Availability

Поддерживаемые статусы:

- `active` — строго подтверждённое актуальное direct listing.
- `dead` — объявление удалено или деактивировано.
- `unknown` — данных недостаточно; лучше unknown, чем ложный active.
- `search_only` — ссылка ведёт на поиск/выдачу, а не на конкретное объявление.
- `lead` — проектная, муниципальная, брокерская или ручная зацепка.

Основной UI показывает только `lead` и свежие `active`. Свежесть задаётся в `data/project-config.json`; текущий порог — 48 часов.

### Information Schema

Новая семантика данных не удаляет legacy-поля сразу, но renderer должен опираться на нормализованные поля:

- `listingType`: `direct_listing`, `project_lead`, `broker_lead`, `municipal_lead`, `manual_lead`.
- `sourceFamily` и `sourceName` нормализуют источники без замены общего dataset одним источником.
- `unitArea` — площадь конкретного помещения-кандидата.
- `projectTotalArea` — общая площадь проекта; не используется как площадь Matcha Bar unit.
- `gastroSuitability`: `confirmed`, `possible`, `unknown`, `no`.
- `gastroEvidence` объясняет, почему выбран gastro status.
- `verifiedSummary`, `keyFacts`, `unknowns`, `nextAction` разделяют факты источника и наши действия.
- `provision`, `abloese`, `kaution`, `nebenkosten` хранят условия входа как `{ value, known }`.

Новые direct listings добавляются с `availabilityStatus: "unknown"` и становятся `active` только после строгой проверки. Project/broker/municipal/manual leads не маскируются под подтверждённые direct listings.

### Supabase Setup

Frontend использует только public publishable key:

- `SUPABASE_URL` в `js/config.js`
- `SUPABASE_PUBLISHABLE_KEY` в `js/config.js`

Нельзя коммитить:

- `SUPABASE_SERVICE_ROLE_KEY`
- database password
- JWT secret
- private API keys

Для применения schema changes использовать SQL migrations из `supabase/migrations/`.

Для импорта fixture в Supabase:

```bash
SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/import-listings-to-supabase.js
```

Import script делает idempotent upsert по `external_id`, поэтому повторный запуск не создаёт дубли.

RLS policy должна оставаться read-only для public frontend:

- `anon` может `SELECT`.
- public `INSERT`, `UPDATE`, `DELETE` не разрешены.
- Service role используется только локально/CI для admin import, никогда в frontend.

### Ingestion Pipeline

Phase 2 pipeline находится в `scripts/ingest/`:

```text
DISCOVERY
→ NORMALIZATION
→ DEDUPLICATION
→ VERIFICATION
→ SUPABASE UPSERT
→ FRONTEND
```

Source adapters выполняют только discovery. Они не имеют права объявлять новый direct listing `active`.

Поддержанные source families:

- `kleinanzeigen`
- `immowelt`
- `immoscout24`
- `stadt-muenchen`
- `brokers`

Новый direct listing получает `availabilityStatus: "unknown"`. `active` возможен только после строгой source-specific verification из `scripts/check-listings.js`. Municipal/project/broker leads получают `availabilityStatus: "lead"` только когда это действительно lead, а не direct market listing.

Dry run без записи в Supabase является режимом по умолчанию:

```bash
node scripts/ingest/run-ingestion.js
```

Отладка одного источника:

```bash
node scripts/ingest/run-ingestion.js --source=kleinanzeigen --dry-run
```

Production ingestion включается только явным флагом `--production` и пишет только safeForProduction rows плюс cleanupActions:

```bash
SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/ingest/run-ingestion.js --production
```

Если `SUPABASE_SERVICE_ROLE_KEY` отсутствует, `--production` завершается явной ошибкой. Pipeline не пишет production output в `data/listings.json` и не использует frontend secrets для write mode.

GitHub Actions workflow: `.github/workflows/ingest-listings.yml`

- `workflow_dispatch`
- schedule: два раза в день (`06:17` и `18:17` UTC)
- сейчас запускает syntax checks, unit-like tests и ingestion `--dry-run`
- не использует `SUPABASE_SERVICE_ROLE_KEY` и не пишет в production Supabase из PR review mode

Logs печатают только safe summary: discovered/new/updated/status counts и per-source errors без секретов.

Source limitations:

- Portal adapters используют лёгкий HTTP discovery и не обходят CAPTCHA/anti-bot.
- Если источник блокирует запрос, этот source получает partial/error summary, остальные sources продолжают работу.
- Search pages не превращаются в direct listings.
- Stadt München adapter currently uses curated project seeds, not full dynamic municipal discovery.
- Immowelt currently returns partial discovery in this environment, and ImmoScout24 can block automated discovery with HTTP 401/403.
