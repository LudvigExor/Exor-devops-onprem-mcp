# AzureDevOpsOnPremMcp Agent Guide

Det här repo:t innehåller MCP-servern för TFS/Azure DevOps Server on-prem och en inbyggd `/devops`-skill.

För uppgifter som gäller work items, buggar, pull requests, commits, diffar, implementation plans och kodgranskning ska du i första hand använda `/devops` när skillen finns tillgänglig.

Om skillen inte är tillgänglig ska du ändå följa samma regler nedan och föredra den konfigurerade Azure DevOps-MCP-servern framför rå PowerShell eller direkta REST-anrop.

## Syfte

Som agent ska du använda den här servern för:

- läsning av work items, buggar, repositories, builds, pull requests, commits, diffar och kommentarer
- skrivning av endast work item-kommentarer och pull request-kommentarer

Du ska inte använda den för att ändra annan work item-data eller pull request-status.

## Tillåtna skrivoperationer

Pluginen får bara skriva:

- nya kommentarer på work items
- uppdateringar av work item-kommentarer
- nya kommentarer på pull requests
- uppdateringar av tidigare AI-genererade pull request-kommentarer när ett sådant flöde uttryckligen används

Pluginen får inte användas för att ändra:

- titel
- state
- fields
- relationer
- annan work item-data
- pull request-status
- votes
- reviewers
- annan pull request-data
- approve
- decline
- merge

## Konfiguration

Utgå från att pluginen är generell och får sin projekt- och serverkonfiguration från miljövariabler eller MCP-konfiguration.

Viktiga värden är:

- `ADO_BASE_URL`
- `ADO_DEFAULT_PROJECT`
- `ADO_API_VERSION`
- `ADO_COMMENTS_API_VERSION`
- autentisering via `ADO_USE_DEFAULT_CREDENTIALS`, `ADO_PAT`, `ADO_BASIC_USERNAME` och `ADO_BASIC_PASSWORD`, eller `ADO_AUTH_HEADER`

## Kommentarformat

Alla kommentarer som skapas eller uppdateras via pluginen ska utgå från detta format:

1. Första raden är alltid `AI-genererad kommentar:`
2. Därefter en tom rad
3. Därefter titel på ny rad, till exempel `Implementation plan`
4. Därefter själva innehållet

Pluginen lägger in prefixet automatiskt. Som agent ska du därför fokusera på:

- rätt titel
- rätt innehåll
- kortfattad men komplett struktur

För rendering gäller:

- work item-kommentarer formateras som HTML
- pull request-kommentarer formateras som markdown

## Regler för implementation plans i buggar

Om kommentaren gäller en bugg och du vet hur problemet kan återskapas ska kommentaren börja med:

### Så här återskapas problemet

Håll den delen kort och konkret.

Därefter ska kommentaren innehålla:

### Kort lösningsförslag

Kort sammanfattning av föreslagen lösning eller huvudinriktning.

### Mer detaljer

Den utförligare delen som gör att en framtida agent eller utvecklare faktiskt kan lösa ärendet utan att behöva börja om från noll.

## Regler för PR-kodgranskning

När kommentaren gäller en pull request ska titeln normalt vara:

- `Kodgranskning av AI`

Granskningen ska fokusera på:

- buggar
- säkerhetsrisker
- ohanterade exceptions
- onödig eller misstänkt kod
- viktiga logiska luckor

Om pull requesten har relaterade work items ska agenten också läsa in relevant work item-kontekst och väga in om ändringen faktiskt verkar lösa ärendets syfte, beskrivning och eventuella acceptanskriterier.

Undvik att fylla kommentaren med rena stilåsikter om det inte påverkar korrekthet eller underhållbarhet tydligt.

När granskningen är klar får agenten posta en sammanfattande kommentar i PR:n, men agenten får inte approve:a, decline:a eller på annat sätt ändra PR:ns beslutsläge.

## Regler för kodgranskning via work item

Om användaren ber om kodgranskning utifrån ett work item ska agenten i första hand:

1. läsa work itemets relationer
2. hitta associerade PR:er och commits
3. ignorera PR:er med status `abandoned`
4. deduplicera repetitiva mergekedjor och behålla den senaste representativa `completed` PR:n per unik kodmängd
5. hoppa över direkta commit-länkar som redan täcks av de valda PR:erna
6. posta sammanfattningen som kommentar i work itemet

Om både PR-länkar och commit-länkar finns får agenten använda båda som granskningsunderlag.

## Skrivstil för kommentarer

Kommentarer ska vara:

- på samma språk som PR-beskrivningen eller work item-beskrivningen, beroende på var kommentaren ska postas
- kortfattade först
- korta och koncisa
- konkreta och relevanta
- lätta att skumma
- tillräckligt informativa för att senare kunna användas som underlag för implementation

Undvik onödigt långa utläggningar. Om en kortare formulering räcker ska agenten välja den.

Om texten är på svenska ska agenten skriva korrekt svenska och bevara svenska tecken som `å`, `ä` och `ö`.

Använd inte ASCII-ersättningar som `a`, `ae` eller `oe` om det inte finns ett mycket tydligt tekniskt skäl.

Bra tumregel:

1. börja med reproduktion om den är känd
2. ge kort lösningsförslag
3. fyll på med detaljer som behövs för faktisk implementation

## Viktigt om renderingen i TFS

I den här miljön verkar work item-kommentarer inte rendera markdown pålitligt, medan pull request-kommentarer stöder markdown bättre.

Utgå därför från att work item-kommentarer ska fungera även med enkel HTML, och att innehållet alltid ska vara begripligt även om formateringen blir enkel i UI:t.

## Exempel på bra titelrader

- `Implementation plan`
- `Bug analysis`
- `Proposed fix`
- `Root cause summary`
