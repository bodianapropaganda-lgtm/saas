# Product UI

Это уже не только статический прототип, а UI, подключенный к локальному core-ядру MVP.

Запуск:

```powershell
.\run_product_ui.bat
```

Скрипт сам найдет свободный порт в диапазоне `8765..8775`, поднимет `product_server.py` и откроет браузер.

Что UI делает через backend:

- читает реальные `runs/*/discovery.json`;
- читает утвержденный baseline из `baselines/*/discovery.json`;
- строит каталог endpoint и graph из фактического discovery graph;
- показывает diff между baseline и последним связанным run;
- открывает HTML report из `reports/`;
- запускает новый discovery через `/api/discovery/run`;
- может принять текущий run как baseline через `/api/baseline/approve`.
- может удалить ненужный run из `runs/` через `/api/runs/delete`.

Рабочий контур:

```text
Target setup -> Discovery run -> Baseline/current comparison -> Очередь ревью -> Endpoint details -> Approve baseline
```

Ограничение текущего MVP: runner пока HTTP-only. Он не исполняет JavaScript в браузере, не проходит интерактивный login flow и не перехватывает Playwright network traffic. Это следующий технический слой.

## Проверка внешнего сайта

В форме "Цель сканирования" можно указать внешний `Base URL`, например `https://example.com`, оставить стартовый URL `/` и очистить seed API endpoints. Текущий runner будет обходить только страницы и GET endpoint, которые найдет из HTML.

Рекомендуемый первый запуск для публичного сайта:

- `Максимум pages`: `3` или `5`;
- `Max depth`: `1`;
- `Лимит запросов`: `300-500 ms`;
- `Timeout одного запроса`: `5 sec`;
- `Общий timeout`: `300 sec`;
- seed API endpoints оставить пустыми, если API заранее неизвестны.

Если такой прогон прошел, scope можно постепенно расширять.

Если UI запущен из Codex-сессии и внешний запуск падает с `WinError 10013`, это обычно означает, что исходящий socket заблокирован sandbox/Windows-политикой. Для проверки своего сайта нужно остановить сервер и запустить `run_product_ui.bat` обычным двойным кликом или из обычного PowerShell вне Codex.
