Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
  !else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

# ── File associations (parity with the 3.2.0 Electron installer) ─────────────
# electron-builder declared 8 audio extensions in package.json's
# `fileAssociations`; the Wails NSIS template ships them empty, so Aura must
# re-register them here: one ProgID per extension, a SupportedTypes entry so
# "Open with" and Settings → Default apps list Aura, and an
# ApplicationCapabilities block for the Windows 10/11 default-apps UI.

!macro AUDIO_ASSOCIATE EXT DESC
  DeleteRegKey SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}" "" "${DESC}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}\DefaultIcon" "" "$INSTDIR\${PRODUCT_EXECUTABLE},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}\shell\open" "" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXECUTABLE}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "AuraPlayer.${EXT}" ""
!macroend

!macro AUDIO_CAPABILITY EXT
  WriteRegStr SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}\Capabilities\FileAssociations" ".${EXT}" "AuraPlayer.${EXT}"
!macroend

!macro AUDIO_ASSOCIATE_ALL
  !insertmacro AUDIO_ASSOCIATE "mp3" "MP3 Audio File"
  !insertmacro AUDIO_ASSOCIATE "flac" "FLAC Audio File"
  !insertmacro AUDIO_ASSOCIATE "wav" "WAV Audio File"
  !insertmacro AUDIO_ASSOCIATE "ogg" "OGG Audio File"
  !insertmacro AUDIO_ASSOCIATE "m4a" "M4A Audio File"
  !insertmacro AUDIO_ASSOCIATE "aac" "AAC Audio File"
  !insertmacro AUDIO_ASSOCIATE "opus" "Opus Audio File"
  !insertmacro AUDIO_ASSOCIATE "wma" "WMA Audio File"
  # Applications entry + SupportedTypes: makes Aura appear in Open With.
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCT_EXECUTABLE}" "" "$INSTDIR\${PRODUCT_EXECUTABLE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".mp3" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".flac" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".wav" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".ogg" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".m4a" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".aac" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".opus" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".wma" ""
  # Capabilities block for Settings → Default apps.
  WriteRegStr SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}\Capabilities" "ApplicationDescription" "${INFO_PRODUCTNAME} — ${INFO_COMPANYNAME}"
  WriteRegStr SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${PRODUCT_EXECUTABLE},0"
  !insertmacro AUDIO_CAPABILITY "mp3"
  !insertmacro AUDIO_CAPABILITY "flac"
  !insertmacro AUDIO_CAPABILITY "wav"
  !insertmacro AUDIO_CAPABILITY "ogg"
  !insertmacro AUDIO_CAPABILITY "m4a"
  !insertmacro AUDIO_CAPABILITY "aac"
  !insertmacro AUDIO_CAPABILITY "opus"
  !insertmacro AUDIO_CAPABILITY "wma"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${INFO_PRODUCTNAME}" "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}\Capabilities"
!macroend

!macro AUDIO_UNASSOCIATE_ALL
  DetailPrint "Removing file associations"
  # Delete each Aura ProgID and drop Aura from every extension's OpenWith list.
  !insertmacro AUDIO_UNASSOCIATE "mp3"
  !insertmacro AUDIO_UNASSOCIATE "flac"
  !insertmacro AUDIO_UNASSOCIATE "wav"
  !insertmacro AUDIO_UNASSOCIATE "ogg"
  !insertmacro AUDIO_UNASSOCIATE "m4a"
  !insertmacro AUDIO_UNASSOCIATE "aac"
  !insertmacro AUDIO_UNASSOCIATE "opus"
  !insertmacro AUDIO_UNASSOCIATE "wma"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}"
  DeleteRegKey SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${PRODUCT_EXECUTABLE}"
  DeleteRegKey SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${INFO_PRODUCTNAME}"
!macroend

!macro AUDIO_UNASSOCIATE EXT
  DeleteRegKey SHELL_CONTEXT "Software\Classes\AuraPlayer.${EXT}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "AuraPlayer.${EXT}"
!macroend

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    # Aura's own audio associations (8 extensions, mirrors electron-builder).
    !insertmacro AUDIO_ASSOCIATE_ALL

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols
    !insertmacro AUDIO_UNASSOCIATE_ALL

    !insertmacro wails.deleteUninstaller
SectionEnd
