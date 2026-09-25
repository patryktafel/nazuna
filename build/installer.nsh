; Nazuna - dodatkowa strona instalatora z wyborem skrótów, plus automatyczne
; zaufanie wlasnemu certyfikatowi podpisujacemu.
;
; electron-builder zawsze tworzy skrót na pulpicie i w menu Start (macra
; addStartMenuLink/addDesktopLink w jego szablonie). Nie ma gotowej opcji,
; żeby zapytać o to w trakcie instalacji - trzeba dopisać własną stronę
; (nsDialogs) i po instalacji skasować skrót, którego użytkownik nie chciał.
;
; Trzy haki, z których korzystamy, są udokumentowane przez electron-builder:
;   customHeader             - na samym początku skryptu (zmienne, deklaracje)
;   customPageAfterChangeDir - własna strona zaraz po wyborze folderu instalacji
;   customInstall             - kod odpalany tuż po skopiowaniu plików i skrótów
;   customUnInstall           - kod odpalany przy deinstalacji

; Caly ten plik jest dolaczany bardzo wczesnie (przed wlasnymi !include
; instalatora electron-buildera), wiec zanim ponizsze funkcje skorzystaja z
; MUI_HEADER_TEXT i nsDialogs, sami musimy sciagnac MUI2 - i to poza jakimkolwiek
; makrem, bo tresc makra przetwarza sie dopiero przy jego wywolaniu, a ponizsze
; funkcje sa poza makrami i przetwarzaja sie od razu, w miejscu tego !include.
; MUI2.nsh ma zabezpieczenie przed podwojnym dolaczeniem, wiec pozniejszy
; wlasny !include "MUI2.nsh" instalatora nic tu nie zepsuje.
!include "MUI2.nsh"

; Z tego samego powodu (patrz wyzej) zmienne tez deklarujemy od razu, poza
; makrem customHeader - funkcje ponizej odwoluja sie do nich zanim
; !insertmacro customHeader w ogole sie wykona. Tylko w przebiegu instalatora -
; w przebiegu deinstalatora (BUILD_UNINSTALLER) nikt by ich nie uzyl.
!ifndef BUILD_UNINSTALLER
Var Nazuna_SkrotyDialog
Var Nazuna_ChkPulpit
Var Nazuna_ChkStartMenu
Var Nazuna_ChcPulpit
Var Nazuna_ChcStartMenu
!endif

!macro customPageAfterChangeDir
  Page custom Nazuna_SkrotyPageShow Nazuna_SkrotyPageLeave
!macroend

!macro customInstall
  ; Wlasny certyfikat, ktorym podpisujemy Nazune (patrz resources/nazuna-cert.cer),
  ; nie pochodzi z prawdziwego urzedu certyfikacji, wiec Windows nie zna go z
  ; gory. Doklejamy go tutaj do zaufanych certyfikatow tego komputera (magazyn
  ; "Root"), zeby kazda kolejna, cicho aktualizowana wersja Nazuny byla juz
  ; rozpoznawana jako podpisana przez znanego, tego samego wydawce - bez tego
  ; kazda wersja od zera wygladalaby dla SmartScreena jak nowy, nieznany plik.
  ; Dzieje sie to cicho, w ramach tych samych uprawnien administratora, ktore
  ; instalator i tak juz ma w tym miejscu do zapisu w Program Files - uzytkownik
  ; nie widzi zadnego dodatkowego okienka. Gdyby certutil sie nie powiodl (np.
  ; plik .cer nie dojechal), instalacja i tak ma sie dokonczyc normalnie -
  ; to tylko udogodnienie, nie ma prawa wywrocic calej instalacji.
  ${if} ${FileExists} "$INSTDIR\resources\nazuna-cert.cer"
    nsExec::ExecToLog 'certutil -addstore -f "Root" "$INSTDIR\resources\nazuna-cert.cer"'
    Pop $0
  ${endif}

  ${if} $Nazuna_ChcPulpit == 0
    ${if} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endif}
  ${endif}
  ${if} $Nazuna_ChcStartMenu == 0
    ${if} ${FileExists} "$newStartMenuLink"
      Delete "$newStartMenuLink"
    ${endif}
  ${endif}

  ; Rejestracja Nazuny jako KANDYDATA na domyslna przegladarke. Windows od 8.
  ; celowo nie pozwala programom cicho, samemu przejmowac tego wyboru (ochrona
  ; przed nachalnymi/zlosliwymi instalatorami) - jedyne co instalator moze
  ; zrobic, to dopisac sie do listy w Ustawieniach (Ustawienia > Aplikacje >
  ; Aplikacje domyslne), dokladnie tymi samymi kluczami, ktorych uzywaja
  ; prawdziwe przegladarki. Sam wybor i tak zapada tylko tam, recznie.
  ; HKCU (nie HKLM), zeby dzialalo bez wzgledu na to, czy ta konkretna
  ; instalacja akurat miala uprawnienia administratora.
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna" "" "Nazuna"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\DefaultIcon" "" "$INSTDIR\Nazuna.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\shell\open\command" "" '"$INSTDIR\Nazuna.exe"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities" "ApplicationName" "Nazuna"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities" "ApplicationIcon" "$INSTDIR\Nazuna.exe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities" "ApplicationDescription" "Przegladarka internetowa na silniku Chromium, stawiajaca na prywatnosc i szybkosc."
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities\URLAssociations" "http" "NazunaHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities\URLAssociations" "https" "NazunaHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities\FileAssociations" ".htm" "NazunaHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Nazuna\Capabilities\FileAssociations" ".html" "NazunaHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Nazuna" "Software\Clients\StartMenuInternet\Nazuna\Capabilities"

  WriteRegStr HKCU "Software\Classes\NazunaHTML" "" "Strona HTML (Nazuna)"
  WriteRegStr HKCU "Software\Classes\NazunaHTML\DefaultIcon" "" "$INSTDIR\Nazuna.exe,0"
  WriteRegStr HKCU "Software\Classes\NazunaHTML\shell\open\command" "" '"$INSTDIR\Nazuna.exe" "%1"'
!macroend

!macro customUnInstall
  ; Sprzatanie po sobie - usuwamy z zaufanych certyfikat dodany przy instalacji.
  ; Dopasowanie po nazwie (CN=Nazuna) zamiast po odcisku, zeby nie trzeba bylo
  ; tu nic aktualizowac, gdyby certyfikat kiedys zostal odnowiony.
  nsExec::ExecToLog 'certutil -delstore "Root" "Nazuna"'
  Pop $0

  ; Sprzatanie rejestracji "kandydata na domyslna przegladarke" - patrz
  ; customInstall powyzej.
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Nazuna"
  DeleteRegKey HKCU "Software\Classes\NazunaHTML"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Nazuna"
!macroend

; electron-builder kompiluje ten skrypt dwa razy - raz zeby zbudowac sam
; deinstalator (BUILD_UNINSTALLER), raz dla wlasciwego instalatora. Nasza
; strona nalezy tylko do instalatora (customPageAfterChangeDir i tak dziala
; tylko w tamtym przebiegu), a bez tego !ifndef NSIS ostrzega w przebiegu
; deinstalatora, ze funkcje nie sa niczym uzyte - i przy warningsAsErrors to
; przerywa cala kompilacje.
!ifndef BUILD_UNINSTALLER

Function Nazuna_SkrotyPageShow
  !insertmacro MUI_HEADER_TEXT "Skróty" "Wybierz, gdzie Nazuna ma zostawić skróty do uruchamiania"

  nsDialogs::Create 1018
  Pop $Nazuna_SkrotyDialog
  ${if} $Nazuna_SkrotyDialog == error
    Abort
  ${endif}

  ${NSD_CreateCheckbox} 0 30u 100% 12u "Utwórz skrót na pulpicie"
  Pop $Nazuna_ChkPulpit
  ${NSD_SetState} $Nazuna_ChkPulpit ${BST_CHECKED}

  ${NSD_CreateCheckbox} 0 52u 100% 12u "Utwórz skrót w menu Start"
  Pop $Nazuna_ChkStartMenu
  ${NSD_SetState} $Nazuna_ChkStartMenu ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function Nazuna_SkrotyPageLeave
  ${NSD_GetState} $Nazuna_ChkPulpit $Nazuna_ChcPulpit
  ${NSD_GetState} $Nazuna_ChkStartMenu $Nazuna_ChcStartMenu
FunctionEnd

!endif
