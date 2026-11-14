Set shell = CreateObject("WScript.Shell")
Set link = shell.CreateShortcut(shell.SpecialFolders("Desktop") & "\Timetable Solver.lnk")
link.TargetPath = WScript.Arguments(0)
link.WorkingDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.Arguments(0))
link.Description = "Local timetable solver"
link.Save
