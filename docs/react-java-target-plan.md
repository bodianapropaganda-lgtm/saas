# Демонстрационный React + Java проект

## Что уже сделано

В проекте уже есть `target-app`:

```text
target-app/
  backend/   запускаемый Java microservice
  frontend/  React/Vite исходники
```

Backend сейчас сделан без внешних зависимостей на стандартном Java `HttpServer`. Это позволяет запускать демо на машине, где есть `java` и `javac`, но нет Gradle/Maven/Node.

Frontend лежит как настоящий React-проект, но автоматический regression-прогон пока не запускает Vite, потому что текущий runner не исполняет JavaScript. Следующий шаг - добавить Playwright-runner.

## Зачем он нужен

Нам нужен не настоящий коммерческий проект, а контролируемая мишень для регрессионного тестирования.

Задача стенда:

- показать, что система видит frontend-изменения;
- показать, что система видит backend/API-изменения;
- показать, что система видит поломку контракта;
- показать, что один и тот же пользовательский сценарий можно прогонять после разных релизов.

## Домен

Выбран мини e-commerce / SaaS catalog.

Почему:

- всем понятно, что такое список товаров, цена, корзина и checkout;
- легко показать связь backend -> frontend;
- легко создать намеренные регрессии;
- легко объяснить бизнес-ожидания.

## Структура

```text
target-app/
  backend/
    src/main/java/com/example/targetapp/
      TargetAppServer.java
  frontend/
    package.json
    index.html
    src/
      main.jsx
      api.js
      styles.css
```

## Backend

Стек текущего runnable-стенда:

- Java;
- стандартный `HttpServer`;
- CORS для локального React;
- без базы данных;
- без внешних зависимостей.

Endpoints:

```text
GET /
GET /api/health
GET /api/products
GET /api/products/{id}
GET /api/cart/summary
```

Данные хранятся прямо в Java-коде. Позже этот backend можно заменить на Spring Boot, если нужно показать более enterprise-like стек с контроллерами, DTO, OpenAPI и Maven/Gradle.

## Frontend

Стек:

- React;
- Vite;
- обычный CSS;
- fetch API.

Основной файл:

```text
target-app/frontend/src/main.jsx
```

React UI ходит в Java API и рисует:

- заголовок каталога;
- версию backend;
- метрики: products, in stock, cart total;
- карточки товаров.

## Версия v1

Ожидаемое корректное поведение:

- `/api/products` возвращает 10 товаров;
- у каждого товара есть `id`, `title`, `sku`, `price`, `inStock`;
- `price` всегда number;
- frontend показывает 10 карточек;
- cart summary считает сумму `649.00`;
- health endpoint возвращает `version: v1`.

## Версия v2

Намеренные изменения для демонстрации:

- `/api/products` возвращает 8 товаров;
- у одного товара `price` становится строкой;
- у одного товара меняется title;
- на странице меняется заголовок;
- счетчик показывает 8 товаров;
- cart summary меняет subtotal и shipping threshold;
- health endpoint возвращает `version: v2`.

## Что поймал regression engine

В проверочном прогоне система нашла 6 отличий:

- `home-page.page.tagCounts`: стало меньше карточек и текстовых элементов;
- `home-page.page.visibleText`: изменились заголовок, промо-текст, счетчики, товары;
- `products-api.api.schema`: `price` стал `float|string`;
- `products-api.api.body`: изменились count, items, title и version;
- `cart-summary-api.api.body`: изменились itemsCount, subtotal, threshold и version;
- `health-api.api.body`: изменилась version.

## Команда запуска

Из корня MVP:

```powershell
.\run_target_java_demo.ps1
```

Итоговый отчет:

```text
reports/target-java-v2-report.html
```

## Важный вывод

React + Java стенд теперь существует как реальный код. Его роль - не заменить regression engine, а стать тестовой витриной для него.

