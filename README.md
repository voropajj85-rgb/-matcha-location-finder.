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
- `js/listings.js` — карточки объявлений, Matcha Score и breakdown.
- `js/filters.js` — фильтрация и сортировка.
- `js/storage.js` — локально добавленные пользователем объекты.
- `data/listings.json` — актуальная база рынка.
- `data/project-config.json` — централизованные критерии проекта.
- `assets/images/` — будущие изображения и превью.

## Данные

Рыночные предложения хранятся отдельно от UI в `data/listings.json` и обновляются из нескольких источников: Kleinanzeigen, Immowelt, ImmoScout24, Stadt München, сайты маклеров и прямые предложения.

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
