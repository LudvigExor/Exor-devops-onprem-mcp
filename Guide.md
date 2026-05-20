# Exor DevOps Onprem MCP

Praktisk guide för att komma igång med MCP-servern mot **Azure DevOps Server on-prem**.

## Vad detta är

Detta är en fristående MCP-server för:

- work items
- kommentarer på work items
- repositories
- pull requests
- builds

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

Kör i repo-roten:

```powershell
npm install
```

## Starta servern lokalt

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

Ett exempel finns i:

```text
examples\repo-root.mcp.json
```

Justera sökvägen till den lokala klonen av detta repo och fyll i era miljövariabler.

## GitHub Copilot CLI

För **Copilot CLI** behövs en lokal användarspecifik konfiguration i:

```text
C:\Users\<DITT_ANVÄNDARNAMN>\.copilot\mcp-config.json
```

Ett exempel finns i:

```text
examples\copilot-cli-mcp-config.json
```

Byt ut sökvägen till den lokala klonen av detta repo och fyll i era miljövariabler.

## Kommentarer på work items

Servern kan:

- läsa kommentarer
- skapa kommentarer
- uppdatera kommentarer

Servern kan inte ändra annan work item-data.

Alla kommentarer som skapas via kommentarverktygen får prefixet:

`AI-genererad kommentar:`

## Kan AI posta som en annan användare?

Normalt inte via en enkel visningsinställning i config.

Kommentarer skapas som den **autentiserade identiteten**:

- med `ADO_USE_DEFAULT_CREDENTIALS=true` blir det Windows-användaren som kör processen
- med PAT/basic auth blir det kontot bakom den autentiseringen

Om AI ska posta som ett annat konto behöver servern alltså köras med **det kontots credentials**.

