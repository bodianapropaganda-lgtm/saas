# Java backend стенда

Это минимальный Java microservice без внешних зависимостей. Он использует стандартный `com.sun.net.httpserver.HttpServer`, чтобы демо можно было запустить без Gradle/Maven.

## Запуск

```powershell
javac -encoding UTF-8 -d build/classes src/main/java/com/example/targetapp/TargetAppServer.java
java -cp build/classes com.example.targetapp.TargetAppServer --version v1 --port 8020
```

Версия с намеренными изменениями:

```powershell
java -cp build/classes com.example.targetapp.TargetAppServer --version v2 --port 8020
```

## Endpoints

```text
GET /
GET /api/health
GET /api/products
GET /api/products/{id}
GET /api/cart/summary
```

