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

Рабочий контур:

```text
Target setup -> Discovery run -> Baseline/current comparison -> Очередь ревью -> Endpoint details -> Approve baseline
```

Ограничение текущего MVP: runner пока HTTP-only. Он не исполняет JavaScript в браузере, не проходит интерактивный login flow и не перехватывает Playwright network traffic. Это следующий технический слой.
