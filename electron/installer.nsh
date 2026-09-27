; The app used to be called "Grok Transcriber". Remove its old shortcuts so nobody is left
; with a desktop icon pointing at the uninstalled exe.
!macro customInstall
  Delete "$DESKTOP\Grok Transcriber.lnk"
  Delete "$SMPROGRAMS\Grok Transcriber.lnk"
!macroend
