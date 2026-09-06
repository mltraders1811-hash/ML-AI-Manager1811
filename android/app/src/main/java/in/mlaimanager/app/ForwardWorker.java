package in.mlaimanager.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Posts one bank message to /api/bank/ingest, and keeps trying until it
 * lands.
 *
 * WorkManager is doing the hard part: the work survives the app being
 * killed, the phone rebooting and the network being off, and it backs off
 * rather than hammering. A payment must not be lost because the SMS arrived
 * while the shop's phone had no signal.
 *
 * The server is the authority on what a message means: a message it decides
 * not to book still answers 200, and that counts as delivered here. Only a
 * genuine failure to deliver - no network, a 5xx - is retried.
 */
public class ForwardWorker extends Worker {

    private static final String KEY_TEXT = "text";
    private static final String KEY_SENDER = "sender";
    private static final String KEY_TIMESTAMP = "timestamp";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    /** Enough attempts to cover a night with no signal, spread by backoff. */
    private static final int MAX_ATTEMPTS = 8;

    public ForwardWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void enqueue(Context context, String text, String sender, long timestamp) {
        Data input = new Data.Builder()
            .putString(KEY_TEXT, text)
            .putString(KEY_SENDER, sender == null ? "" : sender)
            .putLong(KEY_TIMESTAMP, timestamp)
            .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ForwardWorker.class)
            .setInputData(input)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag("bank-sms")
            .build();

        WorkManager.getInstance(context.getApplicationContext()).enqueue(request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Prefs prefs = new Prefs(getApplicationContext());
        if (!prefs.isConfigured()) return Result.failure();

        String text = getInputData().getString(KEY_TEXT);
        if (text == null || text.isEmpty()) return Result.failure();

        try {
            int status = post(prefs, text, getInputData().getString(KEY_SENDER), getInputData().getLong(KEY_TIMESTAMP, 0L));

            if (status >= 200 && status < 300) {
                prefs.recordResult(true, "ok");
                return Result.success();
            }
            if (status == 401 || status == 501) {
                // The token is wrong or forwarding is switched off on the
                // server. Retrying cannot fix either, and the settings
                // screen shows this so it can be corrected.
                prefs.recordResult(false, status == 401 ? "token rejected" : "forwarding not enabled on the server");
                return Result.failure();
            }
            if (status >= 400 && status < 500) {
                prefs.recordResult(false, "server refused the message (" + status + ")");
                return Result.failure();
            }
            return retryOrFail(prefs, "server error " + status);
        } catch (Exception e) {
            return retryOrFail(prefs, e.getClass().getSimpleName());
        }
    }

    private Result retryOrFail(Prefs prefs, String reason) {
        if (getRunAttemptCount() + 1 < MAX_ATTEMPTS) {
            prefs.recordResult(false, "retrying after " + reason);
            return Result.retry();
        }
        prefs.recordResult(false, "gave up after " + MAX_ATTEMPTS + " tries: " + reason);
        return Result.failure();
    }

    /**
     * When the message reached the phone, in the form the server parses.
     * java.time would be neater and is API 26; SimpleDateFormat keeps the
     * app working on the Android 7 phones this is likely to be installed on.
     */
    private static String iso8601(long millis) {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            java.util.Locale.US
        );
        format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return format.format(new java.util.Date(millis));
    }

    private int post(Prefs prefs, String text, String sender, long timestamp) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("text", text);
        if (sender != null && !sender.isEmpty()) payload.put("sender", sender);
        if (timestamp > 0) payload.put("receivedAt", iso8601(timestamp));

        HttpURLConnection connection = (HttpURLConnection) new URL(prefs.endpoint()).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + prefs.token());

            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }
}
