# Matcha Location Finder

Рабочий репозиторий проекта поиска помещения под Matcha Bar в Мюнхене.

## UI BASELINE

Визуальная структура приложения зафиксирована как baseline.

**Правило:** не менять расположение блоков, навигацию, цвета, размеры, карточки и общую визуальную концепцию без прямого указания пользователя.

Допустимые изменения без отдельного согласования:
- исправление технических багов без визуального изменения;
- обновление и очистка данных объявлений;
- подключение новых источников рынка;
- внутренняя логика фильтрации и сортировки, если внешний вид не меняется.

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
│   └── project-config.json
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

- `index.html` — только HTML-каркас приложения.
- `css/styles.css` — утверждённый внешний вид.
- `js/app.js` — запуск приложения и управление интерфейсом.
- `js/config.js` — public Supabase URL и publishable key для браузера.
- `js/supabase.js` — создание read-only Supabase client.
- `js/data/listings-repository.js` — data access layer и DB → domain mapper.
- `js/listings.js` — карточки объявлений, Matcha Score и breakdown.
- `js/filters.js` — фильтрация и сортировка.
- `js/storage.js` — локально добавленные пользователем объекты.
- `data/listings.json` — development fixture и migration/import source, не production database.
- `data/project-config.json` — централизованные критерии проекта.
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
