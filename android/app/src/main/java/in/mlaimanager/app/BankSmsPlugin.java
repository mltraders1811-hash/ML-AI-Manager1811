package in.mlaimanager.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The bridge between the web app running in the WebView and the phone's SMS
 * inbox. Everything here is driven from the app's own settings screen
 * (src/app/settings/android), so the owner never types a token on a phone
 * keyboard: the screen reads the configuration from the server they are
 * already logged into and hands it to configure() below.
 */
@CapacitorPlugin(
    name = "BankSms",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS })
    }
)
public class BankSmsPlugin extends Plugin {

    /** How far back catchUp() will look. A week covers a lost weekend. */
    private static final int MAX_BACKFILL_DAYS = 30;

    @PluginMethod
    public void configure(PluginCall call) {
        String endpoint = call.getString("endpoint", "");
        String token = call.getString("token", "");
        if (endpoint == null || endpoint.isEmpty() || token == null || token.isEmpty()) {
            call.reject("endpoint and token are both required");
            return;
        }
        new Prefs(getContext()).save(endpoint, token, call.getString("banks", ""), call.getString("accounts", ""));
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (granted()) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("sms", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(status());
    }

    /**
     * Reads the recent inbox and forwards the bank messages in it.
     *
     * Two moments need this: the day the app is installed, when the last
     * week of payments is already sitting on the phone and nowhere else, and
     * after the app has been force-stopped, when Android delivers a
     * receiver nothing. Re-sending a message is safe by design - the server
     * fingerprints each one and answers "already had it".
     */
    @PluginMethod
    public void catchUp(PluginCall call) {
        if (!granted()) {
            call.reject("SMS permission has not been granted");
            return;
        }
        Prefs prefs = new Prefs(getContext());
        if (!prefs.isConfigured()) {
            call.reject("Forwarding is not configured yet");
            return;
        }

        int days = Math.min(call.getInt("days", 7), MAX_BACKFILL_DAYS);
        long since = System.currentTimeMillis() - (long) days * 24 * 60 * 60 * 1000;

        int scanned = 0;
        int queued = 0;
        Cursor cursor = null;
        try {
            cursor =
                getContext()
                    .getContentResolver()
                    .query(
                        Uri.parse("content://sms/inbox"),
                        new String[] { "address", "body", "date" },
                        "date >= ?",
                        new String[] { String.valueOf(since) },
                        "date DESC"
                    );
            if (cursor != null) {
                int addressCol = cursor.getColumnIndex("address");
                int bodyCol = cursor.getColumnIndex("body");
                int dateCol = cursor.getColumnIndex("date");
                while (cursor.moveToNext()) {
                    scanned++;
                    String sender = addressCol >= 0 ? cursor.getString(addressCol) : null;
                    String body = bodyCol >= 0 ? cursor.getString(bodyCol) : null;
                    long date = dateCol >= 0 ? cursor.getLong(dateCol) : System.currentTimeMillis();
                    if (body == null || body.trim().isEmpty()) continue;
                    if (!SmsFilter.shouldForward(sender, body, prefs.banks(), prefs.accounts())) continue;
                    ForwardWorker.enqueue(getContext(), body, sender, date);
                    queued++;
                }
            }
        } catch (Exception e) {
            call.reject("Couldn't read the inbox: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = status();
        result.put("scanned", scanned);
        result.put("queued", queued);
        call.resolve(result);
    }

    /** Sends one message through the real pipeline, to prove the setup works. */
    @PluginMethod
    public void sendTest(PluginCall call) {
        Prefs prefs = new Prefs(getContext());
        if (!prefs.isConfigured()) {
            call.reject("Forwarding is not configured yet");
            return;
        }
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("text is required");
            return;
        }
        ForwardWorker.enqueue(getContext(), text, call.getString("sender", "TEST"), System.currentTimeMillis());
        call.resolve(status());
    }

    /** String.join is API 26; this app still runs on Android 7 phones. */
    private static String join(String[] values) {
        StringBuilder out = new StringBuilder();
        for (String value : values) {
            if (out.length() > 0) out.append(",");
            out.append(value);
        }
        return out.toString();
    }

    private boolean granted() {
        return (
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED
        );
    }

    private JSObject status() {
        Prefs prefs = new Prefs(getContext());
        JSObject status = new JSObject();
        status.put("available", true);
        status.put("configured", prefs.isConfigured());
        status.put("permissionGranted", granted());
        status.put("canReadInbox",
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
        );
        status.put("endpoint", prefs.endpoint());
        status.put("banks", join(prefs.banks()));
        status.put("accounts", join(prefs.accounts()));
        status.put("forwardedCount", prefs.forwardedCount());
        status.put("lastForwardedAt", prefs.lastForwardedAt());
        status.put("lastResult", prefs.lastResult());
        return status;
    }
}
