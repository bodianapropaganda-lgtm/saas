# Autonomous Discovery: план реализации и переоценка рисков

## Новая формулировка продукта

Продукт запускается внутри контролируемой среды клиента:

- staging/test стенды;
- тестовые креденшалы;
- тестовые данные;
- allowlist доменов;
- лимиты нагрузки;
- возможность сбросить состояние стенда перед прогоном.

Поэтому главная идея меняется:

```text
Не “написать автотесты руками”,
а “автоматически построить карту поведения приложения и сравнивать ее между релизами”.
```

Продуктовая формула:

```text
Target environment -> Discovery graph -> Baseline -> Release run -> Full-stack diff -> Review -> New baseline
```

## Что уже добавлено в MVP

В проект добавлен первый `Discovery Mode`:

```text
discover.py
discovery/target-java.json
run_discovery_demo.ps1
run_discovery_demo.bat
```

Он умеет:

- стартовать с seed URL;
- обходить same-origin страницы по ссылкам;
- собирать HTML/text/tag snapshots;
- вытаскивать API-подсказки из `data-api`;
- делать snapshot API endpoints;
- строить graph edges: `page -> link/api-hint -> target`;
- сравнивать discovery graph между `v1` и `v2`;
- генерировать HTML/JSON report.

Это еще не полноценный браузерный crawler, но это первый рабочий слой идеи “сам исследует стенд”.

## Как должен выглядеть целевой workflow

1. Пользователь создает project.
2. Указывает environment:
   - base URL;
   - test credentials;
   - allowed domains;
   - crawl budget;
   - rate limits;
   - destructive actions policy;
   - optional reset hook.
3. Сервис запускает discovery.
4. Сервис строит graph:
   - pages;
   - actions;
   - forms;
   - endpoints;
   - request/response examples;
   - schemas;
   - UI states;
   - console/network errors.
5. Команда утверждает baseline.
6. После релиза сервис повторяет discovery.
7. Review UI показывает:
   - что появилось;
   - что исчезло;
   - какие схемы изменились;
   - какие UI состояния изменились;
   - какие endpoints начали падать;
   - какие действия перестали приводить к ожидаемому состоянию.

## Этапы реализации

### Этап 1. Deterministic Snapshot Engine

Уже частично сделано.

Цель:

- snapshot pages/API;
- normalize dynamic data;
- compare baseline vs new run;
- generate report.

Риски:

- шум в данных;
- плохая нормализация;
- слишком крупные diff'ы.

### Этап 2. Static Discovery Graph

Текущий следующий слой.

Цель:

- обходить ссылки;
- собирать формы;
- собирать `data-api` и seed endpoints;
- строить graph.

Ограничение:

- не исполняет JS;
- не видит XHR/fetch, если endpoint не указан в HTML или config.

### Этап 3. Browser Discovery Runner

Самый важный следующий шаг.

Технология:

- Playwright;
- Chromium worker;
- network interception;
- screenshot/DOM/a11y snapshots;
- console/page errors;
- action exploration.

Что добавляется:

- реальные React/Vue/Angular приложения;
- JS execution;
- network capture;
- browser state;
- login flow;
- cookies/session/localStorage.

### Этап 4. Action Exploration

Цель:

- кликать безопасные элементы;
- заполнять формы тестовыми данными;
- отслеживать переходы;
- связывать action -> network -> UI state.

Нужны политики:

- allowed selectors;
- denied selectors;
- allowed methods;
- max actions per page;
- max depth;
- max requests per minute.

### Этап 5. Review UI и Baseline Governance

Цель:

- человек принимает или отклоняет изменения;
- expected change попадает в новый baseline;
- шум превращается в ignore rule;
- баг превращается в issue.

Критично:

- без хорошего review UX продукт будет сложно использовать.

## Переоценка рисков

### 1. Риск “destructive actions” стал ниже, но не исчез

Поскольку продукт работает на тестовых стендах, POST/PUT/DELETE допустимы.

Но все равно нужны:

- reset hooks;
- test fixtures;
- action allowlist;
- dry-run/read-only mode;
- запрет платежей, email/sms, внешних интеграций по умолчанию.

### 2. Rate limits и нагрузка стали одним из главных рисков

Crawler может создать слишком много запросов.

Нужно с самого начала:

- global RPS limit;
- per-endpoint cooldown;
- exponential backoff;
- retry budget;
- max parallel browsers;
- max pages/actions per run;
- дедупликация одинаковых requests.

### 3. State explosion

У приложения много страниц, ролей, фильтров, форм и состояний.

Решение:

- crawl budget;
- role-based runs;
- seed URLs;
- sitemap/OpenAPI import;
- page/action fingerprinting;
- приоритизация новых/изменившихся зон.

### 4. Auth и роли

Без ролей discovery будет неполным.

Нужно:

- несколько test accounts;
- login сценарии;
- secrets storage;
- session reuse;
- 2FA bypass для test env.

### 5. Ложные изменения

Это главный продуктовый риск.

Нужно:

- normalizers;
- dynamic field detection;
- ignore rules;
- visual thresholds;
- endpoint schema tolerance;
- stable grouping in reports.

### 6. PII и секреты

Даже на test стендах могут быть токены и персональные данные.

Нужно:

- masking headers;
- masking JSON paths;
- artifact retention policy;
- encryption at rest;
- self-hosted runner для чувствительных клиентов.

## Рекомендуемый ближайший roadmap

1. Довести текущий `discover.py` до стабильного CLI.
2. Добавить Playwright-based runner.
3. Научиться логиниться в target app.
4. Перехватывать network traffic.
5. Строить graph `page -> action -> endpoint -> response -> UI`.
6. Добавить лимиты нагрузки и retry policy.
7. Сделать минимальный Review UI.

## Самый важный вывод

После уточнения, что продукт запускается на внутренних тестовых стендах клиента, идея стала сильнее.

Это уже не “опасный crawler по чужим сайтам”, а:

```text
controlled autonomous regression discovery for internal environments
```

Главная ценность:

```text
Сервис помогает компании понять, что реально есть в продукте,
какие UI/API связи существуют,
и что изменилось после релиза.
```

