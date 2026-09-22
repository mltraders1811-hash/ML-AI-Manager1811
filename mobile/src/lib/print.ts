import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** Opens Android's own print dialog with the document already rendered. From
 *  there it reaches a bluetooth or wifi printer at the counter, or "Save as
 *  PDF" - which is why there is no separate save button. */
export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html });
}

/** Renders to a PDF and hands it to the share sheet, which is how a challan
 *  reaches the transporter on WhatsApp before the lorry does. */
export async function sharePdf(html: string, fileName: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("This phone has nothing to share the file with.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: fileName,
    UTI: "com.adobe.pdf",
  });
}

/** Printing is native: on web the same HTML has to go through the browser. */
export const canPrint = Platform.OS !== "web";
