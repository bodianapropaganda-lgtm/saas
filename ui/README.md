# Product UI prototype

Статический прототип продуктовой консоли для discovery/regression сервиса.

Открыть:

```text
ui/index.html
```

Что показывает:

- выбор разделов продукта: обзор, цель сканирования, прогоны, очередь ревью, каталог endpoint, graph;
- настройку scan target: base URL, профиль авторизации, стартовые URL, seed API endpoints, policy, limits;
- историю baseline/current прогонов;
- summary последнего baseline и нового run;
- схему pages и API endpoints;
- статусы `Изменено`, `Ошибка`, `Удалено`;
- карточку выбранного endpoint/page справа;
- request/response headers;
- payload;
- response body;
- schema;
- diff summary.

Это не финальный SaaS UI, а первый clickable prototype, который показывает основной рабочий контур продукта:

```text
Target setup -> Discovery run -> Baseline/current comparison -> Очередь ревью -> Endpoint details
```
