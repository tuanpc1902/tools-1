param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$EntryPath,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$AppId,
    [Parameter(Mandatory = $true)][string]$ProtocolScheme,
    [Parameter(Mandatory = $true)][string]$ProtocolCommandPath
)

$ErrorActionPreference = 'Stop'

$shortcutDirectory = Split-Path -Parent $ShortcutPath
New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace ReminderDeskShellRegistration
{
    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLink { }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int maxPath, IntPtr data, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int maxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int maxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int maxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCommand);
        void SetShowCmd(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int iconPathLength, out int iconIndex);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("0000010B-0000-0000-C000-000000000046")]
    internal interface IPersistFile
    {
        void GetClassID(out Guid classId);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    internal struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;

        public PropertyKey(Guid formatId, uint propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct PropVariant
    {
        [FieldOffset(0)] private ushort valueType;
        [FieldOffset(8)] private IntPtr pointerValue;

        public PropVariant(string value)
        {
            valueType = (ushort)VarEnum.VT_LPWSTR;
            pointerValue = Marshal.StringToCoTaskMemUni(value);
        }

        public void Clear()
        {
            PropVariantClear(ref this);
        }

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant value);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    internal interface IPropertyStore
    {
        uint GetCount();
        PropertyKey GetAt(uint propertyIndex);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    public static class ShortcutRegistrar
    {
        public static void Create(string shortcutPath, string targetPath, string entryPath, string workingDirectory, string appId)
        {
            object shellObject = new ShellLink();
            try
            {
                IShellLinkW link = (IShellLinkW)shellObject;
                link.SetPath(targetPath);
                link.SetArguments("\"" + entryPath + "\"");
                link.SetWorkingDirectory(workingDirectory);
                link.SetDescription("Local reminder scheduler");
                link.SetIconLocation(targetPath, 0);
                link.SetShowCmd(1);

                IPropertyStore propertyStore = (IPropertyStore)shellObject;
                PropertyKey appIdKey = new PropertyKey(
                    new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                    5
                );
                PropVariant appIdValue = new PropVariant(appId);
                try
                {
                    propertyStore.SetValue(ref appIdKey, ref appIdValue);
                    propertyStore.Commit();
                }
                finally
                {
                    appIdValue.Clear();
                }

                ((IPersistFile)shellObject).Save(shortcutPath, true);
            }
            finally
            {
                if (Marshal.IsComObject(shellObject)) Marshal.FinalReleaseComObject(shellObject);
            }
        }
    }
}
'@

[ReminderDeskShellRegistration.ShortcutRegistrar]::Create(
    $ShortcutPath,
    $TargetPath,
    $EntryPath,
    $WorkingDirectory,
    $AppId
)

$protocolRoot = "Registry::HKEY_CURRENT_USER\Software\Classes\$ProtocolScheme"
$protocolCommand = Join-Path $protocolRoot 'shell\open\command'
New-Item -Path $protocolCommand -Force | Out-Null
New-ItemProperty -Path $protocolRoot -Name '(Default)' -Value "URL:Reminder Desk Confirmation" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$commandValue = '"{0}" "{1}" "%1"' -f $TargetPath, $ProtocolCommandPath
Set-ItemProperty -Path $protocolCommand -Name '(Default)' -Value $commandValue
