; Notion Desktop 自定义安装完成页：
; 1) MUI 内置「运行程序」复选框（MUI_FINISHPAGE_RUN）——布局由 MUI 自动计算
; 2) 自定义「创建桌面快捷方式」复选框——紧跟 Run 复选框下方
; 3) 两个复选框状态持久化到注册表，下次安装自动恢复（首次安装默认勾选）
;
; customFinishPage 宏替换 assistedInstaller.nsh 里内置的 MUI_PAGE_FINISH。
; MUI 的 LEAVE 函数会先调 MUI_PAGE_CUSTOMFUNCTION_LEAVE（ ours），再自动读 Run
; 复选框并调 StartApp——所以我们只需在 LEAVE 里持久化状态 + 建桌面快捷方式，
; 运行程序由 MUI 自行处理。

!macro customFinishPage
  Var NDShortcutCheckbox
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

  ; MUI 内置 Run 复选框：定义后 MUI 自动创建并处理布局/Leave 行为
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"

  ; 预声明 MUI 内部变量 $mui.FinishPage.Run + 其去重守卫宏。
  ; MUI 在 MUI_PAGE_FINISH 展开时才声明此 Var，但我们的 SHOW/LEAVE 函数体
  ; 在此之前就引用了它——NSIS 在解析函数体时需要变量已存在，否则报 unknown variable。
  ; 预定义 MUI_FINISHPAGE_RUN_VARIABLES 让 MUI 的 !ifndef 守卫跳过重复声明
  !define MUI_FINISHPAGE_RUN_VARIABLES
  Var mui.FinishPage.Run

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

    ; 恢复 MUI Run 复选框状态（MUI 默认勾选，这里用注册表值覆盖）
    ${If} $NDRunState == "1"
      SendMessage $mui.FinishPage.Run ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $mui.FinishPage.Run ${BM_SETCHECK} ${BST_UNCHECKED} 0
    ${EndIf}

    ; 在 Run 复选框下方创建桌面快捷方式复选框
    ; Run 在 MUI_FINISHPAGE_RUN_TOP（= TEXT_BOTTOM_BUTTONS + 5 ≈ 90u），
    ; ShowReadme 本应在 RUN_TOP + 20 = 110u，我们占用这个位置
    ${NSD_CreateCheckbox} 120u 110u 195u 10u "Create desktop shortcut"
    Pop $NDShortcutCheckbox
    SetCtlColors $NDShortcutCheckbox "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
    System::Call 'UXTHEME::SetWindowTheme(p $NDShortcutCheckbox, w" ", w" ")'
    ${If} $NDShortcutState == "1"
      SendMessage $NDShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}
  FunctionEnd

  Function FinishPageLeave
    ; 读取两个复选框状态
    ${NSD_GetState} $NDShortcutCheckbox $NDShortcutState
    SendMessage $mui.FinishPage.Run ${BM_GETCHECK} 0 0 $NDRunState

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

    ; 运行程序由 MUI LEAVE 自动处理（读 $mui.FinishPage.Run → 调 StartApp）
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishPageLeave
  !insertmacro MUI_PAGE_FINISH
!macroend