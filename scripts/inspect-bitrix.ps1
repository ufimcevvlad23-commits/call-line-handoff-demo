$secure = Read-Host -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $plain | node "$PSScriptRoot\inspect-bitrix.mjs"
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    Remove-Variable plain -ErrorAction SilentlyContinue
}
