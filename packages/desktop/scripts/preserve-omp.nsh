!ifndef BUILD_UNINSTALLER

!macro ompPreserveMessages LANG BACKUP RESTORE
  LangString ompBackupFailed ${LANG} "${BACKUP}"
  LangString ompRestoreFailed ${LANG} "${RESTORE}$\r$\n$ompBackupDir\omp.exe"
!macroend

!macro customHeader
  Var ompBackupDir

  !insertmacro ompPreserveMessages 1033 "Could not back up the existing OMP runtime. The previous installation has not been removed." "Could not restore the OMP runtime. Your original executable is preserved at:"
  !insertmacro ompPreserveMessages 1031 "Die vorhandene OMP-Laufzeit konnte nicht gesichert werden. Die bisherige Installation wurde nicht entfernt." "Die OMP-Laufzeit konnte nicht wiederhergestellt werden. Die ursprüngliche Programmdatei befindet sich hier:"
  !insertmacro ompPreserveMessages 1036 "Impossible de sauvegarder le moteur OMP existant. L'installation précédente n'a pas été supprimée." "Impossible de restaurer le moteur OMP. L'exécutable d'origine est conservé ici :"
  !insertmacro ompPreserveMessages 3082 "No se pudo respaldar el entorno OMP existente. No se ha eliminado la instalación anterior." "No se pudo restaurar el entorno OMP. El ejecutable original se conserva en:"
  !insertmacro ompPreserveMessages 2052 "无法备份现有 OMP 运行时，原有安装尚未删除。" "无法恢复 OMP 运行时。原始可执行文件保留在："
  !insertmacro ompPreserveMessages 1028 "無法備份現有 OMP 執行環境，原有安裝尚未刪除。" "無法還原 OMP 執行環境。原始執行檔保留在："
  !insertmacro ompPreserveMessages 1041 "既存の OMP ランタイムをバックアップできませんでした。以前のインストールは削除されていません。" "OMP ランタイムを復元できませんでした。元の実行ファイルは次の場所に保存されています:"
  !insertmacro ompPreserveMessages 1042 "기존 OMP 런타임을 백업할 수 없습니다. 이전 설치는 삭제되지 않았습니다." "OMP 런타임을 복원할 수 없습니다. 원본 실행 파일은 다음 위치에 보존됩니다:"
  !insertmacro ompPreserveMessages 1040 "Impossibile salvare il runtime OMP esistente. L'installazione precedente non è stata rimossa." "Impossibile ripristinare il runtime OMP. L'eseguibile originale è conservato in:"
  !insertmacro ompPreserveMessages 1043 "De bestaande OMP-runtime kon niet worden geback-upt. De vorige installatie is niet verwijderd." "De OMP-runtime kon niet worden hersteld. Het oorspronkelijke uitvoerbare bestand staat hier:"
  !insertmacro ompPreserveMessages 1030 "Den eksisterende OMP-runtime kunne ikke sikkerhedskopieres. Den tidligere installation er ikke fjernet." "OMP-runtime kunne ikke gendannes. Den oprindelige programfil er bevaret her:"
  !insertmacro ompPreserveMessages 1053 "Den befintliga OMP-miljön kunde inte säkerhetskopieras. Den tidigare installationen har inte tagits bort." "OMP-miljön kunde inte återställas. Den ursprungliga programfilen finns kvar här:"
  !insertmacro ompPreserveMessages 1044 "Kunne ikke sikkerhetskopiere eksisterende OMP-kjøremiljø. Den forrige installasjonen er ikke fjernet." "Kunne ikke gjenopprette OMP-kjøremiljøet. Den opprinnelige programfilen er bevart her:"
  !insertmacro ompPreserveMessages 1035 "Nykyistä OMP-ajoympäristöä ei voitu varmuuskopioida. Aikaisempaa asennusta ei ole poistettu." "OMP-ajoympäristöä ei voitu palauttaa. Alkuperäinen ohjelmatiedosto on tallessa täällä:"
  !insertmacro ompPreserveMessages 1049 "Не удалось создать резервную копию среды OMP. Предыдущая установка не удалена." "Не удалось восстановить среду OMP. Исходный исполняемый файл сохранён по адресу:"
  !insertmacro ompPreserveMessages 2070 "Não foi possível guardar o ambiente OMP existente. A instalação anterior não foi removida." "Não foi possível restaurar o ambiente OMP. O executável original está guardado em:"
  !insertmacro ompPreserveMessages 1046 "Não foi possível fazer backup do ambiente OMP existente. A instalação anterior não foi removida." "Não foi possível restaurar o ambiente OMP. O executável original está preservado em:"
  !insertmacro ompPreserveMessages 1045 "Nie można utworzyć kopii istniejącego środowiska OMP. Poprzednia instalacja nie została usunięta." "Nie można przywrócić środowiska OMP. Oryginalny plik wykonywalny zachowano w:"
  !insertmacro ompPreserveMessages 1058 "Не вдалося створити резервну копію середовища OMP. Попередню інсталяцію не видалено." "Не вдалося відновити середовище OMP. Початковий виконуваний файл збережено за адресою:"
  !insertmacro ompPreserveMessages 1029 "Stávající běhové prostředí OMP nelze zálohovat. Předchozí instalace nebyla odstraněna." "Běhové prostředí OMP nelze obnovit. Původní spustitelný soubor je zachován zde:"
  !insertmacro ompPreserveMessages 1051 "Existujúce prostredie OMP sa nepodarilo zálohovať. Predchádzajúca inštalácia nebola odstránená." "Prostredie OMP sa nepodarilo obnoviť. Pôvodný spustiteľný súbor je uložený tu:"
  !insertmacro ompPreserveMessages 1038 "A meglévő OMP-futtatókörnyezet nem menthető. A korábbi telepítés nem lett eltávolítva." "Az OMP-futtatókörnyezet nem állítható vissza. Az eredeti futtatható fájl itt maradt meg:"
  !insertmacro ompPreserveMessages 1025 "تعذر نسخ بيئة تشغيل OMP الحالية احتياطيًا. لم تتم إزالة التثبيت السابق." "تعذر استعادة بيئة تشغيل OMP. تم الاحتفاظ بالملف التنفيذي الأصلي في:"
  !insertmacro ompPreserveMessages 1055 "Mevcut OMP çalışma ortamı yedeklenemedi. Önceki kurulum kaldırılmadı." "OMP çalışma ortamı geri yüklenemedi. Özgün yürütülebilir dosya burada korunuyor:"
  !insertmacro ompPreserveMessages 1054 "ไม่สามารถสำรองรันไทม์ OMP ที่มีอยู่ได้ ยังไม่ได้ลบการติดตั้งเดิม" "ไม่สามารถคืนค่ารันไทม์ OMP ได้ ไฟล์ปฏิบัติการเดิมยังคงอยู่ที่:"
  !insertmacro ompPreserveMessages 1066 "Không thể sao lưu môi trường OMP hiện có. Bản cài đặt trước chưa bị xóa." "Không thể khôi phục môi trường OMP. Tệp thực thi gốc được giữ tại:"

  Function ompBackupRuntime
    Push $0
    StrCpy $ompBackupDir ""
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ; A per-machine upgrade also uninstalls the current user's old installation.
    ${If} $installMode == "all"
    ${AndIfNot} ${FileExists} "$0\resources\bin\omp.exe"
      ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\resources\bin\omp.exe"
      ; Do not use PLUGINSDIR: NSIS deletes it even if restoration fails.
      ClearErrors
      GetTempFileName $ompBackupDir
      IfErrors omp_backup_failed
      Delete "$ompBackupDir"
      IfErrors omp_backup_failed
      CreateDirectory "$ompBackupDir"
      IfErrors omp_backup_failed
      CopyFiles /SILENT "$0\resources\bin\omp.exe" "$ompBackupDir\omp.exe"
      IfErrors omp_backup_failed
      IfFileExists "$ompBackupDir\omp.exe" 0 omp_backup_failed
    ${EndIf}
    ClearErrors
    Pop $0
    Return

    omp_backup_failed:
      ${If} $ompBackupDir != ""
        Delete "$ompBackupDir\omp.exe"
        RMDir "$ompBackupDir"
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "$(ompBackupFailed)" /SD IDOK
      SetErrorLevel 2
      Quit
  FunctionEnd

  Function ompInstFilesPre
    ; Keep electron-builder's installation-directory normalization.
    Call instFilesPre
    Call ompBackupRuntime
  FunctionEnd
!macroend

!macro customPageAfterChangeDir
  ; Run after the user chooses both installation scope and destination, but
  ; before installSection.nsh invokes either old uninstaller.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE ompInstFilesPre
!macroend

!macro customInit
  ; Silent installers do not run page callbacks. initMultiUser has already
  ; resolved /currentuser, /allusers and the previous installation here.
  ${If} ${Silent}
    Call ompBackupRuntime
  ${EndIf}
!macroend

!macro customInstall
  ${If} $ompBackupDir != ""
    ClearErrors
    CreateDirectory "$INSTDIR\resources\bin"
    CopyFiles /SILENT "$ompBackupDir\omp.exe" "$INSTDIR\resources\bin\omp.exe"
    ${If} ${Errors}
    ${OrIfNot} ${FileExists} "$INSTDIR\resources\bin\omp.exe"
      DetailPrint "$(ompRestoreFailed)"
      MessageBox MB_OK|MB_ICONSTOP "$(ompRestoreFailed)" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    Delete "$ompBackupDir\omp.exe"
    RMDir "$ompBackupDir"
  ${EndIf}
!macroend

!endif
