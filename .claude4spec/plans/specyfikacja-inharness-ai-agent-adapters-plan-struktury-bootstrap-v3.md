---
type: plan
title: 'Specyfikacja `@inharness-ai/agent-adapters` — plan struktury (bootstrap, v3)'
created_at: '2026-06-29 11:45:41'
created_by: user
---
# Specyfikacja `@inharness-ai/agent-adapters` — plan struktury (bootstrap, v3)

Styl pisania: **Layered Vertical Slices**. Stan wyjściowy: brak indeksu (pages=0) → **bootstrap** pod `spec/` (`spec/index.md`, `spec/layers/`, `spec/modules/`, `spec/adapters/`). Treść specyfikacji po angielsku; plan i rozmowa po polsku.

**Zmiana v1 → v2:** adaptery przeniesione z modułów (były M02–M05) do osobnego, trzeciego rodzaju artefaktu `spec/adapters/` (A01–A04), z dedykowanym szablonem. Moduły to teraz wyłącznie **capability-moduły** (funkcje przekrojowe), przenumerowane sekwencyjnie M01–M14 (czysta numeracja — bootstrap, brak plików do "zachowania luk").
**Zmiana v2 → v3:** ustalono dom rozszerzenia writing-style (decyzja 5): kanon w `spec/index.md` → Key concepts, `CLAUDE.md` jako cienki wskaźnik.

<!-- anchor: 573wikaf -->
## Decyzje potwierdzone z użytkownikiem
1. **Spec target: Production-hardened** — pełna funkcjonalność + koncerny przekrojowe (auth, obserwowalność/audyt, redakcja sekretów, odporność operacyjna, wersjonowanie/ewolucja kontraktu).
2. **Adaptery Google (google-genai, google-adk): pominięte** — bez modułów (ewentualnie 1 linijka w „Future scope" indeksu).
3. **14 obcych AC + tagi m06/m19/m20 (z aplikacji claude4spec): wyczyścić** i tworzyć AC od nowa, tagowane per artefakt (`mNN` dla capability-modułów, `aNN` dla adapterów).
4. **Model 3-poziomowy**: Warstwa ← Capability-moduł ← Adapter. „Adapter opisuje jak wykorzystuje moduł; moduł opisuje jak wykorzystuje warstwę." Realizacja: adaptery jako osobny poziom `spec/adapters/AXX-*.md` z własnym szablonem.
5. **Dom rozszerzenia writing-style** (NOWE): **kanon** w `spec/index.md` → Key concepts (model 3-poziomowy + szkic szablonu adaptera + reguła jednego domu). **`CLAUDE.md`** (nowy plik) = **cienki wskaźnik** do tego kanonu (bez duplikacji reguł — żeby nie rozszczepiać źródła prawdy). Generyczny skill `layered-vertical-slices` (inline) zostaje **nietknięty** (project-specifics by go zaśmieciły).

<!-- anchor: llor444a -->
## Model strukturalny i świadome rozszerzenie skilla
Skill *Layered Vertical Slices* definiuje siatkę **2-osiową**: moduły (pionowe slice'y) × warstwy (przekrojowe konwencje). Nasz projekt dokłada trzeci, nazwany rodzaj artefaktu — **adaptery** — w `spec/adapters/`.

**Uzasadnienie zgodne ze skillem:** adaptery to w istocie **wyspecjalizowana pod-rodzina modułów-konsumentów** (pionowe slice'y, które dodaje/usuwa się przez `registerAdapter`). Dostają osobny katalog i szablon wyłącznie ergonomicznie — kształt ich treści różni się od capability-modułu (matryca konsumpcji per-capability + mapowanie zdarzeń SDK + model auth + ograniczenia resume), więc wspólny `templates/module.md` byłby słabym dopasowaniem dla obu. „3 poziomy", które widzi użytkownik, są realne jako hierarchia **konsumpcji/zależności** (adapter → capability-moduł → warstwa), ale strukturalnie to wciąż siatka *modułów-nad-warstwami* ze skilla, z adapterami jako rozpoznawalną pod-rodziną. To **świadome odstępstwo** od dosłownego modelu 2-osiowego.

**Gdzie udokumentowane (decyzja 5):** kanon w `spec/index.md` (Key concepts) — opisowo dla czytelnika *i* nakazowo dla autora (szkic szablonu adaptera). `CLAUDE.md` tylko wskazuje na ten kanon, żeby agent na starcie sesji wiedział, gdzie czytać — bez drugiego, rozjeżdżającego się źródła prawdy.

**Reguła jednego domu (quality rule 2):** matryca wsparcia + reguły degradacji (warn / skip / synthesize) dla danej zdolności żyją w **capability-module** (np. wsparcie transportów MCP per-adapter → moduł MCP; degradacja mid-turn → moduł mid-turn). Adapter tylko **linkuje** do tej matrycy i dokłada własną mechanikę SDK. M01/L2 jest domem *mechanizmu* deklaracji zdolności (`architectureCapabilities`) + taksonomii degradacji — nie danych per-(adapter × capability).

<!-- anchor: 1skf7ye3 -->
## Użytkownicy i zadania
Odbiorcy: **deweloperzy aplikacji/platform agentowych** budujący na wielu SDK agentów; wtórnie **autorzy własnych adapterów** oraz **agenci AI** utrzymujący samą bibliotekę.
Zadania (jobs-to-be-done):
1. Uruchomić prompt przez dowolny silnik i konsumować jednolity `AsyncIterable<UnifiedEvent>` bez zmiany kodu aplikacji przy podmianie agenta.
2. Dodawać/podmieniać backendy (adaptery, providery API, własne adaptery) przez rejestry, bez dotykania konsumenta.
3. Konfigurować zaawansowane zdolności jednolicie (MCP, skille, subagenci, obrazy, mid-turn) z **łagodną degradacją** gdy adapter nie wspiera.
4. Mierzyć i obserwować przebiegi (billing vs okno kontekstu, observery, audyt `adapter_ready`) oraz obsługiwać błędy/timeout/abort odpornie.
5. Budować i walidować własne adaptery (contract testing) oraz bezpiecznie ewoluować kontrakt (semver, deprecje).

<!-- anchor: 62fgeed4 -->
## System i granice zakresu
**System:** czysta biblioteka TS (ESM+CJS via tsup, Node ≥20), peer-deps opcjonalne per adapter, tree-shakeable subpath exports. Owija: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@opencode-ai/sdk`, `@google/gemini-cli-core`.
**Poza zakresem:** brak persistence/HTTP/UI/CLI; brak i18n, feature flags, background jobs (N/A dla biblioteki). Pakiet `@inharness-ai/agent-chat` — osobny pakiet, poza zakresem. `examples/` — ilustracyjne, nie modelowane. Build/tsup — opisany tylko jako konwencja w L4, nie jako moduł. Planowane adaptery Google — poza zakresem (decyzja 2).

<!-- anchor: g7kwjgys -->
## Warstwy (konwencje przekrojowe) — 6

| # | Warstwa | Cel (1 linia) | Implementor |
|---|---------|---------------|-------------|
| L1 | Unified Contract | Typowany słownik (`UnifiedEvent`, `NormalizedMessage`/`ContentBlock`, `RuntimeExecuteParams`, `UsageStats`), do którego każdy adapter normalizuje | M01 |
| L2 | Capability & Degradation | Mechanizm deklaracji wsparcia per-architektura + taksonomia degradacji (warn / skip / synthesize) | M01 (`capabilities.ts`) |
| L3 | Configuration & Extensibility | Schematy kluczy `architectureConfig` (ArchOption), flagi resume-immutability, rejestry adapterów/providerów | M01 (`options.ts`, factory) |
| L4 | Public API & Packaging | Eksporty, tree-shakeable subpath entry points, model peer-dependencies, semver/deprecje | external — tsup + `package.json` |
| L5 | Testing & Conformance | Asercje kontraktowe + konwencje e2e/normalizacji | M12 |
| L6 | Auth & Credentials | Każdy adapter deklaruje model auth: domyślny, z providerem, wymagane env, tryb porażki (`AdapterInitError`) | external — wrapped SDKs (konsumenci: adaptery) |

<!-- anchor: 90pznomb -->
## Adaptery (trzeci poziom) — 4

Katalog `spec/adapters/`. Każdy adapter konsumuje warstwy (L1/L2/L6) **oraz** capability-moduły (M02–M11…) i opisuje *jak* mapuje swoje SDK na jednolity kontrakt.

| # | Adapter | SDK | Wyróżniki |
|---|---------|-----|-----------|
| A01 | claude-code | `@anthropic-ai/claude-agent-sdk` | Adapter referencyjny; jedyny z `subagentDefinition` + `midTurnPush` = true; presety system prompt |
| A02 | codex | `@openai/codex-sdk` | Syntetyczny streaming; delta z usage kumulatywnego (`priorUsage`, cross-process); sandbox |
| A03 | opencode | `@opencode-ai/sdk` | SSE; MCP tylko stdio; `question.asked`; wymaga CLI w PATH |
| A04 | gemini | `@google/gemini-cli-core` | Thought summaries (`replace:true`); OAuth free-tier |

<!-- anchor: 4qidz7f3 -->
## Szablon adaptera (`spec/adapters/AXX-*.md`)
Świadome rozszerzenie `templates/module.md`. Sekcje:
1. **Purpose & SDK identity** — owijane SDK, zakres wersji (peer-dep), test dostępności (`isOpencodeAvailable`).
2. **Event mapping (L1)** — tabela: zdarzenia SDK → `UnifiedEvent`; specyfika normalizacji (np. codex syntetyczny streaming, gemini `replace:true`).
3. **Capability support & degradation (L2)** — link do matrycy każdego capability-modułu (matryca jest tam, nie tu) + mechanika SDK wypełniająca/degradująca daną zdolność.
4. **Per-capability consumption** — jak wpina MCP, skille, modele/aliasy, obrazy, subagentów, mid-turn, resume, usage (linki do capability-modułów).
5. **Auth model (L6)** — domyślny / przez provider / wymagane env / tryb porażki (`AdapterInitError`).
6. **Edge cases & Acceptance criteria** — AC jako encje, tag `aNN` / `aNN-edge`, embed `<tagged_list type="ac" tags="aNN"/>`.

<!-- anchor: sz5rtx6k -->
## Capability-moduły (vertical slices) — 14

| # | Moduł | Złożoność | Warstwy | Zakres |
|---|-------|-----------|---------|--------|
| M01 | Unified Core & Factory | complex | L1,L2,L3,L4 *(impl L1–L3)* | Typy kontraktu, taksonomia zdarzeń, `createAdapter`/`registerAdapter`/`listArchitectures`, mapa zdolności, schemat ArchOption |
| M02 | Models & aliases | medium | L3,L4 | `MODEL_ALIASES`, `resolveModel`, okna kontekstu, `ADAPTIVE_THINKING_ONLY` |
| M03 | Providers | medium | L3,L4,L6 | Presety minimax/ollama/openrouter, `registerProvider`, aliasy architektur |
| M04 | MCP integration | complex | L1,L2,L4 | 4 transporty, `createMcpServer`/`mcpTool`, **matryca wsparcia per-adapter** |
| M05 | Inline skills & disk discovery | complex | L1,L2,L4 | Materializacja `InlineSkill` + dostarczanie per-adapter; `listDiskSkills`/`getSkillSearchDirs` |
| M06 | Subagents | medium | L1,L2,L4 | Obserwacja zdarzeń lifecycle + definiowanie (`SubagentDefinition`, `validateSubagents`) |
| M07 | Session resume & immutability | medium | L1,L3,L4 | Semantyka resume + `getSessionResumeConstraints`/`findResumeViolations`/`isSessionFieldMutable` |
| M08 | Token usage & metrics | medium | L1,L4 | Billing vs `contextSize`, agregacja, pola cache, `priorUsage` (cross-process codex) |
| M09 | Stream consumption | medium | L1,L4 | Observery (`observeStream`, `createConsoleObserver`) + `collectEvents`/`filterByType`/`splitBySubagent`/… |
| M10 | Image input | medium | L1,L2,L4 | `ImageInput` + materializacja per-adapter |
| M11 | Mid-turn injection / streaming input | medium | L1,L2,L4 | `pushMessage`, `streamingInput`, `user_message`, **degradacja gdy `midTurnPush`=false** |
| M12 | Conformance, evolution & release | medium | L4,L5 *(impl L5)* | `assert*`, `ContractResult`, eksport `/testing`, e2e; semver, deprecje, checklist rozszerzania kontraktu, release-process |
| M13 | Errors, resilience & process hardening | medium | L1,L4 | Hierarchia `AdapterError` (init/runtime phase, OS-field hoisting, `toJSON`), timeout, abort, stdin guard (Passenger/CageFS) |
| M14 | Startup audit & secret redaction | medium | L1,L4 | Zdarzenie `adapter_ready`, `redact.ts`, gwarancja „safe to log", kolejność warning→ready |

<!-- anchor: risywwjt -->
### Opcjonalne konsolidacje (jeśli wolimy mniej modułów → 12)
- M08 + M09 → „Konsumpcja strumienia i metryki".
- M10 + M11 → „Wejście promptu i mid-turn".

<!-- anchor: i0iyfej8 -->
## Ścieżka realizacji (fazy bootstrap)
- **Faza 0 — Czyszczenie obcych encji.** Dla każdego z 14 AC: `find_references` + `check_consistency` → raport wpływu (oczekiwane 0 referencji, pages=0). Po potwierdzeniu: `delete_ac` ×14, następnie `delete_tag` m06/m19/m20. (entity_change_protocol: raport wpływu PRZED `delete`.)
- **Faza 1 — Plan (ten dokument).** Potwierdzenie users&jobs, granic, warstw, capability-modułów, adapterów, szablonu adaptera, modelu 3-poziomowego.
- **Faza 2/3 — Potwierdzenie warstw i artefaktów** (powyższe tabele) — zrobione w planie.
- **Faza 4 — Szkielet.** `spec/index.md` (z szablonu + sekcja Key concepts dokumentująca 3-poziomowe rozszerzenie + szkic szablonu adaptera = **kanon**), `CLAUDE.md` (**cienki wskaźnik**: spec w `spec/`, 3. typ artefaktu = adaptery, przed edycją czytaj `spec/index.md` → Key concepts; wiedza o kodzie → `.claude/skills/`), 6× `spec/layers/LX-*.md` (thin: purpose + role + slice schema), 14× `spec/modules/MXX-*.md` (tylko dotykane warstwy), 4× `spec/adapters/AXX-*.md` (szablon adaptera).
- **Faza 5 — Wypełnianie capability-modułów M01→M14.** Substancja (Purpose, Edge cases, AC) + sekcje per-warstwa. AC jako encje `ac` (tag `mNN`/`mNN-edge`, `kind`, `verifies`), embed `<tagged_list type="ac" tags="mNN"/>`. Matryce degradacji per-capability lądują tutaj.
- **Faza 6 — Wypełnianie adapterów A01→A04.** Szablon adaptera; linkują capability-moduły i ich matryce. AC `aNN`/`aNN-edge`.
- **Faza 7 — Warstwy + przebiegi hartujące + diagram.** Cienkie pliki warstw (slice schema). Drugi przebieg implementorów (M01 dla L1/L2/L3; M12 dla L5). Diagram relacji w indeksie (adapter → capability-moduł → warstwa). Przebiegi production-hardening: auth (L6), audyt/redakcja (M14), odporność (M13), ewolucja kontraktu (M12).

<!-- anchor: xapzc2kt -->
## Ryzyka / otwarte pytania
- 14 capability-modułów na górnej granicy production-hardened (8–15) — do akceptacji lub konsolidacji (→12, patrz opcje). Adaptery (4) liczone osobno, nie wliczają się do budżetu modułów.
- Model 3-poziomowy to świadome rozszerzenie skilla — ryzyko, że kolejny agent potraktuje adaptery jak zwykłe moduły. Mitygacja: jawna dokumentacja w `spec/index.md` + `CLAUDE.md` wskaźnik + osobny katalog/szablon + A-numeracja.
- M01 prawdopodobnie przekroczy ~250 linii → lazy split do `spec/modules/M01-unified-core/` w Fazie 5.
- L6 Auth vs L3 Config — auth można wchłonąć do L3; trzymane osobno dla rygoru hardeningu (do decyzji).
- Delete vs deprecate obcych AC — domyślnie delete (kontaminacja z innego projektu, brak wartości historycznej); deprecate jako wariant miękki.
