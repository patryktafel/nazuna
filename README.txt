Nazuna
======

Przeglądarka internetowa na silniku Chromium.


Jak uruchomić
-------------

Na Windows uruchom instalator (Nazuna-WERSJA-Instalator.exe). Zapyta o folder
docelowy i o to, czy zrobić skróty na pulpicie i w menu Start, a potem doda
Nazunę do listy programów w Panelu sterowania, skąd normalnie się ją
odinstalowuje. Przy pierwszym uruchomieniu instalatora Windows może pokazać
okno "Windows chronił ten komputer" (SmartScreen), bo plik nie ma podpisu
wydawcy. Kliknij "Więcej informacji", potem "Uruchom mimo to".

Jest też wersja przenośna (jeden plik .exe, bez instalacji), ale nie powstaje
domyślnie - trzeba ją zbudować osobno, komendą "npm run dist:portable" (patrz
INSTRUKCJA.txt). Przydaje się tam, gdzie w ogóle nie da się niczego
zainstalować (pendrive, komputer bez uprawnień administratora, polityka
firmowa blokująca instalatory). Wersja przenośna nie aktualizuje się sama -
patrz sekcja "Bezpieczeństwo" niżej.


Gdzie trzymane są dane
----------------------

Domyślnie w:
    %LOCALAPPDATA%\Nazuna

Są tam zakładki, historia, ciasteczka, zalogowane sesje i rozszerzenia.
Folder można otworzyć z poziomu przeglądarki: Ustawienia -> Zaawansowane ->
Otwórz folder.

Tryb w pełni przenośny (na pendrive): połóż obok Nazuna.exe pusty plik o nazwie
    portable.txt
Przeglądarka utworzy wtedy folder Nazuna-Data obok pliku wykonywalnego i będzie
trzymać wszystko tam. Zalogowane konta pojadą razem z pendrivem.


Rozszerzenia ze sklepu Chrome
-----------------------------

Otwórz Ustawienia -> Rozszerzenia (albo wpisz nazuna://extensions w pasku
adresu). Wklej link ze sklepu, na przykład:

    https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh

albo sam identyfikator (32 litery). Kliknij "Zainstaluj".

Ważne: Nazuna używa silnika Chromium, ale nie ma warstwy Google, na której
opierają się niektóre rozszerzenia. Większość działa, część działa połowicznie,
część nie ruszy wcale. Na stronie rozszerzeń jest lista polecanych z oznaczeniem
spodziewanej zgodności. Jeśli coś nie działa, po prostu je usuń.


Bloker reklam
-------------

Bloker ma dwa poziomy, do wyboru w Ustawieniach, w sekcji Prywatność i treści.

Bezpieczne (domyślne) blokuje reklamy i skrypty śledzące na poziomie sieci
i ukrywa puste miejsca, które po nich zostają. Nie dotyka kodu stron, więc
YouTube i inne serwisy wideo działają normalnie. Reklamy wyświetlane wewnątrz
odtwarzacza YouTube przy tym ustawieniu się pojawią.

Agresywne dokłada skrypty, które wycinają reklamy z wnętrza odtwarzaczy.
Blokuje reklamy na YouTube, ale potrafi zablokować odtwarzanie filmów.
Jeśli po włączeniu tego trybu film pokazuje czarny ekran, wróć do trybu
bezpiecznego albo wyłącz bloker dla danej strony ikoną tarczy w pasku adresu.

Listy filtrów aktualizują się same w tle i nie wymagają aktualizowania
przeglądarki. Datę ostatniej aktualizacji i przycisk wymuszenia znajdziesz
w Ustawieniach.


Bezpieczeństwo
--------------

Każda strona działa w takich samych zabezpieczeniach co w Chrome: osobny proces
w piaskownicy, brak dostępu do systemu plików i do wnętrza przeglądarki, pełna
polityka tego samego pochodzenia. Strony wewnętrzne przeglądarki nie dają się
osadzić w ramce, pobierane rozszerzenia mają sprawdzany podpis, a pliki
wykonywalne nigdy nie zapisują się bez okna zapisu.

Są dwie rzeczy, których Nazuna nie potrafi, a Chrome tak, i warto o nich
wiedzieć.

Po pierwsze, zainstalowana wersja (instalator) sama sprawdza w tle, czy jest
nowsza wersja, i pozwala ją pobrać i zainstalować z karty O programie
(nazuna://about) - ale to samo sprawdzanie dostępności nowej wersji, nie
automatyczna łatka bezpieczeństwa silnika. Chrome łata luki w silniku co
kilka tygodni; żeby Nazuna dostała te same łatki, ktoś musi ją przebudować na
nowszym Electronie i wydać nową wersję. Wersja przenośna nie sprawdza
aktualizacji w ogóle - trzeba pobierać nowe wydania ręcznie.

Po drugie, nie ma ostrzeżeń przed stronami wyłudzającymi dane ani przed
zainfekowanymi plikami. Wbudowany bloker zatrzymuje reklamy i skrypty śledzące,
ale nie rozpozna podrobionej strony banku.


Serwisy z DRM i logowanie do Google
-----------------------------------

Ta wersja zawiera obsługę modułu Widevine, który odszyfrowuje chronione wideo.
Sam moduł dociąga się z serwerów Google przy pierwszym uruchomieniu, więc
potrzebny jest internet. Jego stan sprawdzisz wpisując nazuna://about.

Nie jest jednak podpisany u castLabs, a bez tego podpisu Netflix
najprawdopodobniej nadal odmówi odtwarzania. Spotify Web i część mniej
wymagających serwisów mogą zadziałać. Nawet po podpisaniu Netflix zwykle
ogranicza jakość do 720p w przeglądarkach innych niż Chrome i Edge.

Logowanie do konta Google może nie działać. Google blokuje logowanie
programom, które wyświetlają stronę logowania we własnym oknie, żeby żaden
z nich nie mógł podejrzeć wpisywanego hasła. Nazuna technicznie należy do tej
grupy, tak samo jak każda samodzielnie zbudowana przeglądarka. YouTube działa
bez logowania.


Skróty klawiszowe
-----------------

Ctrl+T              nowa karta
Ctrl+W              zamknij kartę
Ctrl+Shift+T        przywróć zamkniętą kartę
Ctrl+N              nowe okno
Ctrl+Shift+N        okno prywatne
Ctrl+L              przejdź do paska adresu
Ctrl+F  /  F3       znajdź na stronie
Ctrl+D              dodaj do zakładek
Ctrl+H              historia
Ctrl+J              pobrane
Ctrl+P              drukuj
Ctrl+Shift+O        menedżer zakładek
Ctrl+Tab            następna karta
Ctrl+Shift+Tab      poprzednia karta
Ctrl+1 do Ctrl+8    przejdź do karty o tym numerze
Ctrl+9              ostatnia karta
Ctrl+plus / minus   powiększenie
Ctrl+0              powiększenie 100%
Ctrl+Shift+M        wycisz kartę
Alt+strzałki        wstecz i dalej
F5                  odśwież
Ctrl+Shift+R / F5   odśwież z pominięciem pamięci podręcznej
F11                 pełny ekran
F12                 narzędzia dewelopera
Esc                 zamknij menu, pasek wyszukiwania albo zatrzymaj ładowanie


Adresy wewnętrzne
-----------------

nazuna://newtab       nowa karta
nazuna://settings     ustawienia
nazuna://history      historia
nazuna://bookmarks    zakładki
nazuna://downloads    pobrane
nazuna://extensions   rozszerzenia
nazuna://about        informacje o wersji
