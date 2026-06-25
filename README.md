# MVP full-stack регрессионного тестирования

Это минимальная рабочая версия ядра для идеи SaaS-продукта:

- снимает слепок frontend-страницы: HTML, видимый текст, ссылки, формы, ассеты, структуру тегов;
- снимает слепок backend/API: JSON-ответы и примерную JSON-схему;
- нормализует шумные значения: timestamps, request ids, generated ids;
- сравнивает новый прогон с утвержденным baseline;
- генерирует HTML-отчет для ревью;
- позволяет принять новый прогон как новый baseline.

Текущая версия специально написана только на стандартной библиотеке Python, чтобы ее можно было запустить почти в любой среде без установки зависимостей. В production-версии слой HTTP-capture должен быть заменен на Playwright-runner, но модель останется той же:

```text
Сценарий -> Слепок -> Нормализация -> Baseline -> Новый прогон -> Diff -> Ревью -> Approve
```

## Что сейчас находится в проекте

```text
regress.py              CLI-ядро: snapshot / approve / compare
demo_app.py             Мини-приложение для демонстрации frontend + API
run_demo.ps1            Быстрый запуск полной демонстрации
run_target_java_demo.ps1
                        Полный прогон на Java + React стенде
scenarios/demo.json     Пример сценария проверок
scenarios/target-java.json
                        Сценарий для Java + React стенда
baselines/demo/         Утвержденный эталонный слепок
target-app/             Демонстрационное приложение-мишень
runs/                   Отдельные прогоны
reports/                HTML и JSON отчеты
```

## Быстрый запуск демо

Открой PowerShell в этой папке и выполни:

```powershell
.\run_demo.ps1
```

Скрипт сам:

1. Запустит демо-приложение версии `v1`.
2. Снимет baseline.
3. Утвердит baseline как эталон.
4. Запустит измененную версию `v2`.
5. Снимет новый слепок.
6. Сравнит `v2` с baseline.
7. Сгенерирует отчет:

```text
reports/v2-report.html
```

## Ручной запуск

Терминал 1:

```powershell
python demo_app.py --version v1 --port 8010
```

Терминал 2:

```powershell
python regress.py snapshot --scenario scenarios/demo.json --base-url http://127.0.0.1:8010 --out runs/baseline
python regress.py approve --run runs/baseline --baseline baselines/demo
```

Останови первый сервер и запусти измененную версию:

```powershell
python demo_app.py --version v2 --port 8010
```

Терминал 2:

```powershell
python regress.py snapshot --scenario scenarios/demo.json --base-url http://127.0.0.1:8010 --out runs/v2
python regress.py compare --baseline baselines/demo --run runs/v2 --report reports/v2-report.html
```

## Что должно появиться в отчете

В текущей демонстрации версия `v2` специально отличается от `v1`.

Отчет должен показать:

- на странице изменился заголовок;
- поменялся текст промо-блока;
- количество товаров на frontend изменилось с 10 до 8;
- структура HTML изменилась: стало меньше карточек, заголовков и цен;
- `/api/products` вернул другой JSON;
- у одного товара поле `price` сменило тип с числа на строку;
- из API исчезли два товара;
- `/api/health` вернул новую версию приложения.

Ключевая идея: система не решает сама, баг это или ожидаемое изменение. Она показывает отличия человеку. QA, разработчик или product owner принимает решение:

- принять изменение как новую норму;
- отклонить как баг;
- добавить правило игнорирования для шумного поля;
- усилить сценарий новым assert-правилом.

## Команды CLI

Снять слепок:

```powershell
python regress.py snapshot --scenario scenarios/demo.json --base-url http://127.0.0.1:8010 --out runs/run1
```

Утвердить слепок как baseline:

```powershell
python regress.py approve --run runs/run1 --baseline baselines/demo
```

Сравнить новый прогон с baseline:

```powershell
python regress.py compare --baseline baselines/demo --run runs/run2 --report reports/report.html
```

## Autonomous Discovery Mode

После уточнения идеи добавлен первый discovery-режим:

```text
discover.py
discovery/target-java.json
run_discovery_demo.bat
run_discovery_demo.ps1
```

Он демонстрирует следующий слой продукта: сервис не только запускает заранее описанный сценарий, а сам начинает со стартовой страницы, обходит ссылки, собирает API-подсказки, строит graph и сравнивает его между релизами.

Запуск:

```powershell
.\run_discovery_demo.bat
```

Что делает команда:

1. Компилирует Java target app.
2. Запускает `v1`.
3. Делает discovery baseline.
4. Запускает `v2`.
5. Делает второй discovery run.
6. Сравнивает discovery graph.
7. Генерирует отчет:

```text
reports/discovery-target-java-v2-report.html
```

Подробный план и переоценка рисков:

```text
docs/autonomous-discovery-plan.md
```

## Product UI

Добавлен локальный product UI, подключенный к core-ядру MVP:

```text
product_server.py
run_product_ui.bat
run_product_ui.ps1
ui/index.html
```

Запуск:

```powershell
.\run_product_ui.bat
```

Скрипт поднимает локальный сервер, выбирает свободный порт в диапазоне `8765..8775` и открывает браузер.

UI теперь не просто показывает моковые данные, а работает с реальными артефактами ядра:

- разделы продуктовой консоли: обзор, цель сканирования, прогоны, очередь ревью, каталог endpoint, graph;
- чтение `runs/*/discovery.json` и `baselines/*/discovery.json`;
- построение схемы pages -> endpoint из реального discovery graph;
- graph-карту с pan/zoom, режимом фокуса и кнопкой сброса масштаба;
- сравнение baseline/current через `discover.compare_graphs`;
- просмотр деталей endpoint/page: response, schema, payload, diff;
- просмотр причины ошибки failed run в правой панели;
- запуск нового discovery из формы target setup;
- утверждение текущего run как нового baseline.
- удаление ненужных результатов прогона из `runs/`.

### Storage V2

Добавлен первый слой нормальной продуктовой модели:

```text
storage_v2.py
.runtime/storage-v2/index.json
.runtime/storage-v2/runs/*.json
.runtime/storage-v2/baselines/*.json
```

Старые артефакты `runs/`, `baselines/` и `reports/` остаются источником тяжелых данных: HTML, JSON responses, discovery graph и отчеты. Storage V2 хранит индекс продукта поверх этих файлов:

- project;
- target;
- run;
- baseline;
- ссылки на report/error/artifacts;
- статус жизненного цикла run: `running`, `completed`, `failed`.

Это нужно, чтобы UI не угадывал состояние по папкам, а работал с явной моделью. Следующий логичный шаг - заменить JSON-файлы на SQLite/PostgreSQL, но текущий формат уже дает версионированную схему и не требует дополнительных зависимостей.

Если baseline для выбранного сайта еще не существует или относится к другому `Base URL`, первый успешный run автоматически утверждается как baseline и не показывает ложные diff.

Если открыть `ui/index.html` напрямую как файл, UI покажет предупреждение: для живого режима нужен `product_server.py`.

Для проверки внешнего сайта укажи его `Base URL`, оставь стартовый URL `/` и очисти seed API endpoints, если известных API нет. Первый запуск лучше делать маленьким: `Максимум pages = 3..5`, `Max depth = 1`, `Timeout одного запроса = 5 sec`, `Общий timeout = 300 sec`. Если запуск из Codex-сессии падает с `WinError 10013`, запусти `run_product_ui.bat` обычным двойным кликом или из обычного PowerShell: в Codex-среде внешние socket-подключения могут быть заблокированы sandbox-политикой.

## Формат сценария

Сценарий описывает, какие страницы и API endpoints надо проверить:

```json
{
  "name": "demo-commerce",
  "checks": [
    { "id": "home-page", "type": "page", "path": "/" },
    { "id": "products-api", "type": "api", "path": "/api/products" },
    { "id": "health-api", "type": "api", "path": "/api/health" }
  ]
}
```

В текущей версии сценарий статический. В следующей версии сценарий должен записываться через браузер:

```text
open page -> click -> type -> wait -> capture UI -> capture network -> save snapshot
```

## Почему пока нет AI

Это осознанное решение.

На первом этапе важнее доказать не “умность”, а надежный детерминированный контур:

- одинаковый вход дает одинаковый результат;
- все отличия объяснимы;
- отчет можно показать разработчику;
- baseline можно версионировать;
- ложный шум можно постепенно убирать правилами.

AI можно добавить позже как дополнительный слой:

- объяснить diff простыми словами;
- предложить ignore-rule;
- сгруппировать похожие изменения;
- подсказать возможную причину поломки.

Но ядро должно работать без AI.

## Реальный стенд: Java backend + React frontend

Сейчас в проект добавлен отдельный `target-app`.

Это уже не просто план, а реальный код приложения-мишени:

```text
target-app/
  backend/   Java microservice
  frontend/  React/Vite исходники
```

Backend сейчас сделан на стандартном Java `HttpServer`, чтобы его можно было скомпилировать и запустить без Gradle/Maven. Это сознательный практический компромисс: на этой машине есть `java` и `javac`, но нет `node`, `npm` и `gradle` в PATH.

Frontend лежит как обычный React/Vite проект:

```text
target-app/frontend/src/main.jsx
target-app/frontend/src/api.js
target-app/frontend/src/styles.css
```

Текущий regression runner пока не исполняет JavaScript в браузере, поэтому автоматический прогон снимает HTML-страницу, которую Java backend отдает на `/`, и API endpoints. Когда появится Playwright-runner, он будет проверять уже настоящий React UI после выполнения JS.

## Как запустить Java + React стенд через regression engine

Из корня MVP:

```powershell
.\run_target_java_demo.bat
```

Или напрямую через PowerShell:

```powershell
.\run_target_java_demo.ps1
```

Скрипт делает полный цикл:

1. Компилирует Java backend.
2. Запускает приложение версии `v1`.
3. Снимает baseline.
4. Утверждает baseline как эталон.
5. Запускает приложение версии `v2`.
6. Снимает новый snapshot.
7. Сравнивает `v2` с baseline.
8. Генерирует отчет:

```text
reports/target-java-v2-report.html
```

Подробный лог запуска сохраняется в:

```text
logs/
```

## Что именно меняется между v1 и v2

Версия `v1`:

- API `/api/products` возвращает 10 товаров;
- поле `price` всегда число;
- frontend показывает 10 карточек;
- checkout summary показывает правильную сумму.

Версия `v2`:

- API возвращает 8 товаров вместо 10;
- у одного товара `price` становится строкой;
- один товар переименован;
- frontend показывает другой счетчик;
- изменяется заголовок и промо-текст;
- cart summary меняет subtotal и free shipping threshold.

Regression MVP после этого показывает:

- frontend diff;
- API body diff;
- API schema diff;
- cart summary diff;
- health/version diff;
- связь между количеством товаров в API и количеством карточек на странице.

В последнем проверочном прогоне система нашла 6 отличий, включая критичное изменение схемы:

```text
products-api.price: float -> float|string
```

Это именно тот тип backend-регрессии, который обычный визуальный тест может пропустить.

## Рекомендуемый следующий технический шаг

Следующий практический шаг - заменить HTTP-only capture на Playwright-runner:

1. Открывать React frontend в браузере.
2. Ждать загрузки данных из Java backend.
3. Снимать screenshot, DOM, visible text и network traffic.
4. Коррелировать `/api/products.count` с количеством `.product-card`.
5. Показывать единый full-stack отчет.

После этого стенд станет уже совсем близок к реальной демонстрации SaaS-продукта.
