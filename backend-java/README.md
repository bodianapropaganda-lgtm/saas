# Regression Graph Backend: Java Migration

This module is the Java/Spring Boot replacement for the old Python product server.

Stack:

- Java 25
- Spring Boot 4.1
- Spring WebMVC
- Jackson
- Java `HttpClient`
- jsoup for HTML page discovery

Install local portable tools:

```powershell
cd ..
.\install_java_tools.ps1
```

On Windows, the launcher prefers `C:\codex-tools\regression-graph` for Java/Maven because some JDK builds can fail when `JAVA_HOME` contains non-ASCII path segments.

Run:

```powershell
cd backend-java
mvn spring-boot:run
```

The server starts on `http://127.0.0.1:8765` and serves the existing UI from `../ui`.

Or from the project root:

```powershell
.\run_product_ui_java.bat
```

Current migration scope:

- Product API: `/api/state`, `/api/discovery/run`, `/api/baseline/approve`, `/api/runs/delete`
- UI routes: `/`, `/target`, `/runs`, `/review`, `/catalog/...`, `/actions`, `/graph`
- Static files: `/app.js`, `/styles.css`
- Artifacts: `/artifacts/{runId}/{artifactName}`
- Storage V2 index model
- Java HTTP discovery runner for pages and seed API endpoints
- Java graph diffing compatible with the current UI

Next migration scope:

- Browser + Network runner on Playwright Java
- Action crawling
- Auth profiles
- Persistent seed endpoint expectations on the server side
