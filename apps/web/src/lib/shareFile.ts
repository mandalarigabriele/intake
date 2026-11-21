/**
 * Hands a file to the person: the system share sheet where there is one (phones and tablets, including the installed
 * iPhone app, where a download link does nothing useful), a download otherwise.
 */
export async function shareFile(blob: Blob, name: string, type: string): Promise<void> {
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch {
      // Closing the share sheet is not an error
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
