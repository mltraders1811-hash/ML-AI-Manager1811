package in.mlaimanager.app;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BankSmsPlugin.class);
        super.onCreate(savedInstanceState);
        enableDownloads();
    }

    /**
     * Invoice PDFs, broker statements and the backup export are ordinary
     * downloads in a browser and do nothing at all in a WebView, which has
     * no download handling of its own - the tap just appears to be ignored.
     * Handing them to Android's DownloadManager (with the session cookie, or
     * the server would return the login page instead of the file) makes them
     * land in Downloads and show the usual notification.
     */
    private void enableDownloads() {
        getBridge()
            .getWebView()
            .setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) request.addRequestHeader("Cookie", cookies);
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setMimeType(mimeType);

                    String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setTitle(filename);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

                    DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (manager == null) return;
                    manager.enqueue(request);
                    Toast.makeText(this, "Download shuru ho gaya", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Download nahi ho paya", Toast.LENGTH_SHORT).show();
                }
            });
    }
}
