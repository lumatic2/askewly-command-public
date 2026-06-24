Option Explicit

Dim shell
Dim fso
Dim projectRoot
Dim electronPath
Dim command
Dim logPath
Dim logHandle

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectRoot = fso.GetParentFolderName(WScript.ScriptFullName)
electronPath = projectRoot & "\node_modules\electron\dist\electron.exe"
logPath = projectRoot & "\startup.log"

Set logHandle = fso.OpenTextFile(logPath, 2, True)
logHandle.WriteLine Now & " | launching electron at " & electronPath
logHandle.Close

If Not fso.FileExists(electronPath) Then
  Set logHandle = fso.OpenTextFile(logPath, 8, True)
  logHandle.WriteLine Now & " | electron missing — run npm install"
  logHandle.Close
  WScript.Quit 1
End If

command = """" & electronPath & """ ."
shell.CurrentDirectory = projectRoot
shell.Run command, 0, False
