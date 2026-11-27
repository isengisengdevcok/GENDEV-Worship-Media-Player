[Setup]
AppName=GENDEV Worship Media Player
AppVersion=1.0.0
AppPublisher=GENDEV
DefaultDirName={autopf}\GENDEV Worship Media Player
DefaultGroupName=GENDEV Worship Media Player
OutputDir=..\dist\installer
OutputBaseFilename=GENDEV Worship Media Player Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\GENDEV_Dir\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\GENDEV Worship Media Player"; Filename: "{app}\GENDEV.exe"
Name: "{autodesktop}\GENDEV Worship Media Player"; Filename: "{app}\GENDEV.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\GENDEV.exe"; Description: "Launch GENDEV Worship Media Player"; Flags: nowait postinstall skipifsilent
