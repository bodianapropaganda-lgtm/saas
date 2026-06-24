# Target app: Java backend + React frontend

Это демонстрационное приложение-мишень для regression engine.

Оно показывает, как выглядел бы реальный проект клиента:

- backend на Java;
- frontend на React;
- API endpoints;
- две версии поведения: `v1` и `v2`;
- baseline до изменений;
- diff после изменений.

## Backend

Сейчас backend сделан на стандартном Java `HttpServer`, чтобы он запускался без Maven/Gradle.

Запуск вручную:

```powershell
cd target-app\backend
javac -encoding UTF-8 -d build\classes src\main\java\com\example\targetapp\TargetAppServer.java
java -cp build\classes com.example.targetapp.TargetAppServer --version v1 --port 8020
```

Для версии с изменениями:

```powershell
java -cp build\classes com.example.targetapp.TargetAppServer --version v2 --port 8020
```

## Frontend

React/Vite исходники лежат в:

```text
target-app/frontend
```

В текущей среде Node/npm не доступны, поэтому автоматическое демо пока использует HTML, который Java backend отдает на `/`. Это ограничение текущего runner: он пока не исполняет JavaScript как браузер.

Когда появится Playwright-runner, сценарий будет проверять уже настоящий React UI.

## Полный прогон

Из корня MVP:

```powershell
.\run_target_java_demo.ps1
```

Скрипт:

1. Компилирует Java backend.
2. Запускает `v1`.
3. Снимает baseline.
4. Запускает `v2`.
5. Снимает новый snapshot.
6. Генерирует отчет:

```text
reports/target-java-v2-report.html
```

