# Nazuna

Przeglądarka internetowa dla Windows i macOS Apple Silicon, zbudowana na silniku Chromium (Electron od castLabs, z obsługą Widevine). Stawia na prywatność, spokojny wygląd i brak zbędnych dodatków: bez kont, bez synchronizacji, bez wbudowanego AI.

**Strona z prezentacją i pobieraniem:** https://patryktafel.github.io/nazuna-updates/
**Wydania (instalatory):** https://github.com/patryktafel/nazuna-updates/releases

## Co potrafi

- **Trzy wyglądy:** Lawendowa mgła, Washi (japoński ogród sakury, za dnia i nocą) oraz Klasyczny. Nowa karta z zegarem, powitaniem i licznikiem zablokowanych elementów śledzących.
- **Prywatność od pierwszego uruchomienia:** wbudowany bloker reklam i śledzenia (listy Ghostery, tryb Bezpieczny i Agresywny), osobne ciasteczka dla każdej strony (jak Total Cookie Protection w Firefoksie), DNT i GPC, ochrona WebRTC, DNS przez HTTPS, zaburzanie odcisku przeglądarki (canvas, WebGL, audio), ostrzeżenia przed stronami z wirusami i wyłudzaniem haseł.
- **Okno prywatne,** które niczego nie zapisuje na dysku.
- **Serwisy z DRM na Windows:** Netflix, HBO Max, Prime Video (podpis VMP castLabs). Ograniczenia macOS opisano poniżej.
- **Rozszerzenia ze sklepu Chrome,** klucze dostępu (passkeys), podgląd PDF i JSON, przenoszenie zakładek z Chrome, Edge, Brave, Vivaldi, Opery i Firefoksa.
- **Automatyczne aktualizacje na Windows** podpisanym instalatorem.

## Gdzie są dane

`%LOCALAPPDATA%\Nazuna`: zakładki, historia, ustawienia, ciasteczka i rozszerzenia. Folder można otworzyć z poziomu przeglądarki (Ustawienia > Zaawansowane).

Tryb przenośny: pusty plik `portable.txt` obok `Nazuna.exe` przenosi profil do folderu `Nazuna-Data` obok programu.

## Budowanie ze źródeł

Wymagany Node.js (LTS).

```
npm ci
npm run pobierz-silnik   # silnik castLabs z Widevine (sprawdzany sumą SHA-256)
npm start                # uruchomienie z kodu
npx electron-builder --config electron-builder.config.js --win nsis --publish never
```

Instalator trafia do folderu `dist`. Skrót: `zbuduj.bat`.

Wydania budują się automatycznie w GitHub Actions (`.github/workflows/release.yml`) po wypchnięciu znacznika wersji `vX.Y.Z`: podpis Authenticode, podpis VMP castLabs i publikacja w repozytorium `nazuna-updates`. Historia zmian: [CHANGELOG.txt](CHANGELOG.txt).

## Struktura

- `src/main` - proces główny (okna, karty, sesje, bloker, aktualizacje, pobieranie, import zakładek)
- `src/preload` - mostki do pasków i stron
- `src/ui` - pasek przeglądarki, strony `nazuna://` i wyglądy
- `tools` - skrypty budowania (silnik, lista blokera, ikona, podpisy)
- `build` - zasoby instalatora

Interfejs jest po polsku.

## macOS Apple Silicon

Wymagany macOS 12 lub nowszy, Node.js 22/24 LTS i narzędzia Xcode Command Line Tools.
Używaj wersji zależności z lockfile:

```sh
npm ci
npm test
npm run test:integration
npm run dist:mac
open dist/mac-arm64/Nazuna.app
```

Wynik: `dist/mac-arm64/Nazuna.app`, natywny ARM64 (bez Rosetty), oraz paczki `.dmg` i `.zip` w `dist`.
Build lokalny ma podpis **ad-hoc** i hardened runtime; nie jest notaryzowany.
Nie wyłączaj Gatekeepera ani nie usuwaj kwarantanny. Dystrybucja poza lokalnym
komputerem wymaga Developer ID i notaryzacji. `CSC_NAME` wybiera certyfikat;
entitlements dla tego wariantu są w `build/entitlements.mac.plist`.

Profil macOS: `~/Library/Application Support/Nazuna`. Do osobnego profilu
deweloperskiego można użyć `NAZUNA_PROFILE=/absolutna/sciezka npm start`.
Testy automatyczne tworzą własne katalogi tymczasowe i nie używają Twojego profilu.
`npm run benchmark` zapisuje pomiary w `reports`; `NAZUNA_BENCH_LABEL` nadaje im nazwę.

Menu macOS obsługuje ⌘T, ⌘W, ⌘N, ⌘⇧N, ⌘L, ⌘Y (historia), ⌘, (ustawienia),
⌃Tab i ⌃⇧Tab (karty), ⌘[ / ⌘] (nawigacja), ⌃⌘F (pełny ekran), ⌘Q.
⌘H zachowuje systemową funkcję ukrywania aplikacji.

Na baterii i przy wysokiej temperaturze Nazuna rezygnuje z zapasowego procesu
nowej karty, zatrzymuje dekoracyjne animacje własnych stron i skraca próg
usypiania nieużywanych kart z 20 do 10 minut. Systemowa presja pamięci może
skrócić go do 3 minut. Formularze, edytory, multimedia, WebRTC, pobieranie,
Web Locks i ręczne wyjątki są chronione; nieudana kontrola aktywności blokuje
automatyczne uśpienie. Ochrona po rozpoczęciu rozmowy/wysyłania trwa do nawigacji.

Aktualizator instalatora jest nadal funkcją Windows; macOS aktualizuje się
przez ponowne zbudowanie/zastąpienie aplikacji. Rozszerzenia zachowują mechanizm
aktualizacji ze sklepu Chrome. Widevine pozostaje w silniku castLabs, lecz ten
build macOS **nie ma podpisu VMP**: darmowe EVS wymaga fuse nadającego dodatkowe
uprawnienia `file://`, którego tutaj nie włączamy. Nie gwarantujemy serwisów
wymagających VMP. Certyfikat Developer ID sam nie rozwiązuje tego konfliktu.

Test gotowej aplikacji w oficjalnym [Widevine VMP Lab](https://castlabs.github.io/wv-vmp-lab/)
potwierdził `PLATFORM_TAMPERED` (CDM 4.10.3112.0, backend UAT): moduł Widevine
jest dostępny, ale podpis VMP po zmianie konfiguracji binarnej jest nieprawidłowy.
Netflix pozwala zalogować się i wybrać profil, lecz próba filmu kończy się E100.
Poprawka scriptletów blokera usuwa wcześniejszy NSES-UHX, nie naprawia podpisu DRM.
Przy zachowaniu obecnych fuses potrzebne jest podpisywanie niestandardowego
builda w ramach certyfikacji castLabs 3PL; darmowe EVS nie akceptuje tego zestawu.

Szczegóły wykonanych testów i pomiarów: `reports/macOS-report.txt`.
