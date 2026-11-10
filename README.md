# Nazuna

Przeglądarka internetowa dla Windows, zbudowana na silniku Chromium (Electron od castLabs, z obsługą Widevine). Stawia na prywatność, spokojny wygląd i brak zbędnych dodatków: bez kont, bez synchronizacji, bez wbudowanego AI.

**Strona z prezentacją i pobieraniem:** https://patryktafel.github.io/nazuna-updates/
**Wydania (instalatory):** https://github.com/patryktafel/nazuna-updates/releases

## Co potrafi

- **Trzy wyglądy:** Lawendowa mgła, Washi (japoński ogród sakury, za dnia i nocą) oraz Klasyczny. Nowa karta z zegarem, powitaniem i licznikiem zablokowanych elementów śledzących.
- **Prywatność od pierwszego uruchomienia:** wbudowany bloker reklam i śledzenia (listy Ghostery, tryb Bezpieczny i Agresywny), osobne ciasteczka dla każdej strony (jak Total Cookie Protection w Firefoksie), DNT i GPC, ochrona WebRTC, DNS przez HTTPS, zaburzanie odcisku przeglądarki (canvas, WebGL, audio), ostrzeżenia przed stronami z wirusami i wyłudzaniem haseł.
- **Okno prywatne,** które niczego nie zapisuje na dysku.
- **Serwisy z DRM:** Netflix, HBO Max, Prime Video (podpis VMP castLabs).
- **Rozszerzenia ze sklepu Chrome,** klucze dostępu (passkeys), podgląd PDF i JSON, przenoszenie zakładek z Chrome, Edge, Brave, Vivaldi, Opery i Firefoksa.
- **Automatyczne aktualizacje** podpisanym instalatorem.

## Gdzie są dane

`%LOCALAPPDATA%\Nazuna`: zakładki, historia, ustawienia, ciasteczka i rozszerzenia. Folder można otworzyć z poziomu przeglądarki (Ustawienia > Zaawansowane).

Tryb przenośny: pusty plik `portable.txt` obok `Nazuna.exe` przenosi profil do folderu `Nazuna-Data` obok programu.

## Budowanie ze źródeł

Wymagany Node.js (LTS).

```
npm install
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
