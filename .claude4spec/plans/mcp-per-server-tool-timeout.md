---
type: plan
title: MCP per-server tool timeout
created_at: '2026-09-22T20:56:56.692Z'
created_by: agent
applied: false
---
# Plan — opcjonalny limit czasu wywołania narzędzia MCP, per serwer

<!-- anchor: krxetj39 -->
## 1. Intencja

Konsument chce móc powiedzieć: *„ten serwer MCP jest szybki — jeśli jedno wywołanie narzędzia trwa dłużej niż X, przerwij je"*, i pominąć to pole tam, gdzie długi czas jest normalny (`transagent-tools`: tury-dzieci z własnymi zegarami). Dziś `McpServerConfig` nie ma takiego pola, więc obowiązuje domyślny limit silnika (w Claude Code per-serwer `timeout` / `MCP_TOOL_TIMEOUT`, rzędu godzin) i konsument nie ma go jak ruszyć.

To jest zgodne z tym, co M01 już mówi (`modules/M01-unified-core.md#8do90d06`): *„while it is outstanding the run is bounded by that work's own cap rather than by nothing"* — dziś jedyną instancją tego kształtu jest hold cap M17. Wywołanie narzędzia MCP to outstanding work bez własnego capu po stronie biblioteki; ten plan dodaje drugą instancję. **Model outstanding-work zostaje nietknięty** — `idleTimeoutMs` nie zmienia semantyki, nie powstaje żaden nowy zegar biegu.

<!-- anchor: 91nc7swu -->
## 2. Gdzie to siedzi (i jedna korekta adresu)

Zgłoszenie prosi o „opis w M01". Reguła jednego domu stawia to gdzie indziej: **`McpServerConfig` należy do M04** (`modules/M04-mcp-integration.md#e6ebvy2b`: developerzy podają serwery przez `RuntimeExecuteParams.mcpServers`, ale kształt typu jest M04). M01 dostaje **jedno zdanie** — i to takie, które i tak tam pasuje (wpis 4).

**Luka odkryta przy okazji:** M04 **nigdzie nie wylicza pól `McpServerConfig`** per transport. L4 (`somkcqph`) nazywa tylko eksportowane symbole, L1 (`bswjwsmn`) milczy o `mcpServers`, M01 też. Cztery transporty pojawiają się wyłącznie jako nagłówki kolumn macierzy L2 i w tytule AC. Nowe pole nie ma więc tekstu, do którego by się dopisało — trzeba je opisać od zera, i warto przy okazji domknąć lukę (wpis 1).

**Nie `architectureConfig` (L3).** M04 nie ma sekcji L3 (index `0kaqumsu` deklaruje dla M04 dokładnie L1, L2, L4, L7) i cała jego zmienność per-adapter jedzie przez typowaną powierzchnię + macierz degradacji L2 — tak jak `timeoutMs`, `idleTimeoutMs`, `allowedPaths`. `architectureConfig` (`layers/L3-configuration-extensibility.md#gapa5rc5`, klucze `claude_*` / `gemini_*`) jest dla pokręteł jednego silnika; to pole jest wspólne dla wszystkich i należy do typu.

<!-- anchor: j5a8y4o8 -->
## 3. Wpis 1 — M04: pole na `McpServerConfig`

- **Adres:** `modules/M04-mcp-integration.md`, `## Unified Contract (L1)`, anchor `bswjwsmn` (semantyka pola), oraz `## Public API & Packaging (L4)`, anchor `somkcqph` (to samo pole jako część eksportowanego typu — jedno zdanie, bez powtarzania semantyki).
- **Nazwa:** `toolTimeoutMs?: number`. Nie `timeoutMs` — w tym projekcie `timeoutMs` znaczy backstop całego biegu (M01) i kolizja nazw na dwóch różnych zakresach jest dokładnie tym, czego reguła jednego domu każe unikać. Sufiks `Ms` zgodny z resztą (`idleTimeoutMs`, `claude_backgroundGraceMs`).
- **Semantyka do zapisania (po angielsku):**
  - It caps **one tool call** on this server, measured from the call leaving the engine to its result arriving. It is **not** a budget across calls and **not** a bound on the server's lifetime: ten calls of 20 s each against a 30 s cap are ten healthy calls.
  - It is **per server**, so a consumer can bound its fast servers and leave a deliberately long-running one — a server that starts child turns bounded by their own clocks — uncapped.
  - **Expiry is the engine's, not the adapter's.** The call comes back failed and surfaces the way every MCP failure already does: `tool_result` with `isError: true` (existing AC `ac-an-mcp-tool-failure-surfaces-as-tool-res`). No new `AdapterError` class, no `error` event, the run continues.
  - **Omitting the field is not a guarantee of no bound** — and this is where it differs from `timeoutMs` (M01, `8do90d06`). The library sets nothing; whatever default the engine applies to its MCP calls governs. Say so explicitly, so nobody reads the two omissions as the same promise.
  - The run-level clocks are unaffected: an in-flight MCP call is outstanding work, `idleTimeoutMs` does not advance, and `timeoutMs`/`abort()` still end the run regardless of this cap.
- **Przy okazji (rekomendowane, nie obowiązkowe dla tej luki):** dopisać w `bswjwsmn` kształt `McpServerConfig` per transport — dziś nie ma go nigdzie, więc każde kolejne pole będzie miało ten sam problem.

<!-- anchor: nprj8wrk -->
## 4. Wpis 2 — M04: macierz wsparcia (L2)

- **Adres:** `modules/M04-mcp-integration.md`, `## Capability & Degradation (L2)`, anchor `fv7bhx0s` — kanoniczny dom macierzy; adaptery **linkują** tutaj i nie duplikują (schemat L2, `layers/L2-capability-degradation.md#au14qdu4`).
- Dzisiejsza macierz ma **jeden wiersz** (`Dynamic config from mcpServers`, kolumny: claude-code | codex | gemini | opencode). Wsparcie dla `toolTimeoutMs` to **inna oś zdolności** niż transport, więc: **nowy wiersz** `Per-server tool-call timeout (toolTimeoutMs)` + własna flaga zdolności (schemat L2 mówi wprost o „capability flag(s)", liczba mnoga jest dozwolona).
- **Wartości wiersza — do weryfikacji przed zapisem, nie zgaduję:** żadna z czterech stron adapterów nie wspomina dziś o jakimkolwiek per-server timeoucie silnika (ani `MCP_TOOL_TIMEOUT`, ani `timeout` w konfiguracji serwera). Zgłoszenie podaje, że Claude Code to ma; pozostałe trzy trzeba sprawdzić w przypiętych SDK (sekcje L7 adapterów) **przed** wypełnieniem wiersza. Wstępnie, z tego co strony mówią o przekazywaniu konfiguracji:
  - **claude-code** — pass-through per serwer (`adapters/A01-claude-code.md#sw3cwrsm`: *„passes the unified `mcpServers` config straight through"*) → oczekiwane ✅, o ile SDK wystawia per-server `timeout`.
  - **codex** — `mcpServers` jest **ignorowane w całości** z jednym ostrzeżeniem (serwery rejestruje się przez `codex mcp add`), więc pole dzieli ten sam los: ❌, **bez nowego ostrzeżenia** — istniejące warn-and-ignore już to pokrywa (`adapters/A02-codex.md#dmy7oxr7`).
  - **opencode** — przechodzi tylko stdio; dla przechodzących serwerów pole albo ma odpowiednik w SDK, albo jest ⚠️ skip.
  - **gemini** — `mapMcpServersToGemini` buduje `MCPServerConfig` per transport (`adapters/A04-gemini.md#oirynpg7`); pole przechodzi wtedy i tylko wtedy, gdy `MCPServerConfig` ma odpowiednie pole.
- **Degradacja** wg domowej konwencji, zacytowanej z adapterów: ustawienie, którego silnik nie umie uszanować, degraduje **jednym** `warning` (nie per wywołanie) i bieg toczy się dalej. Dla `toolTimeoutMs` znaczy to: warn raz, że cap nie zostanie nałożony, i uruchomić serwer bez capu. **Nigdy cicho** — to jedyne miejsce, gdzie odchodzę od precedensu opencode (`adapters/A03-opencode.md#rqfg83d2` upuszcza nie-stdio *„without a per-server warning"*): milcząco zignorowany limit czasu to konsument przekonany, że ma ochronę, której nie ma.

<!-- anchor: bxkqinp3 -->
## 5. Wpis 3 — adaptery (L2, tryb konsumenta)

Po jednym zdaniu w sekcji zdolności każdego adaptera, linkującym do macierzy M04 i nazywającym mechanikę SDK, która pole wypełnia albo degraduje:
- `adapters/A01-claude-code.md#sw3cwrsm` — nazwać konkretne pole SDK, na które mapuje się `toolTimeoutMs`, i wspomnieć, że bez niego obowiązuje domyślny limit silnika.
- `adapters/A02-codex.md#dmy7oxr7` — jedno zdanie, że pole dzieli los reszty `mcpServers` (ignorowane, jedno ostrzeżenie startowe).
- `adapters/A03-opencode.md#rqfg83d2` i `adapters/A04-gemini.md#oirynpg7` — wypełnić zgodnie z wynikiem weryfikacji SDK.
- Jeżeli mapowanie wymaga konkretnej wersji SDK: `modules/M04-mcp-integration.md#9e2jmq7n` (L7, zakres `@modelcontextprotocol/sdk`) i sekcje L7 adapterów, wraz z wierszem w Verified-pin-log — workflow bumpu peer-SDK z M12 (`modules/M12-conformance-release.md#agvf1tok`).

<!-- anchor: y5hfdhg6 -->
## 6. Wpis 4 — M01: jedno zdanie

- **Adres:** `modules/M01-unified-core.md`, `## Unified Contract (L1) — implementor`, anchor `8do90d06`, przy zdaniu *„while it is outstanding the run is bounded by that work's own cap rather than by nothing, M17's hold cap being the existing instance of that shape"*.
- Dopisać, że **drugą** instancją tego kształtu jest per-serwerowy cap wywołania MCP (`toolTimeoutMs`, M04 — `bswjwsmn`), i że jest on ustawiany przez konsumenta per serwer, a jego brak oznacza domyślny limit silnika. Nic więcej — kształt typu i macierz zostają u M04.
- **Bez zmian:** akapit czterech zegarów. `toolTimeoutMs` **nie jest piątym zegarem** biegu — jest capem pojedynczej jednostki pracy, egzekwowanym przez silnik, i kończy wywołanie, nie bieg. Warto to napisać wprost, bo to pierwsze pytanie czytelnika tej sekcji.

<!-- anchor: 1eqzjbz2 -->
## 7. Wpis 5 — encje `ac`

Nowe (tagi jak u sąsiadów: `m04`, `m04-edge` dla edge-case'ów, `a01`…`a04` dla wierszy per-adapter):
1. `m04` — A per-server `toolTimeoutMs` bounds a single MCP tool call and is not consumed across successive calls to that server.
2. `m04` — An MCP server configured without `toolTimeoutMs` runs under the engine's own default, which the library neither sets nor removes.
3. `m04`, edge-case — An MCP tool call exceeding its server's `toolTimeoutMs` surfaces as `tool_result` with `isError: true` and the run continues.
4. `m04`, edge-case — An adapter that cannot honour `toolTimeoutMs` emits exactly one `warning` and runs the server uncapped.
5. `m04` — An in-flight MCP tool call is outstanding work, so `idleTimeoutMs` does not advance while it runs, whatever `toolTimeoutMs` is set to.
6. `a01` — (po weryfikacji SDK) The claude-code adapter passes `toolTimeoutMs` to the per-server MCP timeout of its SDK.

Do przejrzenia, nie do zmiany automatycznie: `ac-the-per-adapter-mcp-transport-support-ma` mówi o *transport* support matrix, a macierz przestaje dotyczyć wyłącznie transportów. Albo zostaje jak jest (wiersz transportowy nadal jest jedynym źródłem prawdy o transportach), albo dochodzi bliźniaczy AC o wierszu timeoutowym. Rekomendacja: **drugi AC**, bez ruszania istniejącego — retytułowanie encji jest mutacją, która rozjeżdża odwołania.

<!-- anchor: edpz2rf8 -->
## 8. Kolejność i klasyfikacja

1. M04 `bswjwsmn` — pole + semantyka (+ opcjonalnie kształt `McpServerConfig` per transport).
2. M04 `somkcqph` — eksportowany typ.
3. **Weryfikacja w SDK czterech silników**, dopiero potem: M04 `fv7bhx0s` — nowy wiersz macierzy + reguła degradacji.
4. Sekcje zdolności A01–A04; L7 i pin-log, jeśli dotyczy.
5. M01 `8do90d06` — jedno zdanie.
6. Encje `ac`.

**Semver (M12, `agvf1tok`):** opcjonalne pole na istniejącym typie, żadne zachowanie bez niego się nie zmienia → **minor** wg reguły bazowej („additive `UnifiedEvent`/param changes are minor"), bez obowiązkowej notki behawioralnej. Numer wersji i treść CHANGELOG to artefakty wydania, nie treść specyfikacji. Checklista rozszerzenia kontraktu z tej samej sekcji obowiązuje: `types.ts` + JSDoc nazywający wspierające adaptery, każdy adapter, asercje w `shared.ts`, e2e per adapter, macierz zdolności.

<!-- anchor: ktto34uk -->
## 9. Widziane, nieplanowane

- `modules/M04-mcp-integration.md#somkcqph` / `#bswjwsmn` — brak wyliczenia pól `McpServerConfig` per transport to luka niezależna od tego zgłoszenia; wpis 1 domyka ją tylko przy okazji.
- `adapters/A03-opencode.md#rqfg83d2` — nie-stdio serwery są upuszczane **bez** ostrzeżenia, podczas gdy reszta projektu degraduje jednym `warning`. Odstępstwo od konwencji, poza tą intencją.
- `adapters/A01-claude-code.md#e3az4o5i` — brak AC na samo pass-through `mcpServers` w claude-code; nowy wiersz macierzy tego nie naprawia.
- Konwencja nazw kluczy `architectureConfig` dla codex i opencode nie jest w spec nigdzie pokazana (tylko `claude_*` i `gemini_*`). Nie dotyczy tego planu, bo pole nie idzie przez L3.
- Plan `idle-clock-re-arm-public-keepalive.md` — wycofany decyzją właściciela; model outstanding-work zostaje. Wskazana tam rozbieżność między `src/idle-clock.ts` (budżet kumulatywny) a M01 (model outstanding-work) **nie znika wraz z wycofaniem** i pozostaje do weryfikacji.
