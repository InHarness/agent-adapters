---
type: plan
title: Idle clock re-arm + public keepAlive
created_at: '2026-09-22T19:53:52.052Z'
created_by: agent
applied: true
---
# Plan — cap na pracę w locie, zegar bezczynności bez zmian

<!-- anchor: rs2ak7e1 -->
## 1. Intencja (jak to czytam)

Właściciel: **żaden twardy limit czasu nie może przerwać pracy, która widocznie trwa** — i symetrycznie, praca, która stanęła, nie może trzymać tury w nieskończoność. Powód teraz: konsument (claude4spec) uruchamia dziecko przez MCP tool `runTransagent`; dziecko emituje zdarzenia godzinami i mimo to ginie z `AdapterIdleTimeoutError`; odwrotnie — zawieszony tool bez żadnych sygnałów trzyma turę bez końca, bo zegar jest spauzowany.

Pierwotnie planowano osiągnąć to przez odwrócenie `idleTimeoutMs` w zegar ciszy przezbrajany każdym zdarzeniem (heartbeat). **Właściciel wycofał się z tego wariantu** po analizie przypadków (§3). Ten plan realizuje tę samą intencję przez domknięcie mechanizmu, który kontrakt już zapowiada, a którego nie dostarcza.

Zakres planu: **specyfikacja** (strony + encje `ac`). Wersja pakietu, treść CHANGELOG i kod `src/idle-clock.ts` są artefaktami wydania poza korpusem — plan mówi, jak je sklasyfikować, nie zapisuje numeru wersji.

<!-- anchor: qnapv4fd -->
## 2. Rozstrzygnięcie

Model outstanding-work w `modules/M01-unified-core.md#8do90d06` **zostaje bez zmiany semantyki**. Konflikt zgłoszony w poprzedniej wersji planu — akapit odrzucający „re-arm on the last sign of life" — **znika, bo nie ma już czego przegłosowywać**. M13, M06, M11 nie wymagają przepisywania; żadne kryterium akceptacji nie traci prawdziwości.

Realna luka jest gdzie indziej i kontrakt sam ją nazywa. `modules/M01-unified-core.md#8do90d06`:

> "Outstanding work is not unbounded work — while it is outstanding the run is bounded by *that work's own cap* rather than by nothing, M17's hold cap being the existing instance of that shape, which this model generalises rather than competes with."

Zdanie jest w kontrakcie od początku, a **poza hold capem M17 nie ma ani jednej instancji**. `tool_use` bez `tool_result` nie ma własnego capu; otwarty subagent nie ma własnego capu. Plan wypełnia dokładnie to: jeden cap na element listy outstanding, każdy w kształcie hold capu — opcjonalny, bez defaultu, zbrojony przy rozpoczęciu tej pracy, terminalny, z własną klasą błędu. Wszystko addytywne, więc **minor**, nie major.

<!-- anchor: dc8s8vzp -->
## 3. Macierz przypadków (baza rozstrzygnięcia)

Zebrana z tabel mapowania zdarzeń wszystkich czterech adapterów i z M04. Zasada właściciela brzmi „praca, która **widocznie trwa**, nie ginie"; heartbeat zakładał, że „widocznie trwa" = „emituje `UnifiedEvent`".

| # | Przypadek | Sygnał na strumieniu w trakcie | Heartbeat | Outstanding-work |
| --- | --- | --- | --- | --- |
| A | **Blokujące wywołanie narzędzia** — MCP (`runTransagent` od strony rodzica), `Bash`, `Read` | **żadnego.** `modules/M04-mcp-integration.md#bswjwsmn`: wywołanie MCP normalizuje się do `tool_use` + `tool_result` i niczego więcej; `notifications/progress` nie jest forwardowane. Taksonomia M01 nie ma członu `tool_progress` | ❌ ginie | ✅ |
| B | **Zadanie w tle robiące robotę** | rodzina `background_task_*` bez gwarantowanej kadencji `progress`; `modules/M17-background-tasks.md#01or0cpk`: *„the unified stream itself carries lifecycle, not the process's stdout"* | ⚠️ tylko gdy silnik akurat gada | ✅ |
| C | **Subagent** | **jest** — `adapters/A01-claude-code.md#mn3ytsj4`: `task_progress` → `subagent_progress { lastToolName }` w trakcie otwartego `Agent` `tool_use`; A04 tylko gdy jest `threadId` | ✅ A01/A04, ❌ A02 | ✅ |
| D | **Tura zagnieżdżona / peer agent** | **żadnego, z definicji** — `modules/M06-subagents.md#4b8iv50p`: *„nothing on the unified stream"* | ❌ | ✅ |
| E | **Praca na codex** | `adapters/A02-codex.md#t2v9clpy`: wszystko jako `item.completed`; `tool_use` i `tool_result` emitowane razem z zakończonego itemu | ❌ | ✅ |
| F | **`user_input_request` — wolny człowiek** | żadnego | ❌ | ✅ |
| G | **`streamingInput` między pushami** | żadnego | ❌ | ❌ **luka obu modeli** |
| H | **Model strumieniuje na A01/A03** | delty per token | ✅ | ✅ |

**Dwa wnioski, które ustawiają ten plan.**

1. **Zakres jest odwrotny do intuicji ze zgłoszenia.** Zadania w tle są *lepiej* pokryte — mają własną rodzinę zdarzeń i własną parę ograniczeń. Dziura jest w blokującym wywołaniu narzędzia, dla którego taksonomia nie ma żadnego słowa. `adapters/A01-claude-code.md#sw3cwrsm` pokazuje, że to dwa różne reżimy: zbackgroundowany `Bash` oddaje `tool_result` **natychmiast**, więc praca w tle nie dzieje się wewnątrz okna narzędzia.
2. **`runTransagent` ma dwa zegary.** Dziecko to osobny `execute()`, który emituje — przeżywa pod obydwoma modelami, więc jego śmierć to defekt implementacji (§8). Rodzic widzi wywołanie MCP, czyli przypadek A — cisza przez cały czas pracy dziecka, chroniona dziś przez `tool_use` bez `tool_result`.

<!-- anchor: mc8w9f5n -->
## 4. Wpis 1 — M01: cap na wywołanie narzędzia

- **Adres:** `modules/M01-unified-core.md`, `## Unified Contract (L1) — implementor`, anchor `8do90d06`.
- **Pole schematu (L1, tryb implementor):** „event taxonomy … and the invariants that hold across all adapters" — to runtime, nie zasada wypełniania, więc moduł-implementor, nie plik warstwy (reguła 2, test *filling vs behavior*). **Żadnej zmiany w `layers/L1-unified-contract.md`.**
- **Treść:** nowe pole `RuntimeExecuteParams.toolCallTimeoutMs?: number` (nazwa — otwarte pytanie 1). Bounduje **pojedyncze** wywołanie narzędzia: zbrojone przy `tool_use`, rozbrajane przy pasującym `tool_result`, przezbrajane **per wywołanie, nie per bieg** — dwa kolejne wywołania dostają pełną wartość każde. Wygaśnięcie terminalne, własna klasa błędu (wpis 3).
- **To jest instancja zdania, które sekcja już zawiera** — akapit „Outstanding work is not unbounded work" zyskuje drugi przykład obok hold capu M17 i trzeba go o niego rozszerzyć, zamiast pisać regułę od nowa.
- **Pominięcie = brak jakiegokolwiek limitu**, dokładnie jak przy `timeoutMs`. Istniejące <inline_mention type="ac" slug="ac-with-timeoutms-absent-no-adapter-arms"/> już to przewiduje — mówi *„a bound armed on something other than run start … is unaffected"* — więc nowy cap mieści się w jego wyjątku i kryterium **nie wymaga zmiany**.
- **Akapit „This makes four clocks"** — pięć zegarów. Dopisać wiersz: zbrojony przy `tool_use`, przezbrajany per wywołanie, wygaśnięcie terminalne i typowane. Zdanie „none substitutes for another" zostaje bez zmian, bo nadal jest prawdą.
- **`timeoutMs` i `idleTimeoutMs` bez zmian.** To jest odpowiedź na punkt 3 zgłoszenia: specyfikacja **już** mówi „Omitting the field is a guarantee, not a default".
- **Kolizja z capem subagenta — kontrakt musi ją rozstrzygnąć, inaczej nowe pole ucina subagentów zamiast zawieszonych narzędzi.** Na A01 subagenta otwiera `tool_use` narzędzia `Agent`/`Task`, więc otwarty subagent **jest** niesparowanym `tool_use`: oba ograniczenia zbroiłyby się na tym samym obiekcie, a wygrywałoby krótsze. Do napisania wprost: `tool_use`, które otwiera subagenta, podlega wyłącznie capowi subagenta (wpis 4).
- **Zadanie w tle nie koliduje.** Zbackgroundowany `Bash` oddaje `tool_result` natychmiast (`adapters/A01-claude-code.md#sw3cwrsm`), więc cap rozbraja się, zanim pracę przejmuje M17. Jedno zdanie, żeby nikt nie szukał konfliktu, którego nie ma.
- **Tura zagnieżdżona przez MCP** (`runTransagent`) podlega płaskiemu capowi po stronie rodzica, a dziecko ma własny komplet zegarów. Konsument ustawia cap rodzica z zapasem albo nie ustawia go wcale — i to jest dokładnie ta gwarancja, którą niesie „Omitting the field is a guarantee".

<!-- anchor: qlyq9eg7 -->
## 5. Wpis 2 — M01 + M11: oczekiwanie na push jako praca w locie

Przypadek G z macierzy — jedyny, w którym zawodzą oba modele.

- **Adres:** `modules/M01-unified-core.md#8do90d06`, wyliczenie „What counts as outstanding". Dopisać szóstą pozycję: sesja `streamingInput` z otwartym kanałem wejściowym, czekająca na kolejny push. Uzasadnienie w tym samym kształcie co przy `user_input_request`: to producent po stronie konsumenta jest wolny, a nie silnik zamilkł.
- **Adres:** `modules/M11-mid-turn-input.md`, `## Unified Contract (L1)`, anchor `fr2hhuye`. Zdanie „one backstop and one idle clock span the whole of it, so a push buys no fresh budget" **zostaje bez zmian dla backstopu**; dla idle dochodzi jedno zdanie, że otwarty kanał jest pracą w locie, więc zegar bezczynności nie biegnie między pushami. Sesję nadal kończy opróżnienie kanału, `timeoutMs` albo `abort()` — zgodnie z tym, co sekcja już mówi.
- **Rozważona alternatywa:** zostawić lukę i oddać ją konsumentowi przez publiczny sygnał życia. Odpadła razem z `keepAlive()` (§13.3) — i nawet gdyby została, dopisanie do listy jest lepsze: nie wymaga od konsumenta niczego, a zachowanie sesji strumieniowej przestaje zależeć od tego, czy host pamięta o pompowaniu.

<!-- anchor: 1z08ly4j -->
## 6. Wpis 3 — M13: klasa błędu dla capu narzędzia

- **Adres:** `modules/M13-errors-resilience.md`, `## Unified Contract (L1)`, anchor `8q9q7ty7`. Nowa klasa `AdapterToolCallTimeoutError`: faza `runtime`, terminalna, dostarczana jako `{ type:'error', error }`, nigdy rzucana z iteratora. Zgodnie z regułą tej sekcji („each carries the datum a consumer needs to act") niesie `toolName` i `toolUseId` wywołania, które ucięła, i przenosi je przez `toJSON`.
- **Rozróżnialność:** trzy klasy czasowe stoją teraz obok siebie i sekcja musi powiedzieć, co je różni — `AdapterTimeoutError` („bieg przeżył swój budżet"), `AdapterIdleTimeoutError` („bieg zamilkł, nic nie będąc winien"), `AdapterToolCallTimeoutError` („jedno wywołanie stanęło"). Trzy różne diagnozy, trzy różne reakcje konsumenta.
- **Adres:** `modules/M13-errors-resilience.md`, `## Edge cases`, anchor `1vd9sye5`. Nowy wiersz obok istniejących: `toolCallTimeoutMs` wygasa → `AdapterToolCallTimeoutError` (faza runtime), bieg zatrzymany tą samą ścieżką co przy `timeoutMs`. **Zdanie o `user_input_request` zostaje bez zmian** — nieodpowiedziane pytanie to nadal outstanding work i nadal nie może zakończyć biegu na zegarze bezczynności.
- Reguła wyścigu abort-vs-handler zostaje bez zmian; dochodzi do niej `AdapterToolCallTimeoutError` jako trzeci powód terminacji parkującej tury.
- **M13 nadal nie opisuje, co porusza zegary** — to zostaje u M01 (jedna treść, jeden dom).

<!-- anchor: v24shj49 -->
## 7. Wpis 4 — M06: cap na otwartego subagenta

- **Adres:** `modules/M06-subagents.md`, `## Edge cases`, anchor `4b8iv50p`.
- **Zdanie „That list of triggers is complete, and the idle clock is missing from it on purpose" zostaje prawdziwe** — zegar bezczynności nadal nie jest wyzwalaczem. Rozszerza się natomiast sama lista wyzwalaczy syntezy: obok `abort()`, `timeoutMs` i hold capu staje wygaśnięcie capu subagenta. Synteza domykającego `subagent_completed { status: 'aborted' }` działa tą samą ścieżką i pod tą samą regułą „co najwyżej raz na `taskId` na terminację".
- **Pole i jego dom:** `subagentTimeoutMs?` mieszka typem w `RuntimeExecuteParams` (M01, jak `allowedPaths` dla M15 i `disallowedToolGroups` dla M18 — „type home is here"), a semantykę trzyma M06. Reguła 2: to zachowanie runtime tego modułu, nie zasada wypełniania.
- **Encja do aktualizacji:** <inline_mention type="ac" slug="ac-a-subagent-still-in-flight-when-abort"/> wylicza wyzwalacze terminacji wprost — dopisać do niej czwarty. To update tytułu, nie dezaktywacja.
- **Cap subagenta się przezbraja** — `subagent_started` i `subagent_progress` dla tego `taskId` wracają go do pełnej wartości. Ten sam kształt co hold cap M17 po wpisie 5: zamknięty słownik zdarzeń **jednej jednostki pracy**, a nie dowolny ruch na strumieniu. Bez re-armu cap uciąłby długiego, zdrowego subagenta — czyli złamałby intencję, którą realizuje.
- **Zasada do nazwania w `8do90d06`, bo rozstrzyga też wpis 5 i zamyka spór z §3.** Ograniczenie wolno opierać na sygnale, którego nierówność między adapterami jest **już zadeklarowana w macierzy L2** — lifecycle subagenta ma taki wiersz w `modules/M06-subagents.md#1zx424gy`, rodzina background w `modules/M17-background-tasks.md#ujhcafnf`. Nie wolno opierać go na sygnale, którego nierówności nie deklaruje **żadna** macierz — a taką jest surowa kadencja zdarzeń (§15). To jest cała różnica między capem przezbrajanym słownikiem a heartbeatem.
- **Czy potrzebny jest trzeci cap, na turę zagnieżdżoną (przypadek D)? Nie.** Tura zagnieżdżona to osobny `execute()` z własnym kompletem zegarów — jej capem jest jej własny cap. To warto powiedzieć wprost w `8do90d06`, bo inaczej wyliczenie outstanding wygląda na niekompletne wobec wpisów 1 i 4.

<!-- anchor: 8h677411 -->
## 8. Wpis 5 — M17 + A01: hold cap przezbrajany postępem

Inwentarz zegarów z punktu 5 zgłoszenia, z werdyktem po rozstrzygnięciu:

| Zegar | Dziś | Werdykt |
| --- | --- | --- |
| `timeoutMs` (backstop) | opcjonalny, brak defaultu, nigdy się nie przezbraja | zostaje — konsument ustawia go świadomie |
| `idleTimeoutMs` | model outstanding-work | **zostaje bez zmian semantyki**; rozszerza się tylko lista outstanding (wpis 2) |
| hold **grace** (~15 s, A01) | re-arm każdą zaparkowaną ramką, wygaśnięcie ciche | nie jest limitem czasu pracy — nie przerywa niczego, kończy parkowanie. Bez zmian |
| hold **hard cap** (~90 s, A01) | zbrojony przy wstrzymanym `result`, **bez re-arm na postępie**, wygaśnięcie terminalne | **narusza intencję** — ubija odcinek, w którym zadanie widocznie raportuje postęp. Konwersja na re-arm |
| `toolCallTimeoutMs` | nie istnieje | nowy (wpis 1) |
| `subagentTimeoutMs` | nie istnieje | nowy (wpis 4) |
| default `collectEvents()` (~120 s) | zegar konsumencki, liczony od startu biegu, z defaultem w bibliotece | **narusza intencję** (wpis 6) |
| `abort()` | ręka konsumenta na tym samym wyłączniku | nie jest zegarem, zostaje |

- **Adres:** `modules/M17-background-tasks.md`, `## Edge cases`, anchor `q9u5sbot` — hold cap przezbraja się **każdym `background_task_started/_progress/_completed` dla śledzonego zadania**; wygasa po N ms bez takiego zdarzenia przy nieosiadłej pracy. Świadomie **nie** przezbrajają go ramki transportowe (`system/status`, `background_tasks_changed`) — one przezbrajają grace.
- **To nie jest heartbeat tylnymi drzwiami, i sekcja musi to powiedzieć.** Różnica jest w słowniku: cap przezbraja się zamkniętym zbiorem zdarzeń **tego konkretnego zadania**, a nie dowolnym ruchem na strumieniu. Dlatego `sleep 3600`, który nic o sobie nie mówi, nadal jest ograniczony, a build raportujący postęp — nie.
- Zostaje: zwolnienie capu przy pierwszej ramce modelu w turze kontynuacji, re-entry `taskId` przezbrajające oba ograniczenia (<inline_mention type="ac" slug="ac-a-taskid-re-entering-the-in-flight-se"/> bez zmian), zakaz odpalenia któregokolwiek ograniczenia w trakcie produkcji modelu.
- **Adres:** `modules/M17-background-tasks.md`, `## Configuration & Extensibility (L3)`, anchor `52ymvppn` — klucze zostają, zmienia się opis capu (teraz „cisza śledzonego zadania", nie „długość postoju"). Reguła „wartość niepoprawna degraduje do domyślnej, `0` nie rozbraja" zostaje.
- **Adres:** `adapters/A01-claude-code.md`, `## Per-capability consumption`, anchor `sw3cwrsm` — zmierzone stałe (15 s / 90 s) zostają jako punkt startowy, ale uzasadnienie capu trzeba przepisać: dziś brzmi „poniżej 120 s `collectEvents()`", co po wpisie 6 przestaje być argumentem.

<!-- anchor: ba72olre -->
## 9. Wpis 6 — M09: default `collectEvents()`

- **Adres:** `modules/M09-stream-consumption.md`, `## Unified Contract (L1)`, anchor `diq2em77` — **luka**: fakt, że `collectEvents()` ma własny domyślny timeout ~120 s liczony od startu biegu, jest dziś zapisany **tylko** w M01 (`8do90d06`) i w M17, po drugiej stronie granicy; M09 milczy o własnym zegarze. Dopisać go tutaj, gdzie jest jego dom.
- **Zmiana treści: default znika.** Bez podanej wartości helper czeka, aż strumień się skończy; wartość podana przez konsumenta działa jak dotąd. Rekomendacja zmieniona względem poprzedniej wersji planu, i macierz §3 mówi dlaczego: wariant „mierz ciszę strumienia" przewracał się na przypadkach A i E — na codex trzyminutowa komenda to trzy minuty ciszy, więc helper ucinałby zdrowy bieg. Helper konsumencki nie ma dostępu do stanu kontraktu, więc nie potrafi odróżnić ciszy zdrowej od stojącej i **nie powinien zgadywać**. To ta sama zasada, którą `timeoutMs` już realizuje: „Omitting the field is a guarantee, not a default".
- **Adres:** `modules/M09-stream-consumption.md`, `## Edge cases`, anchor `mjon1di2` — dopisać przypadek: strumień, który emituje bez przerwy dłużej niż dawny default, jest zbierany do końca.

<!-- anchor: ghrgwhr7 -->
## 10. Wpis 7 — M12: klasyfikacja wydania

- **Adres:** `modules/M12-conformance-release.md`, `## Public API & Packaging (L4)`, anchor `agvf1tok`.
- Polityka mówi: „additive `UnifiedEvent`/param changes are minor, removals/renames are major". **Cała ta zmiana jest addytywna** — dwa nowe opcjonalne pola, jedna nowa klasa błędu, opcjonalna metoda, jedno rozszerzenie listy outstanding i jedno usunięcie domyślnej wartości w helperze. **Minor.**
- Jeden element wymaga behawioralnej notki w CHANGELOG mimo braku zmiany sygnatury: zniknięcie domyślnych 120 s w `collectEvents()` (wpis 6). Polityka ma na to gotowy wyjątek.
- **Luka w polityce, opcjonalna do domknięcia:** nie ma opracowanego przypadku „ta sama nazwa, ten sam typ, odwrócone znaczenie". Ta zmiana go już nie potrzebuje, ale luka jest realna i została odkryta przy okazji. Do decyzji właściciela, czy domykać teraz — jeśli nie, ląduje w §14.
- Checklista rozszerzenia kontraktu z tej samej sekcji obowiązuje w całości: `types.ts` + JSDoc, każdy adapter, asercje w `shared.ts`, e2e per adapter, macierz zdolności.

<!-- anchor: mbe4zfrw -->
## 11. Wpis 8 — encje `ac`

**Zero dezaktywacji.** To jest najczytelniejszy skutek wycofania się z heartbeatu: oba kryteria, które poprzednia wersja planu unieważniała, zostają prawdą bez jednego znaku zmiany.

- <inline_mention type="ac" slug="ac-a-run-whose-only-activity-is-a-single"/> — nadal prawdziwe: `tool_use` bez `tool_result` nadal nie porusza zegara bezczynności. Nowy cap kończy taki bieg **inną** drogą i z inną klasą błędu, więc kryteria nie kolidują.
- <inline_mention type="ac" slug="ac-a-run-parked-on-an-unanswered-user-in"/> — nadal prawdziwe, bez zmian.
- <inline_mention type="ac" slug="ac-with-timeoutms-absent-no-adapter-arms"/>, <inline_mention type="ac" slug="ac-a-run-that-keeps-emitting-events-for"/>, <inline_mention type="ac" slug="ac-a-held-run-that-the-engine-resumes-is-nev"/>, trójka re-entry `taskId` — bez zmian.

**Aktualizacja (1):**
- <inline_mention type="ac" slug="ac-a-subagent-still-in-flight-when-abort"/> — dopisać wygaśnięcie capu subagenta do wyliczonej listy wyzwalaczy.

**Nowe** (`kind: "requirement"` o ile nie zaznaczono; tagi jak u sąsiadów):
1. `m01` — A run whose only activity is a `tool_use` awaiting its `tool_result` ends with `AdapterToolCallTimeoutError` once `toolCallTimeoutMs` elapses. *(edge-case, tag `m01-edge`)*
2. `m01` — `toolCallTimeoutMs` is armed per tool call, not per run: two sequential tool calls each get the full value.
3. `m01` — With `toolCallTimeoutMs` absent, no adapter arms a per-tool-call timer.
4. `m01` — A run that emits no event while a tool call is in flight is never ended by `idleTimeoutMs`, however long the tool takes. *(utrwala niezmiennik, którego zmiana nie rusza, i którego dziś nie asertuje nic po stronie capów)*
5. `m13` — `AdapterToolCallTimeoutError` reports in the runtime phase and names the `toolName` and `toolUseId` it cut short, surviving `toJSON`.
6. `m13` — `AdapterIdleTimeoutError` is distinguishable from `AdapterTimeoutError` by `name` after serialization. *(domyka lukę: dziś żaden AC nie nazywa tej klasy)*
7. `m13` — `AdapterBackgroundHoldExpiredError` names the `architectureConfig` key that moves the cap. *(ta sama luka, druga klasa)*
8. `m06` — An open subagent that exceeds `subagentTimeoutMs` ends the run and is closed by a synthesized `subagent_completed { status: 'aborted' }`. *(edge-case)*
9. `m17` — A background task emitting `background_task_progress` re-arms the hold cap and is never cut short by it.
10. `m17` — A parked stretch in which no `background_task_*` event arrives for the tracked task ends at the cap with `AdapterBackgroundHoldExpiredError`. *(edge-case)*
11. `m11` — A `streamingInput` session waiting between pushes is not ended by `idleTimeoutMs`.
12. `m09` — `collectEvents()` returns every event of a stream that keeps emitting for longer than two minutes.

Encja `module-dependency` jest w tym projekcie nieaktywna, krawędzie modułów siedzą w tabelach `## Zależności` — żadna krawędź nie powstaje ani nie znika przez tę zmianę.

<!-- anchor: 612kr8kb -->
## 12. Kolejność wykonania

0. **Warunek wstępny, przed dotknięciem specyfikacji:** zweryfikować `src/idle-clock.ts` i zmierzyć, czy objaw `runTransagent` przeżywa samo doprowadzenie kodu do zgodności z obecnym kontraktem (§14). To jedyny krok, który odpowiada danymi, a nie argumentem, i może zmienić priorytet całej reszty.
1. M01 `8do90d06` — cap narzędzia, rozszerzenie listy outstanding o `streamingInput`, zdanie o turze zagnieżdżonej, przepisany akapit zegarów. **Pierwsze, bo wszyscy pozostali cytują tę sekcję.**
2. M01 `eud2jcxh` — eksport: `AdapterToolCallTimeoutError` i nowe pola `RuntimeExecuteParams`.
3. M13 `8q9q7ty7`, `1vd9sye5`.
4. M06 `4b8iv50p`.
5. M17 `q9u5sbot`, `52ymvppn`; potem A01 `sw3cwrsm`.
6. M11 `fr2hhuye`.
7. M09 `diq2em77`, `mjon1di2`.
8. M12 `agvf1tok`.
9. Encje `ac`: aktualizacja jednej, potem nowe.
10. `index.md` `0aj92zki` — otwarte pytania, jeśli nierozstrzygnięte.

<!-- anchor: 2revaawe -->
## 13. Rozstrzygnięcia

Cztery pytania, cztery propozycje. Każda z uzasadnieniem i z tym, co zostaje decyzją właściciela, a nie wynika z korpusu.

<!-- anchor: gfzam2e2 -->
### 13.1 Nazwy pól → `toolCallTimeoutMs` i `subagentTimeoutMs`

Oś nazewnicza w tym projekcie nie przebiega między „timeout" a „cap", tylko między **powierzchniami**. Pola `RuntimeExecuteParams` są międzyadapterowe i noszą gołe nazwy: `timeoutMs`, `idleTimeoutMs`, `allowedPaths`, `disallowedToolGroups`, `autoApproveTools`. Pokrętła jednego adaptera siedzą w `architectureConfig` z prefiksem architektury: `claude_backgroundGraceMs`, `claude_backgroundHoldCapMs` (L3). Oba nowe ograniczenia są międzyadapterowe, więc idą na `RuntimeExecuteParams` z gołą nazwą; `*CapMs` importowałoby konotację `architectureConfig` i sugerowało, że to knob jednego adaptera. Sufiks `TimeoutMs` jest przy tym ustalony dla „ograniczenia, którego wygaśnięcie kończy bieg typowanym błędem".

**W prozie zostaje słowo „cap"** — M01 ma własne słownictwo (backstop / idle clock / grace / cap), a nowe ograniczenia mają kształt capu: zbrojone przy czymś innym niż start biegu, boundują odcinek. Rozjazd nazwy pola i prozy jest zamierzony i trzeba go zapisać, żeby wykonawca go nie „naprawił".

Sub-decyzja: `subagentTimeoutMs` zostaje polem **biegu**, nie polem `SubagentDefinition` — inaczej subagent spawnowany przez model, bez definicji konsumenta, nie miałby żadnego ograniczenia.

<!-- anchor: kdhwqkto -->
### 13.2 Wygaśnięcie capu narzędzia → (a) kończy bieg

Wariant (b) wymaga **podania modelowi wyniku narzędzia**. Strumień `UnifiedEvent` jest kanałem obserwacji, jednokierunkowo na zewnątrz: `tool_result` wyemitowany na strumieniu nie trafia do modelu. Kanałów do środka są cztery i żaden nie wstrzykuje wyniku narzędzia — `pushMessage()` (M11, tylko A01), odpowiedź handlera `onUserInput`, decyzje `canUseTool` (A01) i deklaratywne pola bramkujące (M15/M18).

Wszystkie bramkują **przed** dyspozycją, nigdy w trakcie. `adapters/A03-opencode.md#3iaufx4q`: *„refuse a call before it executes"*. `adapters/A04-gemini.md#oirynpg7`: `excludeTools` *„applied when the tool registry is built, before the approval policy runs"*. `modules/M18-tool-gating.md#f361hqgc` odrzucił projekt hookowy dokładnie z tego powodu: *„it cannot answer before the run"*.

Per-call stop nie istnieje na żadnym adapterze i spec mówi to wprost — `adapters/A01-claude-code.md#sw3cwrsm`: *„`Query.stopTask()` … not consumed — per-task stop and mid-run enumeration are unrealized; `abort()` remains the coarse stop"*, a `Query.interrupt()` jest ograniczone do fire-and-forget na ścieżce teardownu. Żaden adapter nie fabrykuje też `tool_result` podawanego modelowi: jedyna synteza w korpusie to deny-hook `PreToolUse` przy wyłączaniu pracy w tle — czyli znowu decyzja przed dyspozycją, routowana realną ścieżką SDK.

**Argument domykający: (b) nie może zostać kontraktem, nawet gdyby A01 podłączyło `Query.stopTask()`.** Byłoby wspierane na jednym adapterze z czterech, więc `toolCallTimeoutMs` znaczyłby „kończy wywołanie" na A01 i „kończy bieg" gdzie indziej. To samo pole, inna gwarancja per architektura — defekt, przez który odpadł heartbeat (§3, P1). Wariant (b) mógłby wejść dopiero wtedy, gdy potrafią go wszystkie cztery.

Konsekwencje (a) nie tworzą nowych reguł, tylko wchodzą do istniejących: synteza domykającego `subagent_completed { status: 'aborted' }` dla niesparowanych subagentów (M06) i brak `background_task_completed` po terminacji (M17). Obie sekcje już prowadzą listę wyzwalaczy, do której dochodzi nowy.

Wariant (b) → `index.md` open questions, zawiązany na konsumpcję `Query.stopTask()` i jej odpowiedników w pozostałych trzech SDK.

<!-- anchor: wegi563q -->
### 13.3 `keepAlive()` → odrzucone
**Rozstrzygnięte przez właściciela: metoda nie wchodzi.** Wpis, kryteria 13–15 i eksport z `eud2jcxh` usunięte z planu.

Powód, dla którego pytanie w ogóle padło: po wycofaniu się z heartbeatu `keepAlive()` traci każdy nazwany przypadek użycia. F pokrywa `user_input_request` na liście outstanding, G pokrywa wpis 2, a konsument z wiedzą pozastrumieniową o dziecku (`runTransagent`) jest pokryty przez `tool_use` bez `tool_result`. Metoda publiczna bez przypadku użycia to koszt bez korzyści, a ta akurat ma koszt konkretny: byłaby jedynym miejscem, w którym konsument może po cichu rozbroić ograniczenie, opakowując ją w `setInterval`.

Przedstawiony i odrzucony kontrargument: że brak takiego wyłącznika jest świadomą luką, a nie oszczędnością, jeśli zasada brzmi „biblioteka nigdy nie ma prawa ubić czegoś, o czym mówię, że żyje".

Skutek dla kontraktu: jedynym sposobem na przedłużenie biegu zostaje praca, którą kontrakt widzi jako pracę w locie. Metoda jest addytywna, więc gdyby kiedyś pojawił się konkretny przypadek konsumencki, wprowadzi ją zwykły minor — nic przez to rozstrzygnięcie nie przepada.
<!-- anchor: 6tybn9uc -->
### 13.4 Luka semver → domknąć, jednym zdaniem, bez AC

M12 istnieje po to, żeby rozstrzygać klasyfikacje **zanim** się zdarzą — sama sekcja ostrzega, że *„'it's a security fix' is not a semver category"*. Polityka ze znaną nieobsłużoną sprawą jest defektem modułu niezależnie od tego, czy akurat ta zmiana jej potrzebuje, a domknięcie kosztuje jedno zdanie przy `agvf1tok`. Jeśli nie teraz, to ustalenie ginie razem z wątkiem — nic w grafie go nie przypomni.

Bez AC: cała polityka semver nie ma dziś żadnego kryterium (§15), więc dołożenie jednego akurat do tej sprawy byłoby arbitralne. Brak asercji dla polityki zostaje osobnym, zapisanym brakiem.

<!-- anchor: gqfglwgf -->
## 14. Widziane, nieplanowane

- **Specyfikacja i kod rozjeżdżają się niezależnie od tej zmiany.** Spec opisuje `idleTimeoutMs` jako model outstanding-work, a `src/idle-clock.ts` (0.9.11+) jako budżet kumulatywny „deliberately NOT a re-arm" — czyli ani jeden model, ani drugi. To najprawdopodobniejsze źródło zgłoszonego objawu i dlatego stoi jako krok 0, ale samo zadanie jest poza planem: spec nie opisuje kodu (reguła no-code).
- **`modules/M04-mcp-integration.md#fv7bhx0s` / `#wxyessab` kontra `adapters/A03-opencode.md#d9ugsejh`** — M04 mówi, że opencode pomija nieobsługiwane transporty MCP *„with a warning"*, A03 mówi, że *„silently, with no per-server warning"*. Dwie strony wprost się przeczą i żadna tego nie sygnalizuje. Znalezione przy czytaniu M04 na potrzeby przypadku A, poza intencją tego planu.
- **`modules/M12-conformance-release.md#9zhdfqmb`** — polityka semver nie ma żadnego AC; ten plan nie domyka tego, bo klasyfikacja wyszła na minor i nowy AC nie jest już potrzebny.
- **Kadencja zdarzeń nie jest nigdzie zdolnością.** `layers/L2-capability-degradation.md#au14qdu4` to sam schemat, a żadna macierz modułu nie ma wiersza o tym, jak gęsto adapter mówi — mimo że A02 emituje jeden `text_delta` na wiadomość, a A01 jeden na token. Dla tego planu to już nie ma znaczenia, ale dla każdego konsumenta budującego UI postępu — ma.
- **`index.md#0aj92zki`** — otwarte pytanie 9 (agent-to-agent messaging) dotyka M06/M17 i przypadku D z macierzy; sąsiaduje z tematem, poza intencją.
