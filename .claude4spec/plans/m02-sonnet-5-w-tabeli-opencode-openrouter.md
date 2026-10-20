---
type: plan
title: M02 — sonnet-5 w tabeli opencode-openrouter
created_at: '2026-07-28T11:24:03.396Z'
created_by: agent
---
<!-- anchor: 91281tus -->
## Ustalenie faktów (weryfikacja spec ↔ kod)

`sonnet-5` **jest** dowieziony dla architektury `claude-code` — spójnie w spec i w kodzie:

- spec, tabela *claude-code models*: `sonnet-5` → `claude-sonnet-5`, 1 000 000, adaptive-only ✓
- `src/models.ts`: alias (`'sonnet-5': 'claude-sonnet-5'`), członkostwo w `ADAPTIVE_THINKING_ONLY`, okno 1M
- `src/options.ts`: `sonnet-5` w enum opcji modelu dla claude-code
- `src/models.test.ts`: `claude-sonnet-5` w oczekiwanym zbiorze `ADAPTIVE_THINKING_ONLY`

Luka jest **wyłącznie** w architekturze `opencode-openrouter` — tam katalog ma `claude-fable-5`, `claude-opus-5`, `claude-opus-4.8`, `claude-sonnet-4.6`, ale **nie ma `claude-sonnet-5`**. To samo w kodzie (`src/models.ts` — mapa aliasów openrouter i mapa okien kontekstowych). Czyli spec i kod są zgodne; brakuje pozycji w obu (spec first).

Precedens: `opus-5` został wprowadzony dwutorowo — wpis w tabeli claude-code **i** w tabeli openrouter, plus dedykowane AC i test „is reachable through opencode-openrouter as a vendor-prefixed id”. `sonnet-5` tego drugiego toru nigdy nie dostał.

<!-- anchor: uk0c8k4u -->
## Zakres zmian (tylko spec — kod idzie osobnym briefem)

1. **`spec/modules/M02-models-aliases.md`, sekcja „opencode-openrouter models”** — dodać wiersz nad `claude-sonnet-4.6` (pozycja 5, zgodnie z kolejnością po popularności):

   | alias | resolved id | context window |
   | --- | --- | --- |
   | `claude-sonnet-5` | `anthropic/claude-sonnet-5` | 1,000,000 |

2. **Prose pod tabelą claude-code** — bez zmian merytorycznych; ewentualnie jedno zdanie w sekcji openrouter, że modele Anthropic są tam adresowane jako `anthropic/<id>` i że kolumna *adaptive-only?* nie ma dla nich zastosowania (klasa `ADAPTIVE_THINKING_ONLY` jest kluczowana gołymi id Anthropic, więc `anthropic/claude-sonnet-5` do niej nie należy) — tylko jeśli nie jest to już powiedziane w akapicie wprowadzającym „Model catalog (L3)”.

3. **Nowe AC (entity-tools, tag `m02`)** — symetryczne do istniejącego `ac-resolvemodel-claude-code-opus-5-re`:
   `resolveModel('opencode-openrouter', 'claude-sonnet-5') returns 'anthropic/claude-sonnet-5' with a 1,000,000-token context window.`
   kind: `requirement`, status: `active`, tag: `m02`.

4. **Bez zmian** w A01/A03 — adaptery tylko linkują do tabel M02 (one-home rule), nie duplikują ich.

<!-- anchor: lqwn5pwv -->
## Konsekwencje dla kodu (poza tym threadem)

Do release brief'u, nie do tej sesji (spec assistant nie dotyka `src/`):

- `src/models.ts` — `MODEL_ALIASES['opencode-openrouter']['claude-sonnet-5'] = 'anthropic/claude-sonnet-5'` (nad `claude-sonnet-4.6`) oraz wpis `'claude-sonnet-5': 1_000_000` w mapie okien openrouter.
- `src/models.test.ts` — test reachability analogiczny do opus-5.
- `ADAPTIVE_THINKING_ONLY` — **bez zmian** (klasa dotyczy tylko gołych id `claude-code`).

<!-- anchor: oumapj6v -->
## Numerowany plan wykonania

1. Edytować tabelę *opencode-openrouter models* w `spec/modules/M02-models-aliases.md` — wstawić `claude-sonnet-5` nad `claude-sonnet-4.6`.
2. Sprawdzić akapit wprowadzający sekcji katalogu i — jeśli brakuje — dopisać jedno zdanie o niestosowalności `ADAPTIVE_THINKING_ONLY` do id z prefiksem `anthropic/`.
3. Utworzyć AC (`create_entities`, type `ac`) z treścią z pkt. 3 powyżej i otagować `m02`.
4. `check_consistency` + szybki grep, czy żadna strona nie wylicza openrouterowych aliasów po swojemu (duplikat katalogu).
5. Zaraportować, że kod wymaga osobnego briefu (pkt „Konsekwencje dla kodu”) — nie wykonywać go tutaj.
