---
name: devops
description: Use this for Azure DevOps Server / TFS on-prem tasks such as reviewing pull requests, reviewing code from work items, or writing implementation plans and review comments via the configured Azure DevOps MCP server.
---

Använd `/devops` som en tydlig trigger för Azure DevOps Server / TFS on-prem-uppgifter.

När skillen används:

1. Följ reglerna i repoets `AGENTS.md`.
2. Använd i första hand den konfigurerade Azure DevOps-MCP-servern.
3. Håll kommentarer korta och koncisa.
4. Använd skillen särskilt för PR-kodgranskning, work item-granskning och implementation plans.

Om användaren bara skriver `/devops` eller ger en bred DevOps-uppgift utan att specificera exakt vad som ska göras, börja med en kort förtydligande fråga.

Använd då helst dessa alternativ:

1. `Kodgranska en PR`
2. `Granska och ta fram implementation plan för work item`
3. `Felsök en bugg`
4. `Läsa builds/commits/repoinformation`

Exempel:

- `/devops kodgranska min senaste PR`
- `/devops granska work item 35605 och skriv en implementation plan`
