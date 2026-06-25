# План миграции backend на Java

Цель: полностью уйти от Python backend и оставить Java/Spring Boot как единственный сервер продукта.

## Выбранный стек

- Java 25 как стабильная LTS-линия для продукта.
- Spring Boot 4.1.x.
- Spring WebMVC для REST API и отдачи UI.
- Jackson для JSON graph/storage/diff.
- Java `HttpClient` для базового HTTP discovery.
- jsoup для HTML parsing.
- Playwright Java на следующем этапе для Browser + Network runner.

## Что уже перенесено

- Product API:
  - `GET /api/state`
  - `POST /api/discovery/run`
  - `POST /api/baseline/approve`
  - `POST /api/runs/delete`
- UI routing:
  - `/`, `/target`, `/runs`, `/review`, `/catalog/*`, `/actions`, `/graph`
- Static UI serving from existing `ui/`.
- Artifact/report serving.
- Storage V2 index.
- Graph diffing.
- Basic Java HTTP discovery:
  - pages
  - links
  - visible text
  - tag counts
  - seed API endpoints
  - response artifacts

## Что ещё надо перенести

1. Browser + Network runner на Playwright Java.
2. Action crawling и guardrails.
3. Auth profiles и секреты.
4. Серверное хранение seed expectations.
5. Нормальная база вместо файлового storage.
6. Очередь задач для долгих прогонов.

## Локальное ограничение сейчас

На текущей машине обнаружена Java 18, а `mvn` и `gradle` не установлены. Новый backend заложен под Java 25 и Spring Boot 4.1, поэтому для запуска надо поставить JDK 25 и Maven или добавить Maven Wrapper.
