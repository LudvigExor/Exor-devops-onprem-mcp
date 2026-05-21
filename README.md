# Exor DevOps Onprem MCP

Praktisk guide för att komma igång med MCP-servern mot **Azure DevOps Server on-prem**.

## Vad detta är

Detta är en fristående MCP-server för att koppla upp AI-agenter till en Devops On-premise setup:

Funktioner:
- läsa work items
- posta implementation plans som kommentarer på work items
- läsa pull requests, commits och diff
- posta AI-granskning som kommentar i pull requests
- Läsa repositories/sprintar
- pull requests
- builds

- Exempel prompt: "Felsök bugg med ID 12345 och posta lösningsförslag i ärendet"
- Exempel prompt: "Granska PR 123, leta efter buggar och posta en kodgranskning i PR:n"

Servern fungerar mot **Azure DevOps Server / TFS on-prem** och kan köras med:

- Windows Integrated Authentication
- PAT
- basic auth
- färdig `Authorization`-header

## Krav

Detta måste finnas på datorn:

1. **Windows**
2. **Node.js 20+**
3. Nätverksåtkomst till Azure DevOps Server / TFS
4. Ett konto som har rättigheter i den server du ansluter mot

## Miljövariabler

Servern läser anslutning och autentisering från miljövariabler:

- `ADO_BASE_URL` - collection-URL till Azure DevOps Server
- `ADO_DEFAULT_PROJECT` - valfritt defaultprojekt
- `ADO_API_VERSION` - API-version för vanliga endpoints, till exempel `5.1`
- `ADO_COMMENTS_API_VERSION` - API-version för comments-endpointen, till exempel `5.1-preview.3`
- `ADO_USE_DEFAULT_CREDENTIALS` - `true` för Windows Integrated Authentication
- `ADO_PAT` - PAT om installationen stöder det
- `ADO_BASIC_USERNAME` - användarnamn för basic auth
- `ADO_BASIC_PASSWORD` - lösenord för basic auth
- `ADO_AUTH_HEADER` - färdig `Authorization`-header

Minimikravet är normalt:

- `ADO_BASE_URL`
- någon form av autentisering

## Installera

Ladda ner eller klona detta repo.

Detta är normalt ett **engångssteg efter att du klonat repo:t**.

Kör i repo-roten:

```powershell
npm install
```

Det installerar de lokala Node-beroendena som servern behöver för att kunna startas.

Du behöver normalt bara köra detta igen om `package.json` eller `package-lock.json` har ändrats.

## Starta servern lokalt

Detta steg behövs normalt **inte** i daglig användning.

När du har lagt in servern i `.mcp.json` eller `mcp-config.json` startas den normalt **automatiskt av MCP-klienten** när den behövs.

Manuell start är främst till för:

- felsökning
- lokal utveckling av pluginen
- verifiering att servern går att starta

För utveckling:

```powershell
npm run start --silent
```

För byggd version:

```powershell
npm run build
npm run start:prod
```

## Visual Studio 2022

Om du använder **Visual Studio 2022 + GitHub Copilot** behöver du normalt lägga en `.mcp.json` i det repo där du vill använda servern.

Det betyder att du kan ha:

- en gemensam klon av denna plugin, till exempel `C:\dev\Exor-devops-onprem-mcp`
- en separat `.mcp.json` i varje projekt/repo

På så sätt kopplar samma plugin upp sig mot **rätt collection och rätt defaultprojekt beroende på vilket repo du jobbar i**.

### Enkel mall för `.mcp.json`

Lägg denna fil i **rooten i det projekt** där du vill använda pluginen:

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

Byt ut:

- `ADO_BASE_URL` till collection-URL för det aktuella projektets DevOps-miljö
- `ADO_DEFAULT_PROJECT` till projektets namn
- sökvägen efter `--prefix` om du har klonat pluginen på en annan plats

Bra tumregel är att ge servern ett tydligt namn per repo, till exempel:

- `taxibokning-ado-onprem`
- `mitt-andra-projekt-ado-onprem`

Ett exempel finns i:

```text
examples\repo-root.mcp.json
```

Justera sökvägen till din lokala klon och fyll i era miljövariabler.

## GitHub Copilot CLI

För **Copilot CLI** behövs en lokal användarspecifik konfiguration i användarens `.copilot`-mapp, normalt:

```text
C:\Users\<DITT_ANVÄNDARNAMN>\.copilot\mcp-config.json
```

Ett exempel finns i:

```text
examples\copilot-cli-mcp-config.json
```

Byt ut sökvägen till din lokala klon och fyll i era miljövariabler.

## Kommentarer på work items och pull requests

Servern kan:

- läsa kommentarer
- skapa kommentarer
- uppdatera kommentarer

Servern kan också:

- läsa commits i en pull request
- läsa diff i en pull request
- skapa en övergripande AI-kommentar i en pull request
- läsa utvecklingslänkar från ett work item
- hitta associerade completed PR:er och direkta commits från ett work item
- posta kodgranskning som kommentar i work item

Servern kan inte ändra annan work item-data eller annan PR-data.

Det betyder uttryckligen att pluginen **inte** får:

- approve:a en pull request
- decline:a en pull request
- sätta vote
- ändra reviewers
- merge:a eller på annat sätt ändra PR-status

Alla kommentarer som skapas via kommentarverktygen får prefixet:

`AI-genererad kommentar:`

För PR-granskningar är standardtiteln:

`Kodgranskning av AI`

## Kodgranskning av pull requests

Tanken är att agenten ska kunna:

1. läsa en pull request
2. läsa commits och diff
3. analysera koden för buggar, säkerhetsrisker, onödig kod och ohanterade fel
4. posta en sammanfattande kommentar i PR:n

I första versionen postas granskningen som en vanlig övergripande PR-kommentar, inte som inline-kommentarer på specifika rader.

### Vad granskningen tittar efter

Kodgranskningen är tänkt att fokusera på sådant som faktiskt kan orsaka problem, till exempel:

- buggar och logiska fel
- säkerhetsrisker
- ohanterade exceptions
- dålig felhantering
- onödig eller misstänkt kod
- luckor i validering eller null-hantering

Målet är alltså inte främst stilkommentarer, utan att hitta verkliga risker i ändringen.

### Hur man triggar en kodgranskning

När MCP-servern är tillgänglig i din klient kan du be agenten att granska en PR med en vanlig prompt.

Exempel:

- `Granska PR 123 i repo Backend och posta en kodgranskning i PR:n`
- `Läs diffen i PR 456, leta efter buggar och säkerhetsrisker och skriv en sammanfattning som kommentar`
- `Gör en AI-kodgranskning av senaste öppna PR:n i repo Api`

### Hur granskningen utförs i praktiken

Agenten använder i typfallet dessa steg:

1. hämtar PR-detaljer
2. hämtar commits i PR:n
3. hämtar diff för ändrade filer
4. analyserar ändringarna
5. postar en sammanfattande kommentar i PR:n

De viktigaste MCP-verktygen för detta är:

- `ado_get_pull_request`
- `ado_list_pull_request_commits`
- `ado_get_pull_request_diff`
- `ado_add_pull_request_comment`

### Exempel på resultat

När granskningen är klar postas en kommentar i PR:n som börjar med:

`AI-genererad kommentar:`

och med titeln:

`Kodgranskning av AI`

Därefter kommer själva granskningen med fynd, risker och rekommendationer.

## Kodgranskning utifrån ett work item

Om ni länkar commits och pull requests till work items kan agenten också använda work itemet som startpunkt.

Tanken är då:

1. läsa work itemet och dess relationer
2. hitta associerade Git-artifacts
3. filtrera bort abandoned pull requests
4. fokusera på completed pull requests och direktlänkade commits
5. granska associerad kod
6. posta resultatet som kommentar i work itemet

De viktigaste MCP-verktygen för detta är:

- `ado_get_work_item_code_links`
- `ado_get_pull_request_diff`
- `ado_get_commit_diff`
- `ado_add_work_item_comment`

Exempel:

- `Granska associerad kod för work item 35605 och posta resultatet som kommentar i work itemet`
- `Hitta completed PR:er kopplade till work item 35605, gör en kodgranskning och skriv sammanfattningen i ärendet`

Om ett work item har länkar till abandoned PR:er ignoreras de i det här flödet.

## Kan AI posta som en annan användare?

Normalt inte via en enkel visningsinställning i config.

Kommentarer skapas som den **autentiserade identiteten**:

- med `ADO_USE_DEFAULT_CREDENTIALS=true` blir det Windows-användaren som kör processen
- med PAT/basic auth blir det kontot bakom den autentiseringen

Om AI ska posta som ett annat konto behöver servern alltså köras med **det kontots credentials**.

