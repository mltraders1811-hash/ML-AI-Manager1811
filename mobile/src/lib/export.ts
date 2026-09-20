import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

/** Writes the text to a real file and hands it to the Android share sheet,
 *  which is how it reaches WhatsApp, Drive or Gmail. A string on the
 *  clipboard would not survive being opened as a spreadsheet. */
export async function shareTextFile(
  fileName: string,
  contents: string,
  mimeType = "text/csv",
): Promise<void> {
  // The cache directory needs no permission and Android clears it on its
  // own, which is right for a file that only exists to be shared.
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType,
      dialogTitle: fileName,
      UTI: "public.comma-separated-values-text",
    });
    return;
  }
  // Web and anything without a share provider still gets the text itself.
  await Share.share(
    Platform.OS === "web" ? { message: contents } : { message: contents, title: fileName },
  );
}
