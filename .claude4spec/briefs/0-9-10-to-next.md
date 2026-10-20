---
type: brief
from_release: 0.9.10
to_release: null
generated_at: '2026-09-21T21:34:29.058Z'
implemented: true
---
# Brief: 0.9.10 → (unreleased)

Adapter `claude-code` (`src/adapters/claude-code.ts`) rozjechał się z zachowaniem
`@anthropic-ai/claude-agent-sdk` 0.3.263 w jednym konkretnym miejscu: **wznawianiu
subagenta działającego w tle**. Model może dziś wysłać do już zakończonego subagenta
nową wiadomość narzędziem `SendMessage` (i wylistować subagentów `ListAgents`) —
SDK traktuje to jako kontynuację *tego samego* zadania, a adapter tego nie rozpoznaje:
bramkuje te narzędzia jak zwykłe buildiny, zgłasza wznowiony cykl jako nowy start,
i może zamknąć run w oknie karencji dokładnie w chwili wznowienia. Dodatkowo domyślna
polityka SDK dla wiadomości przychodzących między sesjami jest pochodną trybu
uprawnień, co przy bibliotecznym runie w `bypassPermissions` oznacza automatyczne
przyjmowanie promptów z każdej innej sesji `bypass`.

Ten brief jest **analizą driftu kodu**, nie zapisem zmian w specyfikacji. Kolejność
pracy: najpierw uzgodnienie specyfikacji (zaplanowane osobno, w wątku ask
`3BHM3LlK5iQ6`), potem implementacja **przeciw uzgodnionej specyfikacji**. Nic z
poniższego nie powinno trafić do kodu przed tym uzgodnieniem.

## Co pokazała sonda na SDK 0.3.263

Fakty zmierzone na żywo, nie wyprowadzone z dokumentacji:

- `SendMessage` i `ListAgents` **są** na liście narzędzi w komunikacie `system:init`,
  ale są *deferred* — model ładuje ich schematy przez `ToolSearch` zapytaniem
  `select:SendMessage`.
- Wznowienie subagenta działającego w tle przez `SendMessage` emituje **nowy**
  `system` / `task_started` z:
  - **tym samym `task_id`** co pierwotne uruchomienie,
  - `tool_use_id` równym id wywołania `SendMessage` (a *nie* pierwotnego `Agent`),
  - `is_backgrounded: true`,
  - `prompt` równym treści nowej wiadomości.
- Wiadomości `assistant` wznowionego subagenta noszą `parent_tool_use_id` równy
  **pierwotnemu** `tool_use_id` narzędzia `Agent`.
- Po wznowieniu przychodzi **drugi** `task_updated` (`completed`) oraz
  `task_notification`, oba z `tool_use_id` = id `SendMessage`.
- Pod **jawną** listą dozwolonych narzędzi (`options.tools`) `SendMessage`
  i `ListAgents` w ogóle nie występują — model traci możliwość kontynuowania
  własnego subagenta.
- Pod miękkim path-scope (`dontAsk`) `SendMessage` działa **bez** reguły allow.

Pełna sekwencja zdarzeń jednego cyklu wznowienia:

```
Agent (tool_use A) → system/task_started (task_id T, tool_use_id A, is_backgrounded)
                   → task_updated(completed) → task_notification (tool_use_id A)
SendMessage (tool_use S, target = T)
                   → system/task_started (task_id T, tool_use_id S, is_backgrounded, prompt = nowa wiadomość)
                   → assistant (parent_tool_use_id = A)
                   → task_updated(completed) → task_notification (tool_use_id S)
```

## Delegacja przestaje działać pod jawną listą narzędzi (M18)

`CLAUDE_CODE_UNGATED_BUILTINS` (`src/adapters/claude-code.ts`, ~linia 198) przepuszcza
dziś `Task`/`Agent`, ale nie `SendMessage` ani `ListAgents`. Skutek: run z jawną listą
narzędzi potrafi *uruchomić* subagenta i nie potrafi go *kontynuować*. Racjonalizacja
jest ta sama, co dla `Task`/`Agent`: delegowanie pozostaje dostępne, a zakazy
(gating, path-scope) i tak propagują się do subagentów, więc przepuszczenie narzędzia
sterującego nie rozszerza realnych uprawnień. Umiejscowienie `TaskOutput` / `TaskStop`
w tej samej liście jest decyzją do podjęcia w planie specyfikacji, nie tutaj.

## Wznowiony subagent to ten sam cykl, nie nowy (M06)

Gałąź obsługi `task_started` (~linia 2343) zakłada, że `task_started` zawsze otwiera
nowy cykl. Po zmianie system musi rozpoznawać **ponowne wejście** znanego zadania:
`tasks.kind(taskId)` jest zdefiniowane, a `taskId` nie jest w `inFlight` → to
wznowienie. Wtedy:

- emitowany jest `subagent_started` z nowym, opcjonalnym polem `resumed: true`
  (rozszerzenie zdarzenia `subagent_started` w `UnifiedEvent`, `src/types.ts`) —
  konsument widzi ciągłość zadania, nie drugi byt;
- mapowanie `parent_tool_use_id → taskId` w `subagentTaskIdByParentToolUseId`
  zachowuje **pierwotny** klucz (`A`), bo takie `parent_tool_use_id` nadal noszą
  wiadomości subagenta, **i dodatkowo** rejestruje `tool_use_id` wywołania
  `SendMessage` (`S`), bo takim id oznaczone są `task_updated`/`task_notification`
  wznowienia;
- gwarancja „co najwyżej jedno zamknięcie” przestaje być gwarancją na zadanie,
  a staje się gwarancją **na niesparowany `subagent_started`**: synteza zakończenia
  (przy przerwaniu/abort/końcu runu) musi domknąć ponownie otwarty cykl dokładnie raz.

## Okno karencji nie może wygasnąć w trakcie wznowienia (M17)

Hold tła (`src/adapters/claude-code.background-hold.ts`) daje po wyciszeniu (settle)
okno karencji na dalsze zdarzenia. Wznowienie wypada właśnie w tym oknie: `tasks.start()`
dokładające id z powrotem do `inFlight` musi **przezbroić granice holdu**, inaczej run
kończy się w środku wznowienia i reszta odpowiedzi subagenta ginie. Wymagany test
regresyjny na scenariuszu „settle → `SendMessage` → ponowne `task_started`”.

## Przychodzące wiadomości między sesjami: domyślnie odmowa (M14)

Brak ustawienia `options.crossSessionInbound` oznacza w SDK parytet z trybem uprawnień —
czyli run biblioteczny w `bypassPermissions` automatycznie przyjmuje prompty z dowolnej
innej sesji `bypass`. System przypina więc `options.crossSessionInbound = 'refuse'`
na **każdym** runie `claude-code`, bez klucza konfiguracyjnego, który by to odblokował.
Przypięta postawa jest raportowana w zdarzeniu `adapter_ready`, żeby była audytowalna
z zewnątrz.

## Czego świadomie nie robimy

Wiadomości między agentami/sesjami jako *funkcja* (zespoły agentów, wysyłanie
cross-session) pozostają **udokumentowaną luką możliwości**. Zmiany powyżej dotyczą
wyłącznie tego, żeby adapter poprawnie *obserwował i nie psuł* mechaniki, którą SDK
udostępnia modelowi wewnątrz jednego runu.

## For implementers

Kolejność: najpierw specyfikacja (wątek ask `3BHM3LlK5iQ6`), potem kod. Dalej —
typy przed konsumentami, lifecycle przed hold, testy razem ze zmianą.

1. `src/types.ts` — dodaj opcjonalne `resumed?: boolean` do zdarzenia
   `subagent_started` w `UnifiedEvent`.
2. `src/adapters/claude-code.ts`, ~linia 198 — `CLAUDE_CODE_UNGATED_BUILTINS`:
   dopisz `'SendMessage'` i `'ListAgents'`. `TaskOutput` / `TaskStop` — zgodnie
   z decyzją z planu specyfikacji.
3. `src/adapters/claude-code.tool-gating.test.ts` — pokrycie: pod jawną listą
   `options.tools` oba narzędzia są obecne w efektywnym zestawie.
4. `src/adapters/claude-code.ts`, ~linia 2343 (gałąź `task_started`) — detekcja
   ponownego wejścia (`tasks.kind(taskId)` zdefiniowane && `taskId` nie w `inFlight`)
   → `subagent_started` z `resumed: true`; zachowaj pierwotny wpis
   `parent_tool_use_id → taskId` w `subagentTaskIdByParentToolUseId` i dodaj wpis dla
   `tool_use_id` z `SendMessage`.
5. Synteza zakończenia w tym samym pliku — przenieś „co najwyżej raz” z klucza
   `taskId` na niesparowany `subagent_started`, tak by ponownie otwarty cykl został
   domknięty dokładnie raz.
6. `src/adapters/claude-code.background-hold.ts` + `tasks.start()` — przezbrojenie
   granic holdu przy powrocie id do `inFlight`.
7. Ustawienie `options.crossSessionInbound = 'refuse'` w budowie opcji runu
   `claude-code` (bez klucza w konfiguracji adaptera) + wystawienie tej postawy
   w payloadzie `adapter_ready`.
8. Testy jednostkowe na fixture'ach odtwarzających sondowaną sekwencję
   (`Agent` → `task_started` → `task_notification` → `SendMessage` →
   `task_started` z tym samym id → `task_notification`):
   `src/adapters/claude-code.subagent-lifecycle.test.ts` oraz
   `src/adapters/claude-code.background-hold.test.ts`.
9. `src/testing/e2e/claude-code.e2e.test.ts` — scenariusz e2e „kontynuacja subagenta”.
