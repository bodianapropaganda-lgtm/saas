# React frontend стенда

Это исходники настоящего React/Vite frontend для демонстрационного приложения.

В текущей среде `node` и `npm` не найдены в PATH, поэтому автоматический прогон MVP использует HTML, который Java backend отдает на `/`. Как только Node будет доступен, frontend можно запустить отдельно:

```powershell
npm install
npm run dev
```

По умолчанию frontend ходит в Java backend:

```text
http://127.0.0.1:8020
```

Можно переопределить:

```powershell
$env:VITE_API_BASE_URL='http://127.0.0.1:8020'
npm run dev
```

