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

1. **Windows**
2. **Node.js 20+**
3. Nätverksåtkomst till Azure DevOps Server / TFS
4. Ett konto som har rättigheter i den miljö du ansluter mot

## Installation

Klona repo:t och kör en gång i repo-roten:

```powershell
npm install
```

Detta är normalt ett engångssteg. Kör det igen om `package.json` eller `package-lock.json` ändras.

## Uppdatera pluginet

Om du redan har pluginet lokalt och en ny version har pushats till GitHub, uppdatera din lokala klon i repo-roten:

```powershell
git pull
npm install
```

`npm install` behövs främst när beroenden har ändrats. Om bara koden har ändrats räcker ofta `git pull`.

## Normal användning

Servern startas normalt **automatiskt** av MCP-klienten via `.mcp.json` eller `mcp-config.json`.

Du behöver alltså normalt **inte** starta servern manuellt varje dag.

Manuell start behövs bara för felsökning eller lokal utveckling:

```powershell
npm run start --silent
```

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

## Visual Studio 2022

Lägg en `.mcp.json` i repo-roten i det projekt där du vill använda servern.

Exempel:

```json
{
  "inputs": [],
  "servers": {
    "ado-onprem": {
      "type": "stdio",
      "command": "cmd",
      "args": [
        "/c",
        "npm",
        "run",
        "start",
        "--silent",
        "--prefix",
        "C:\\path\\to\\Exor-devops-onprem-mcp"
      ],
      "env": {
        "ADO_BASE_URL": "http://server:8080/tfs/CollectionName",
        "ADO_DEFAULT_PROJECT": "ProjectName",
        "ADO_API_VERSION": "5.1",
        "ADO_COMMENTS_API_VERSION": "5.1-preview.3",
        "ADO_USE_DEFAULT_CREDENTIALS": "true"
      }
    }
  }
}
```

Använd en separat `.mcp.json` i varje repo om olika projekt ska koppla mot olika collections eller defaultprojekt.

## GitHub Copilot CLI

För Copilot CLI lägger du en lokal konfig här:

```text
C:\Users\<DITT_ANVÄNDARNAMN>\.copilot\mcp-config.json
```

Exempel finns i:

```text
examples\copilot-cli-mcp-config.json
```

## Kommentarformat

Alla kommentarer som skapas via pluginen börjar med:

`AI-genererad kommentar:`

Sedan kommer alltid en tom rad innan titel och innehåll.

För PR-kodgranskning används normalt titeln:

`Kodgranskning av AI`

## Kodgranskning i PR

Du kan be agenten granska en PR och posta resultatet i PR:n.

Exempel:

- `Granska PR 123 i repo Backend och posta en kodgranskning i PR:n`
- `Läs diffen i PR 456 och skriv en sammanfattande kommentar`

Granskningen fokuserar på:

- buggar och logiska fel
- säkerhetsrisker
- ohanterade exceptions
- brister i felhantering
- onödig eller misstänkt kod

## Kodgranskning från work item

Om commits och pull requests är länkade till ett work item kan agenten utgå från work itemet, granska associerad kod och posta resultatet i work itemet.

Abandoned pull requests ignoreras. Completed pull requests och direkta commit-länkar används som underlag.

Exempel:

- `Granska associerad kod för work item 35605 och posta resultatet som kommentar i work itemet`
- `Hitta completed PR:er kopplade till work item 35605 och skriv en kodgranskning i ärendet`

## Kan AI posta som en annan användare?

Normalt inte via en enkel inställning i config.

Kommentarer skapas som den autentiserade identiteten:

- med `ADO_USE_DEFAULT_CREDENTIALS=true` blir det Windows-användaren som kör processen
- med PAT/basic auth blir det kontot bakom den autentiseringen

Om AI ska posta som ett annat konto behöver servern köras med det kontots credentials.
