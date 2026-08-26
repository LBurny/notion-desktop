; Notion Desktop 自定义安装完成页：
; 1) 新增「创建桌面快捷方式」复选框（electron-builder 默认无此选项，只自动创建）
; 2) 保留「运行程序」复选框
; 3) 两个复选框状态持久化到注册表，下次安装自动恢复（首次安装默认勾选）
;
; customFinishPage 宏替换 assistedInstaller.nsh 里内置的 MUI_PAGE_FINISH。
; 复选框文案用英文（MUI 标准元素已由 electron-builder 本地化，自定义控件不跟语言走）

!macro customFinishPage
  Var NDShortcutCheckbox
  Var NDRunCheckbox
  Var NDShortcutState
  Var NDRunState

  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function FinishPageShow
    ; 从注册表读取上次选择（首次安装为空 → 默认勾选）
    ReadRegStr $NDShortcutState HKCU "${INSTALL_REGISTRY_KEY}" "DesktopShortcut"
    ReadRegStr $NDRunState HKCU "${INSTALL_REGISTRY_KEY}" "RunAfterFinish"
    ${If} $NDShortcutState == ""
      StrCpy $NDShortcutState "1"
    ${EndIf}
    ${If} $NDRunState == ""
      StrCpy $NDRunState "1"
    ${EndIf}

    ; 在完成页上创建复选框
    ${NSD_CreateCheckbox} 120u 100u 195u 10u "Create desktop shortcut"
    Pop $NDShortcutCheckbox
    ${If} $NDShortcutState == "1"
      ${NSD_SetState} $NDShortcutCheckbox ${BST_CHECKED}
    ${EndIf}

    ${NSD_CreateCheckbox} 120u 115u 195u 10u "Run $(^Name)"
    Pop $NDRunCheckbox
    ${If} $NDRunState == "1"
      ${NSD_SetState} $NDRunCheckbox ${BST_CHECKED}
    ${EndIf}
  FunctionEnd

  Function FinishPageLeave
    ${NSD_GetState} $NDShortcutCheckbox $NDShortcutState
    ${NSD_GetState} $NDRunCheckbox $NDRunState

    ; 持久化到注册表供下次安装恢复
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "DesktopShortcut" $NDShortcutState
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "RunAfterFinish" $NDRunState

    ; 勾选了桌面快捷方式则创建（installSection 因 createDesktopShortcut=false 未创建）
    ${If} $NDShortcutState == ${BST_CHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}

    ; 勾选了运行则启动程序
    ${If} $NDRunState == ${BST_CHECKED}
      Call StartApp
    ${EndIf}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishPageLeave
  !insertmacro MUI_PAGE_FINISH
!macroend