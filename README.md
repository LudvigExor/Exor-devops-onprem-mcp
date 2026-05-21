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

Vid uppdatering:

```powershell
git pull
npm install
npm run build
```

## Snabbaste vägen

Det enklaste är oftast att:

1. kopiera `examples\repo-root.mcp.json` till målrepoets `.mcp.json`
2. ändra sökvägen till din plugin-mapp
3. ändra `ADO_BASE_URL` och eventuellt `ADO_DEFAULT_PROJECT`

Om du vill använda **(experimental)** automatisk PR-granskning kan du också kopiera:

```text
examples\copilot-cli-mcp-config.json
```

till din lokala klientmapp, till exempel:

```text
C:\Users\<du>\.copilot\mcp-config.json
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
