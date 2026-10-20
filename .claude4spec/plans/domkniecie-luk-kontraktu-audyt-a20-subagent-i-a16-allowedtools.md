---
type: plan
title: Domknięcie luk kontraktu — audyt A20 (subagent) i A16 (allowedTools)
created_at: '2026-08-08T10:18:51.905Z'
created_by: agent
---
<!-- anchor: qw9qedqq -->
## Cel

Domknąć dwie **udokumentowane luki w naszej własnej specyfikacji** ujawnione przez audyt konsumenta (`^0.9.1`). Obie to luki *opisu kontraktu* — kod ma zachowanie, spec go nie normuje:

- **A20 (KRYTYCZNY):** natywny subagent (`Agent`/`Task`) nie jest granicą bezpieczeństwa; spec normuje dziś tylko nie-dziedziczenie `disallowedTools`, milczy o path-scope i `builtinMCPServers`.
- **A16 (ISTOTNY):** `allowedTools` jest de facto claude-code-only, cicho ignorowane gdzie indziej, bez JSDoc, bez flagi capability, bez kontraktu degradacji — inaczej niż każde bratnie pole.

**Rozstrzygnięcia (D1–D3):**
- **D1 → Opcja B:** dla `allowedTools` dodajemy pełną flagę capability `toolAllowlist` do `architectureCapabilities`.
- **D2 → M01:** dom kontraktu pola `allowedTools` i macierzy `toolAllowlist` = M01 (Unified Core).
- **D3 → spec-only, plan-only:** ta iteracja obejmuje **wyłącznie spec + encje `ac`** i **na razie tylko PLAN** (bez wykonania). Release-brief części kodowej — osobno, później.

**Zakres roli (twarda granica).** Edytujemy **wyłącznie spec** (`spec/` + encje `ac` przez MCP). Zmiany w kodzie (`src/capabilities.ts`, `src/types.ts`, `warning` w `codex.ts`/`gemini.ts`/`opencode.ts`, `capabilities.test.ts`) **NIE** są robione tutaj — po zatwierdzeniu spec propagują się przez pipeline **release-brief → brief-implementer** (CLAUDE.md).

**Wersjonowanie.** Dodanie pola do `ArchitectureCapabilities` i nowy `warning` są **addytywne** → semver **minor**. Nota behawioralna w M12/CHANGELOG.

---

<!-- anchor: pwidcypu -->
## Gap 1 — granica natywnego subagenta (A20)

**Problem.** Jedyne normatywne zdanie to A01 *Edge cases* (<section_ref anchor="677rc2wh"/>): „a spawned subagent does not inherit `disallowedTools`". Brak wypowiedzi o (nie)dziedziczeniu **path-scope** (`allowedPaths`/`disallowedPaths`) oraz `builtinMCPServers`. Konsument budujący sandbox nie ma gwarancji kontraktowej w żadną stronę.

**Decyzja normatywna:** zapisać jako **kontrakt docelowy**, nie bug — „natywny subagent NIE jest granicą narzędziową". Zawężenia toolowe rodzica (`planMode`/`allowedTools`/`disallowedTools`) nie przenoszą się na subagenta; **jedyny** confinement obejmujący subagenta to **twardy sandbox systemowy** path-scope (FS, poziom syscalli), a path-scope **soft** i `builtinMCPServers` — nie.

<!-- anchor: 84cxzwrg -->
### Kroki

1. **M15 — dodać oś „subagent inheritance" do kontraktu path-scope.**
   - `## Capability & Degradation (L2)` (<section_ref anchor="8pg5iti3"/>): zdanie normatywne — pod **twardym** sandboxem OS confinement obejmuje procesy potomne, więc wiąże też zapisy subagenta; pod gate'em **soft** brak takiej gwarancji.
   - `## Edge cases` (<section_ref anchor="x2258xmh"/>): edge case „subagent spawnowany w trakcie runu — hard: związany syscall-level; soft: niezwiązany".

2. **A01 — uogólnić i doprecyzować edge case.**
   - <section_ref anchor="677rc2wh"/>: rozszerzyć zdanie z „`disallowedTools`" na pełny zestaw zawężeń toolowych (planMode/`allowedTools`/`disallowedTools`) + dodać, że **path-scope soft** i `builtinMCPServers` też nie są dziedziczone, a **hard sandbox** wiąże subagenta na FS.
   - Bullet plan-mode/path-scope w `## Per-capability consumption` (<section_ref anchor="sw3cwrsm"/>): jedno zdanie-link do tej granicy (bez duplikacji treści).

3. **M06 — dopisać zdanie o granicy.**
   - <section_ref anchor="70dpqgcb"/>: *definiowanie* subagentów (`subagents`) nie zmienia faktu, że natywny subagent nie dziedziczy zawężeń toolowych rodzica — link do A01 (one-home).

4. **AC (encje `ac`).** Przez `create_entities`:
   - `m15`/`m15-edge`: „subagent pod hard-sandbox związany FS; pod soft — nie" (`kind: edge-case`, `verifies` → M15 fields).
   - `a01`/`a01-edge`: „zawężenia toolowe rodzica nie przenoszą się na `Agent`/`Task`" (`kind: edge-case`).
   - Osadzenie przez istniejące `<tagged_list type="ac" .../>`.

5. **Nazewnictwo.** Spójność w dotykanych miejscach: narzędzie = **`Agent` (dawniej `Task`)**; pole kontraktu = **`subagents`**.

**Do briefu (kod, poza iteracją):** brak zmian kodu dla Gap 1 — zachowanie już istnieje; brief tylko odnotowuje zgodność JSDoc `planMode` z szerszą formułą spec.

---

<!-- anchor: tzoldfe6 -->
## Gap 2 — `allowedTools` claude-code-only (A16) — Opcja B (flaga capability)

**Problem.** `allowedTools` (`types.ts:618`, pusty JSDoc) czyta tylko `claude-code.ts:719`; codex/gemini/opencode ignorują cicho (bez `warning`). Brak flagi capability, brak kontraktu degradacji, nieobecne w spec.

**Decyzja:** dodać pełną flagę **`toolAllowlist: boolean`** do `architectureCapabilities` (jak `midTurnPush`/`subagentDefinition`), z domem macierzy w **M01**, i degradacją **warn** dla adapterów bez wsparcia.

<!-- anchor: hgzwzwjk -->
### Kroki

1. **M01 — flaga w mechanizmie capability (implementor L2).**
   - W sekcji L2 M01 (how-mode, dom `architectureCapabilities`/`capabilities.ts`) dodać `toolAllowlist: boolean` do taksonomii flag. Wartości: `claude-code`/`claude-code-ollama`/`claude-code-minimax` = `true`; `codex`/`opencode`/`opencode-openrouter`/`gemini` = `false`.

2. **M01 — dokumentacja pola + macierz (one-home, D2).**
   - W sekcji L1 M01 opisać `allowedTools`: semantyka (allowlist nazw narzędzi), honorowane tylko przy `toolAllowlist: true`; przy `false` adapter emituje jednorazowy `warning` i ignoruje. Zaznaczyć, że to **nie** `builtinMCPServers`/`allowedMCPTools` (pre-adapter, rozwiązywane przez konsumenta).
   - Umieścić **macierz `toolAllowlist`** (per-adapter) w M01 — bo D2 wskazuje M01 jako dom. Nota: „specific-tool gating przejmie w przyszłości generic tool-permission hook" (spójne z Open questions M15).

3. **L2 — schema module slice.**
   - <section_ref anchor="au14qdu4"/>: dodać `toolAllowlist` do wyliczenia flag capability, które moduł może keyować (obok `midTurnPush`/`imageInput`/`subagentDefinition`), ze strategią **warn**.

4. **A01 — kolumna pozytywna.**
   - Sekcja `## Capability support & degradation (L2)` (<section_ref anchor="c4qvzzks"/>): dodać punkt „tool-allowlist → M01 owns matrix; claude-code jedyny z `toolAllowlist: true`".
   - Zaktualizować literał wyniku `architectureCapabilities('claude-code')` (dziś `{ midTurnPush, imageInput, subagentDefinition, pathScope }`) o `toolAllowlist: true`.

5. **A02–A04 — sekcja L2.**
   - Po zdaniu: „`allowedTools` nie honorowane (`toolAllowlist: false`) → jednorazowy `warning`", link do macierzy w M01.

6. **spec/index.md.**
   - Jeśli indeks/tabela wylicza flagi `architectureCapabilities`, dodać `toolAllowlist` (quality rule 1 — index w sync).

7. **AC (encje `ac`).**
   - `m01`: „`allowedTools` honorowane tylko przy `toolAllowlist: true`; inne adaptery emitują `warning`" (`kind: requirement`, `verifies` → pole).
   - `m01-edge`: „`allowedTools` na codex → `warning`, run kontynuuje".

8. **M12 — nota release.**
   - Wpis CHANGELOG: nowa flaga `toolAllowlist` (addytywna, minor) + nowy `warning` w codex/gemini/opencode.

**Do briefu (kod, poza iteracją):**
- `src/capabilities.ts`: dodać `toolAllowlist` do `ArchitectureCapabilities` + wartości w mapie + `false` w defaultcie unknown.
- `src/types.ts`: uzupełnić pusty JSDoc `allowedTools` zgodnie z M01.
- `src/adapters/codex.ts`, `gemini.ts`, `opencode.ts`: jednorazowy `warning` gdy `params.allowedTools?.length` (wzorzec jak dla `subagents`).
- `src/capabilities.test.ts`: pokrycie nowej flagi.

---

<!-- anchor: sm11yecc -->
## Kolejność wykonania i drift-check (gdy przejdziemy z planu do egzekucji)

1. **Gap 1** (KRYTYCZNY) najpierw: M15 → A01 → M06 → AC.
2. **Gap 2** (Opcja B): M01 (flaga → dokumentacja pola → macierz) → L2 → A01 → A02–A04 → index.md → AC → M12.
3. Po edycjach: `check_consistency` (AC.verifies + osadzenia) + weryfikacja tabel w `spec/index.md`.
4. **Release-brief części kodowej — NIE w tej iteracji** (D3). Noty „do briefu (kod)" zostają w planie jako wsad do przyszłego briefu.

<!-- anchor: 4s96myya -->
## Status

Plan gotowy do zatwierdzenia. Zakres tej iteracji: **spec + encje `ac`**. Po Twoim „wykonaj" wychodzę z trybu plan i realizuję kroki Gap 1 → Gap 2 (bez dotykania kodu; brief kodowy osobno w kolejnej iteracji).
