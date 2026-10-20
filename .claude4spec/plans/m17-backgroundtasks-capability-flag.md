---
type: plan
title: M17 backgroundTasks capability flag
created_at: '2026-07-28T08:52:23.864Z'
created_by: agent
---
# Plan — Patch: M17 has no entry in the static capability matrix

<!-- anchor: ly69itn3 -->
## Kontekst i ustalenia

**Patch (`missing`)**: M17 (background tasks) ma runtime'owy kontrakt „graceful absence" (na codex/gemini/opencode `background_task_*` nigdy się nie pojawia, `result` nigdy nie niesie `backgroundTasks`), ale **nie ma statycznej flagi** w `architectureCapabilities()`. Konsument nie może z góry zapytać „czy ten adapter kiedykolwiek backgrounduje pracę?" i musi zahardkodować, że tylko `claude-code` to robi. To boli bardziej niż przy innych zdolnościach, bo kontrakt M17 to *kształt pętli* („czytaj strumień do `done`, nie do pierwszego `result`").

**Weryfikacja w kodzie** (`src/capabilities.ts`): flaga `backgroundTasks` **nie istnieje** — są tylko `midTurnPush`, `imageInput`, `subagentDefinition`, `pathScope`. Autor patcha słusznie jej nie dodał (public API). M17 jest jedynym capability-module z macierzą wsparcia, który nie ma odpowiadającej flagi w płaskiej mapie boolean.

**Rozstrzygnięta semantyka** (pytanie „zachowanie adaptera vs surowa zdolność SDK"): wszystkie cztery istniejące flagi w kodzie są udokumentowane jako **zachowanie adaptera** („The adapter supports/honors X", powiązane z SDK „today", ale śledzące adapter, nie SDK). Dla spójności `backgroundTasks` przyjmuje tę samą semantykę: **„adapter implementuje rodzinę M17"** — tzn. kiedykolwiek wyemituje `background_task_*` / wypełni `result.backgroundTasks`. Dziś pokrywa się to ze zdolnością SDK; gdyby przyszły adapter miał SDK backgroundujące pracę zanim adapter ją zmapuje, flaga śledzi adapter (jak każda inna).

**Zakres**: to zmiana **wyłącznie w specyfikacji** (`spec/`). Sama flaga w `src/capabilities.ts` to public API addition, którą wdroży brief-implementer z release-briefu wygenerowanego z tej zmiany — asystent specyfikacji nie dotyka `src/` (CLAUDE.md).

<!-- anchor: ir4qjo7r -->
## Kroki

1. **M17 — sekcja `Capability & Degradation (L2)`** (`spec/modules/M17-background-tasks.md`, anchor `ujhcafnf`) — dom kanoniczny:
   - Nazwać flagę: dodać `backgroundTasks` do macierzy wsparcia jako jawny wiersz/flagę (dziś macierz nie nazywa żadnej flbooli — M17 jest jedynym takim modułem).
   - Wartości: `claude-code` (+ warianty providerów `claude-code-ollama`, `claude-code-minimax`) → `true`; `codex`, `gemini`, `opencode` (+ `opencode-openrouter`) → `false`.
   - Dopisać, co konsument może wywnioskować z `false`: żaden `background_task_*` nie nadejdzie, `result` jest zawsze terminalny, więc pętla „czytaj do `done`" jest dla tego adaptera **opcjonalna** (tani early-exit na pierwszym `result` jest bezpieczny) — przy czym iterowanie do `done` pozostaje poprawne na każdym adapterze bez zmian.
   - Zanotować przyjętą semantykę (flaga śledzi zachowanie adaptera / implementację rodziny M17, dziś zbieżną ze zdolnością SDK).

2. **M01 — sekcja `Capability & Degradation (L2) — implementor`** (`spec/modules/M01-unified-core.md`, anchor `nbgtn5nk`) — dopisać `backgroundTasks` do przykładowej listy płaskich flag boolean („np. `midTurnPush`, `pathScope`") tak, by wyliczenie mechanizmu obejmowało nową flagę. Bez zmiany taksonomii warn/skip/synthesize.

3. **Adaptery A01–A04** — dopisać `backgroundTasks` do każdego zadeklarowanego obiektu `architectureCapabilities(...)`:
   - `spec/adapters/A01-claude-code.md` (anchor `c4qvzzks`, ~linia 47): `backgroundTasks: true`; w bullecie „Background tasks → M17…" (linia 45) dopisać, że to adapter, w którym `backgroundTasks` jest `true`.
   - `spec/adapters/A02-codex.md` (anchor `dmy7oxr7`, linia 31): `backgroundTasks: false`.
   - `spec/adapters/A03-opencode.md`: `backgroundTasks: false`.
   - `spec/adapters/A04-gemini.md`: `backgroundTasks: false`.

4. **L2 — slice schema** (`spec/layers/L2-capability-degradation.md`, anchor `au14qdu4`, opcjonalnie) — lista przykładowych flag jest ilustracyjna (pomija już `pathScope`), więc zmiana niekonieczna; rozważyć dopisanie `backgroundTasks` dla kompletności przykładu.

5. **Acceptance criteria** — dodać nowy `ac` (kind `requirement`, tag `m17`), weryfikujący statyczną odkrywalność: `architectureCapabilities(arch).backgroundTasks` jest `true` tylko dla rodziny `claude-code`, a `false` dla codex/gemini/opencode; oraz że `false` uprawnia konsumenta do wniosku „`result` terminalny, brak `background_task_*`". Istniejący `ac-on-adapters-whose-sdk-never-backgrounds` pokrywa *runtime'ową* nieobecność — nowy AC pokrywa *statyczną* deklarację (uzupełnienie, nie duplikat).

<!-- anchor: 55awlxts -->
## Poza zakresem
- Edycja `src/capabilities.ts` / jakiegokolwiek kodu — to robi brief-implementer downstream (CLAUDE.md: asystent specyfikacji nie edytuje `src/`).
- Zauważony przy okazji drobny drift `gemini.pathScope` (kod: `true`) vs raport eksploracji — niepowiązane z tym patchem, nie ruszam.

<!-- anchor: n6w5r6ne -->
## Do potwierdzenia przez usera
- Czy krok 5 (nowy AC) ma powstać, czy wystarczy rozszerzyć opis istniejącego kontraktu bez osobnego AC.
- Czy krok 4 (kosmetyczne dopisanie do L2 slice schema) wykonać, czy pominąć jako czysto ilustracyjny.
