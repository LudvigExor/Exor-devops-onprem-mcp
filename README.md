# Exor DevOps Onprem MCP

MCP-server för **Azure DevOps Server / TFS on-prem**.

## Vad den används till

Servern gör det möjligt för Copilot/AI-agenter att:

- läsa work items, repositories, pull requests, commits, diffar och builds
- posta kommentarer i work items
- posta kodgranskning som kommentar i pull requests
- hitta associerad kod från ett work item och posta kodgranskningen i work itemet

Servern får **inte**:

- ändra work item-fält
- approve:a eller decline:a pull requests
- sätta vote
- ändra reviewers
- merge:a eller på annat sätt ändra PR-status

## Krav

- Windows
- Node.js 20+
- Nätverksåtkomst till Azure DevOps Server / TFS
- Ett konto som har rättigheter i miljön

## Installation

Klona repo:t och kör:

```powershell
npm install
npm run build
```

Om du använder **Copilot CLI** och vill ha den inbyggda `/devops`-skillen kan du installera pluginet via marketplace:

```powershell
copilot plugin marketplace add LudvigExor/Exor-devops-onprem-mcp
copilot plugin install azure-devops-onprem@exor-devops-onprem
```

Det här steget krävs för `/devops`-skillen.

När pluginet väl är installerat kan det uppdateras med:

```powershell
copilot plugin update azure-devops-onprem
```

För lokal utveckling eller test går det fortfarande att installera direkt från sökväg:

```powershell
copilot plugin install C:\path\to\Exor-devops-onprem-mcp
```

Direkt installation från lokal sökväg är främst för utveckling och test.

### Enkelt att komma igång

Plugininstallationen behövs för `/devops`-skillen. Själva Azure DevOps-verktygen använder du fortfarande enklast via repoets `.mcp.json` eller en user-level `mcp-config.json`.

Vid uppdatering - i pluginets sökväg kör du:

```powershell
git pull
npm install
npm run build
```

## Kom igång

Det enklaste är oftast att:

1. kopiera `examples\.mcp.json` till projektets root - måste heta `.mcp.json`
2. ändra sökvägen i .mcp.json-filen till din mapp där pluginet lagrats
3. ändra `ADO_BASE_URL` och eventuellt `ADO_DEFAULT_PROJECT` (till devops on prem URL och projectname i devops)
4. lägg `.mcp.json` i projektets `.gitignore`

Om du vill använda **(experimental)** automatisk PR-granskning kan du också kopiera:

```text
examples\copilot-cli-mcp-config.json
```

till din lokala klientmapp, till exempel (lägg även i mapparna .claude, .codex, .cursor beroende på vilka du vill använda pluginen i):

```text
C:\Users\<din user>\.copilot\mcp-config.json
```

## Setup i ett projekt (valfritt)

Om du hellre vill låta pluginet skapa grundfilerna kan du köra:

```powershell
node C:\path\to\Exor-devops-onprem-mcp\dist\index.js setup
```

Kör du kommandot från plugin-repot i stället för målrepoet:

```powershell
npm run setup:prod -- --repo-root C:\path\to\your-project
```

Det skapar eller uppdaterar repoets `.mcp.json` och ett hanterat block i `AGENTS.md`.

Om du även vill att setup ska skriva lokal klientkonfig:

```powershell
npm run setup:prod -- --repo-root C:\path\to\your-project --write-user-config true
```

Setup skriver inte autentiseringshemligheter till repoets `.mcp.json`. Om du behöver PAT, basic auth eller eget auth-header ska det ligga i användarens lokala miljö eller klientkonfig, inte i projektets repo.

## Personlig klientkonfig

Personliga inställningar för automatisk PR-kodgranskning ska ligga i **din egen lokala MCP-config**, inte i projektets repo.

Använd:

- `pluginSettings.azure-devops-onprem.automaticCodeReviewPR: true|false`
- `pluginSettings.azure-devops-onprem.automaticCodeReviewPRCommand` bara om du vill skriva över standardbeteendet med ett eget kommando

Standardbeteendet använder den lokalt installerade **GitHub Copilot CLI** för att generera review-texten.

När `automaticCodeReviewPR=true` använder pluginet en hanterad `pre-push`-hook för att försöka trigga review efter push och närliggande PR-skapande.

## Konfiguration

Servern läser sin anslutning från miljövariabler:

- `ADO_BASE_URL`
- `ADO_DEFAULT_PROJECT`
- `ADO_API_VERSION`
- `ADO_COMMENTS_API_VERSION`
- `ADO_USE_DEFAULT_CREDENTIALS`
- `ADO_PAT`
- `ADO_BASIC_USERNAME`
- `ADO_BASIC_PASSWORD`
- `ADO_AUTH_HEADER`

Vanligt minimum är:

- `ADO_BASE_URL`
- någon form av autentisering

## Kodgranskning i PR

Du kan be agenten kodgranska en PR och posta resultatet i PR:n.

Om du använder Copilot CLI och har installerat pluginet är det ofta effektivare att börja prompten med `/devops`, till exempel `/devops kodgranska min senaste PR`. Det fungerar även utan `/devops`, men skillen gör det tydligare att rätt DevOps-flöde och plugin ska användas.

Exempel:

- `Granska PR 123 i repo Backend och posta en kodgranskning i PR:n`
- `Läs diffen i PR 456 och skriv en sammanfattande kommentar`

Granskningen fokuserar på buggar, logiska fel, säkerhetsrisker, ohanterade exceptions, valideringsbrister och misstänkt kod.

Om PR:n har relaterade work items vägs den kontexten också in i granskningen.

## Kodgranskning från work item

Om commits och pull requests är länkade till ett work item kan agenten utgå från work itemet, granska associerad kod och posta resultatet i work itemet.

Exempel:

- `Granska associerad kod för work item 35605 och posta resultatet som kommentar i work itemet`
- `Hitta completed PR:er kopplade till work item 35605 och skriv en kodgranskning i ärendet`

## Identitet för kommentarer

Kommentarer skapas som den autentiserade identiteten:

- med `ADO_USE_DEFAULT_CREDENTIALS=true` blir det Windows-användaren som kör processen
- med PAT/basic auth blir det kontot bakom autentiseringen
