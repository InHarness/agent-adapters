---
type: brief
from_release: 0.9.12
to_release: null
generated_at: '2026-09-22T16:40:21.318Z'
implemented: false
---
# Brief: 0.9.12 → (unreleased)

> **Typ: ANALIZA (analysis).** Ten dokument opisuje rozjazd między kodem a kontraktem
> i przygotowuje późniejszą implementację. **Nie jest zapisem wykonanych zmian.**
> W trakcie jego powstawania nie zmieniono kodu ani specyfikacji.
> `to_release` pozostaje otwarty (`null`).
>
> **Proweniencja ustaleń.** Autor briefu pracował w wątku bez dostępu do plików
> (brief thread ma wyłącznie brief-tools + release-tools; podagenci dziedziczą to
> ograniczenie). Wszystkie numery linii, nazwy pól i fragmenty kodu poniżej pochodzą
> ze zgłoszenia zlecającego, nie z odczytu drzewa roboczego. Każdy z nich jest
> oznaczony jako **[do potwierdzenia przy wejściu w kod]** tam, gdzie od dokładnego
> brzmienia zależy poprawka. Fragmenty, których zlecający nie podał (nazwy testów,
> kształt zdarzenia ostrzeżenia), są niżej wprost nazwane jako nieznane — nie zostały
> zmyślone.

## Kontekst

Adapter Codex (moduł **A02**) w repozytorium `@inharness-ai/agent-adapters` rozjechał się
z własnym, już obowiązującym kontraktem. Nie chodzi o nowe możliwości SDK ani o nadrobienie
zaległości względem `@openai/codex-sdk` — chodzi o trzy miejsca, w których **kod nie dowozi
tego, co publiczne API biblioteki i specyfikacja już obiecują**. Jedno z nich (P0) powoduje
ciche zignorowanie konfiguracji użytkownika, czyli awarię bez komunikatu. Zakres jest celowo
zawężony do poprawności istniejącego kontraktu, żeby poprawki dało się wdrożyć bez
uprzednich decyzji specyfikacyjnych.

Stan wejściowy:

- repozytorium: `/Users/michael/Code/ctowiec/agent-adapters`, wersja **0.9.11** wg zgłoszenia
- zainstalowany `@openai/codex-sdk`: **0.120.0**, wspierany zakres **`>=0.120.0 <0.121.0`**
- backend: legacy **exec**

> **Rozbieżność do rozstrzygnięcia przed implementacją.** Zgłoszenie mówi o repozytorium
> w wersji **0.9.11**, a `from_release` tego briefu to **0.9.12**. Przed rozpoczęciem prac
> należy ustalić, która wersja jest faktyczną bazą — jeśli 0.9.12 zawiera już częściową
> korektę któregokolwiek z trzech punktów, ustalenia poniżej trzeba zweryfikować ponownie
> na tej bazie.

---

## P0 — `codex_baseUrl` jest cicho ignorowany, własny endpoint nie działa

**Co system robi dzisiaj.** Użytkownik ustawia własny endpoint przez publiczną opcję
`codex_baseUrl` z `src/options.ts`. Adapter przepisuje tę wartość do obiektu opcji SDK
pod nazwą **`baseURL`** (duże `URL`):

```ts
// src/adapters/codex.ts:233-234  [do potwierdzenia przy wejściu w kod]
codexOptions.baseURL = /* wartość z codex_baseUrl */;
```

Zainstalowany SDK nazywa to pole inaczej. `dist/index.d.ts` deklaruje **`baseUrl`**
(małe `rl`), a `dist/index.js` w okolicy linii 60 odczytuje:

```js
// node_modules/@openai/codex-sdk/dist/index.js ~:60  [do potwierdzenia przy wejściu w kod]
this._options.baseUrl
```

Skutek: przypisane `baseURL` nie jest przez SDK nigdy odczytywane. Żądania idą pod endpoint
domyślny, **bez żadnego ostrzeżenia ani błędu**. Konfiguracja użytkownika znika po cichu.

**Dlaczego to jest błąd kontraktu, a nie brak funkcji.** `src/options.ts` publicznie obiecuje
przez `codex_baseUrl` nadpisanie endpointu, a kontrakt providerów w module **M03** opisuje
wybór endpointu jako zachowanie systemu. Obietnica jest złożona na obu poziomach i nie jest
dotrzymana.

**Zasięg.** Dotyczy każdej konfiguracji z własnym endpointem, w tym providera **minimax**,
który bez działającego przepisania endpointu nie ma jak zadziałać w ogóle.

**Czego system ma dowodzić po poprawce.**

1. Mapowanie idzie na `baseUrl` — dokładnie tak, jak czyta je SDK.
2. Obiekt opcji przekazywany do SDK przestaje być luźnym `Record<string, unknown>`
   (lub równoważnym rzutowaniem) i jest typowany jako eksportowany z SDK **`CodexOptions`**.
   To jest istota poprawki, nie kosmetyka: przy typowanym obiekcie literówka w nazwie pola
   przestaje być zachowaniem runtime i staje się błędem kompilacji, więc ta sama klasa
   awarii nie wróci przy następnej zmianie.
3. Endpoint podany jawnie w konfiguracji trafia do SDK.
4. Endpoint wstrzyknięty przez providera (ścieżka minimax) trafia do SDK.
5. Zdarzenie `adapter_ready` raportuje endpoint **w postaci zredagowanej** (redacted) —
   bez wycieku poświadczeń czy pełnego URL-a z sekretem w query.

---

## P1 — ostrzeżenie o MCP musi dojść do konsumenta, raz, przed `adapter_ready`

**Co system robi dzisiaj.** Gdy konsument poda `mcpServers`, adapter wypisuje komunikat
wyłącznie przez `console.warn`:

```ts
// src/adapters/codex.ts:190-197  [do potwierdzenia przy wejściu w kod]
console.warn(/* komunikat o nieobsługiwanych mcpServers */);
```

`console.warn` nie jest kanałem kontraktowym — nie da się go zaobserwować programowo,
nie trafia do konsumenta biblioteki osadzonej w innym procesie, gubi się w zbiorczych
logach.

**Czego wymaga kontrakt.** Aktywne kryterium akceptacji
`ac-the-codex-adapter-degrades-mcp-subagent` oraz moduł **A02** (sekcja `dmy7oxr7`) wymagają,
by ostrzeżenie zostało wyemitowane **dokładnie raz** i **przed** zdarzeniem `adapter_ready`.
Kolejność jest częścią kontraktu: konsument, który reaguje na `adapter_ready` jako na
„adapter gotowy, konfiguracja ustalona", musi w tym momencie znać już wszystkie degradacje.

**Co się w tym briefie NIE zmienia.** Samo zachowanie wobec MCP zostaje **warn-and-ignore** —
adapter nadal ostrzega i ignoruje `mcpServers`. Wsparcie MCP jest poza zakresem (patrz niżej).
Zmienia się wyłącznie **kanał i moment dostarczenia** ostrzeżenia.

**Czego system ma dowodzić po poprawce.**

1. Ostrzeżenie idzie ujednoliconym kanałem ostrzeżeń adaptera, nie przez `console.warn`.
2. Emitowane jest dokładnie raz — również gdy adapter jest odpytywany/uruchamiany wielokrotnie.
3. Emitowane jest **przed** `adapter_ready` (test na kolejność zdarzeń, nie tylko na obecność).
4. Gdy `mcpServers` nie podano — **żadnego ostrzeżenia**.

> **Nieznane, do ustalenia w pierwszym kroku implementacji.** Autor briefu nie mógł odczytać
> repozytorium, więc **kształt „ujednoliconego kanału ostrzeżeń" nie jest tu przesądzony**:
> nie wiadomo, czy w `src/` istnieje już typ zdarzenia `warning`, helper w rodzaju
> `emitWarning`, czy pole na `adapter_ready`. Implementujący ma najpierw sprawdzić, jak
> ostrzeżenia emitują pozostałe adaptery, i **użyć istniejącego mechanizmu**; wprowadzanie
> nowego kanału tylko dla Codexa byłoby rozszerzeniem kontraktu, czyli wyjściem poza ten brief.

---

## P1 — `contextSize` wylicza zajętość kontekstu z sumy rozliczeniowej

**Co system robi dzisiaj.**

```ts
// src/adapters/codex.ts  [do potwierdzenia przy wejściu w kod]
result.contextSize = deltaUsage.inputTokens + deltaUsage.outputTokens;
```

**Dlaczego to jest niepoprawne.** To są dwie różne wielkości, rozdzielone wprost w specyfikacji:
moduł **M08** sekcja `6kzt7gmh` opisuje `contextSize` jako **zajętość okna kontekstu**,
a sekcja `jng2uu2p` — rozliczenie (billing). Sumowanie tokenów wejściowych i wyjściowych daje
to drugie.

Rozjazd jest strukturalny, nie arytmetyczny. **Jedna tura SDK może zawierać wiele żądań do
modelu i wiele rund narzędziowych.** Rozliczenie tury jest sumą po wszystkich tych żądaniach.
Zajętość kontekstu to natomiast stan **ostatniego** żądania. Przy dwóch i więcej żądaniach
w turze suma rozliczeniowa jest systematycznie **większa** od faktycznej zajętości — i nie
istnieje przekształcenie, które by z niej tę zajętość odzyskało, bo suma nie niesie
informacji o podziale na żądania.

**Co ma się zmienić.** Backend legacy **exec** nie dostarcza wiarygodnych danych o ostatnim
żądaniu. Zgodnie z M08 `6kzt7gmh`, który mówi wprost *undefined, gdy wartość niedostępna*,
adapter ma w tej sytuacji **pominąć `contextSize`** zamiast zmyślać zajętość. Brak liczby jest
uczciwym i kontraktowo przewidzianym wynikiem; liczba zawyżona jest cichym błędem, na którym
konsument buduje np. decyzje o kompaktowaniu kontekstu.

**Co ma zostać bez zmian.** Poprawka nie dotyka rachunkowości zużycia:
`result.usage` nadal przelicza wartości **kumulatywne na przyrostowe (delta)**, nadal utrzymuje
**podzbiór cached** i nadal korzysta z **`priorUsage`/LRU**. Zmienia się wyłącznie to, czy
i jak wyprowadzany jest `contextSize`.

**Testy i dokumentacja utrwalają dziś błędną inferencję** — trzeba je skorygować, a nie
dopasować kod do nich. Do zestawu testów dochodzi **fixture zużycia o kształcie
wielożądaniowym**: dane z tury złożonej z kilku żądań do modelu, na których widać, że
z łącznego rozliczenia nie da się wyprowadzić końcowej zajętości kontekstu. Ten fixture jest
dowodem granicy poznawczej i **nie wymaga płatnego API** — cała teza jest o strukturze danych.

> **Osobna, późniejsza czynność.** Weryfikacja semantyki zużycia kumulatywnego **na żywym API**
> jest odrębnym zadaniem, do wykonania **przed podbiciem wersji SDK**. Nie jest częścią tej
> poprawki i nie blokuje jej.

---

## Poza zakresem

Następujące tematy **świadomie nie są** przedmiotem tego briefu — każdy wymaga uprzedniej
decyzji specyfikacyjnej i jest obsługiwany w przygotowywanym, tylko-do-odczytu planie
specyfikacyjnym:

- podbicie wersji `@openai/codex-sdk` (zostajemy w `>=0.120.0 <0.121.0`)
- wsparcie MCP (tutaj wyłącznie kanał dostarczenia ostrzeżenia, nie zachowanie)
- zdarzenia `todo` / `web`
- `outputSchema`
- transport app-server
- katalog modeli

**Tryb planowania (`planMode`) — bez zmian.** Obecne zachowanie kodu i specyfikacji ma
pozostać **fail-closed** dla odmowy wykonania shella. Istnieje jedno nieaktualne kryterium
akceptacji, które wciąż mówi „read-only"; **nie jest ono podstawą do zmiany zachowania**
w ramach tego briefu. Żadnej automatycznej zmiany `planMode`.

---

## Kryteria akceptacji i dowody

| # | Kryterium | Dowód |
| --- | --- | --- |
| AC-1 | Wartość `codex_baseUrl` trafia do SDK pod polem `baseUrl` | Test: jawna konfiguracja endpointu → obiekt opcji przekazany do SDK ma `baseUrl` równe wartości z konfiguracji, i nie ma `baseURL` |
| AC-2 | Literówka w nazwie pola opcji SDK nie kompiluje się | Obiekt opcji typowany jako `CodexOptions` z `@openai/codex-sdk`; `npm run typecheck` przechodzi, a celowo wprowadzone `baseURL` go wywala |
| AC-3 | Endpoint wstrzyknięty przez providera działa | Test ścieżki providera **minimax**: skonfigurowany endpoint providera trafia do `baseUrl` |
| AC-4 | `adapter_ready` raportuje endpoint zredagowany | Test na payloadzie `adapter_ready`: endpoint obecny, poświadczenia/sekrety nieobecne |
| AC-5 | Ostrzeżenie o MCP emitowane jednym, obserwowalnym kanałem | Test przechwytuje zdarzenie ostrzeżenia bez podsłuchiwania `console` |
| AC-6 | Ostrzeżenie emitowane **dokładnie raz** i **przed** `adapter_ready` | Test na kolejności: zarejestrowana sekwencja zdarzeń ma ostrzeżenie na pozycji wcześniejszej niż `adapter_ready`, licznik = 1 |
| AC-7 | Brak `mcpServers` → brak ostrzeżenia | Test negatywny: zero zdarzeń ostrzeżenia |
| AC-8 | Zachowanie wobec MCP nadal warn-and-ignore | Test: `mcpServers` podane → nie są przekazywane do SDK, tura wykonuje się normalnie |
| AC-9 | Na backendzie legacy exec `contextSize` jest pominięty | Test: wynik tury nie ma `contextSize` (wartość `undefined`/brak klucza — zgodnie z M08 `6kzt7gmh`) |
| AC-10 | Suma rozliczeniowa nie pozwala wyprowadzić zajętości | Fixture zużycia o kształcie wielożądaniowym + test pokazujący rozbieżność sumy i zajętości ostatniego żądania |
| AC-11 | Rachunkowość `usage` nietknięta | Istniejące testy kumulatywne→delta, podzbioru cached i `priorUsage`/LRU przechodzą **bez modyfikacji** |
| AC-12 | Dokumentacja i testy nie utrwalają błędnej inferencji | Przegląd: żaden test ani fragment dokumentacji nie twierdzi, że `contextSize == input + output` |

## Walidacja

```bash
npm run typecheck
```

Następnie testy dotyczące: adaptera codex, konfiguracji providera/endpointu, zdarzenia
`adapter_ready` oraz `contextSize`/`usage`. Na koniec **punktowe sprawdzenie CLI/opcji bez
sieci** — że `codex_baseUrl` podane z linii poleceń dochodzi do obiektu opcji SDK, bez
wykonywania realnego żądania.

> Dokładne ścieżki plików testowych i nazwy skryptów npm **nie zostały ustalone** — autor
> briefu nie miał dostępu do repozytorium. Pierwszym krokiem implementacji jest ich
> zinwentaryzowanie (`package.json` → `scripts`, sweep po testach dotykających codex /
> provider / `adapter_ready` / `usage`) i dopisanie tutaj.

## Zależności

- **P0 → P1 (contextSize):** brak twardej zależności; trzy poprawki są rozłączne i mogą iść
  osobno. Jeśli jednak idą razem, kolejność **P0 → ostrzeżenie → contextSize** jest
  najwygodniejsza: typowanie `CodexOptions` z P0 porządkuje obiekt opcji, na którym opierają
  się testy `adapter_ready` z AC-4 i AC-6.
- **Poza briefem:** weryfikacja semantyki zużycia kumulatywnego na żywym API — **przed**
  jakimkolwiek podbiciem wersji SDK.
- **Poza briefem:** decyzje specyfikacyjne dla pozycji z sekcji „Poza zakresem", prowadzone
  w osobnym planie tylko-do-odczytu.

## Ryzyka

- **Zmiana obserwowalna dla konsumentów (contextSize).** Konsument, który dziś czyta
  `contextSize` i dostaje liczbę, po poprawce dostanie `undefined`. Liczba była błędna, ale
  zniknięcie pola jest zmianą zachowania — wymaga noty w changelogu, a być może wpisu
  w dokumentacji migracyjnej.
- **Zmiana obserwowalna dla konsumentów (endpoint).** Po naprawie P0 własny endpoint zacznie
  faktycznie działać. Konfiguracje, które dotąd „działały" wyłącznie dlatego, że po cichu
  szły na endpoint domyślny, zaczną trafiać tam, gdzie deklarowały. To jest intencja
  poprawki, ale w praktyce może ujawnić się jako nagły błąd u kogoś, kto ma w konfiguracji
  martwy URL.
- **Typowanie `CodexOptions` może odsłonić kolejne rozjazdy.** Zamiana luźnego `Record` na
  typ z SDK prawdopodobnie wywali kompilację na **innych** polach niż `baseURL`. To dobra
  wiadomość, ale rozszerza pracę — każdy taki przypadek trzeba ocenić osobno i nie wciągać
  do tego briefu tego, co wymaga decyzji specyfikacyjnej.
- **Nieaktualne AC o `planMode` „read-only".** Dopóki żyje, ktoś może je wziąć za podstawę
  do zmiany zachowania na mniej restrykcyjne. Fail-closed obowiązuje; samo AC należy poprawić
  osobno, ścieżką specyfikacyjną.
- **Baza wersji.** Rozjazd 0.9.11 vs `from_release: 0.9.12` — jeśli nie zostanie rozstrzygnięty
  przed startem, ustalenia mogą dotyczyć nieaktualnego stanu kodu.

## For implementers

Kolejność mniej więcej po zależnościach (typy przed konsumentami):

1. **`package.json`** — odczytaj `version` i zakres `@openai/codex-sdk`; potwierdź, że
   zainstalowana wersja to `0.120.0` i że zakres to `>=0.120.0 <0.121.0`. Rozstrzygnij
   rozbieżność 0.9.11 / 0.9.12.
2. **`node_modules/@openai/codex-sdk/dist/index.d.ts`** — znajdź eksportowany typ opcji
   (spodziewany `CodexOptions`) i potwierdź pisownię pola: **`baseUrl`**. Zweryfikuj też
   `dist/index.js` ~linia 60 (`this._options.baseUrl`).
3. **`src/adapters/codex.ts:233-234`** — zmień przypisanie `codexOptions.baseURL` na
   `codexOptions.baseUrl`. W tym samym kroku zamień luźne rzutowanie obiektu opcji
   (`Record<...>`) na import typu `CodexOptions` z `@openai/codex-sdk`. Uruchom
   `npm run typecheck` i rozpatrz każdy nowy błąd osobno.
4. **`src/options.ts`** — sprawdź deklarację i komentarz dokumentacyjny `codex_baseUrl`;
   upewnij się, że opis odpowiada temu, co po poprawce faktycznie się dzieje.
5. **Ścieżka providera (minimax)** — prześledź, gdzie provider wstrzykuje endpoint, i dołóż
   test, że i ta ścieżka ląduje w `baseUrl`.
6. **Emisja `adapter_ready`** — potwierdź redakcję endpointu w payloadzie (AC-4).
7. **`src/adapters/codex.ts:190-197`** — zanim cokolwiek zmienisz, **znajdź istniejący
   mechanizm ostrzeżeń w pozostałych adapterach** (`src/`, szukaj typu zdarzenia `warning`,
   helpera pokroju `emitWarning`, ewentualnie pola na `adapter_ready`). Przenieś komunikat
   z `console.warn` na ten mechanizm, zachowując warn-and-ignore. Upewnij się, że emisja
   zachodzi **przed** `adapter_ready` i dokładnie raz.
8. **Obliczenie `contextSize` w `src/adapters/codex.ts`** — usuń
   `result.contextSize = deltaUsage.inputTokens + deltaUsage.outputTokens`. Na backendzie
   legacy exec, przy braku wiarygodnych danych o ostatnim żądaniu, **nie ustawiaj
   `contextSize`**. Nie ruszaj przeliczenia kumulatywne→delta, podzbioru cached ani
   `priorUsage`/LRU.
9. **Fixture** — dodaj dane zużycia o kształcie wielożądaniowym (tura = kilka żądań do modelu
   + rundy narzędziowe) i test pokazujący, że łączne rozliczenie ≠ zajętość kontekstu
   ostatniego żądania. Bez sieci, bez płatnego API.
10. **Testy i dokumentacja** — skoryguj wszystko, co dziś utrwala `contextSize == input + output`.
11. **Walidacja końcowa** — `npm run typecheck`, testy codex / provider / `adapter_ready` /
    `usage`, punktowe sprawdzenie CLI/opcji bez sieci.

**Nie rób w tym zadaniu:** podbicia SDK, wsparcia MCP, zdarzeń `todo`/`web`, `outputSchema`,
transportu app-server, katalogu modeli, ani żadnej zmiany `planMode`.
