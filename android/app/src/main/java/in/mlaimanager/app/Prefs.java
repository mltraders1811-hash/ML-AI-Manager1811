package in.mlaimanager.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the app keeps what it needs to forward a message: the endpoint, the
 * ingest token, and the bank/account filters. Written once from the app's
 * settings screen (which reads them from the server, so nothing is typed on
 * a phone keyboard) and read by a broadcast receiver that may run when no
 * screen is open.
 */
public final class Prefs {

    private static final String FILE = "bank_sms";

    private static final String KEY_ENDPOINT = "endpoint";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_BANKS = "banks";
    private static final String KEY_ACCOUNTS = "accounts";
    private static final String KEY_FORWARDED = "forwarded_count";
    private static final String KEY_LAST_AT = "last_forwarded_at";
    private static final String KEY_LAST_RESULT = "last_result";

    private final SharedPreferences prefs;

    public Prefs(Context context) {
        this.prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public void save(String endpoint, String token, String banks, String accounts) {
        prefs
            .edit()
            .putString(KEY_ENDPOINT, endpoint)
            .putString(KEY_TOKEN, token)
            .putString(KEY_BANKS, banks == null ? "" : banks)
            .putString(KEY_ACCOUNTS, accounts == null ? "" : accounts)
            .apply();
    }

    public String endpoint() {
        return prefs.getString(KEY_ENDPOINT, "");
    }

    public String token() {
        return prefs.getString(KEY_TOKEN, "");
    }

    public String[] banks() {
        return split(prefs.getString(KEY_BANKS, ""));
    }

    public String[] accounts() {
        return split(prefs.getString(KEY_ACCOUNTS, ""));
    }

    public boolean isConfigured() {
        return !endpoint().isEmpty() && !token().isEmpty();
    }

    /** Counters behind the "forwarding is live" line on the Bank screen. */
    public void recordResult(boolean delivered, String result) {
        SharedPreferences.Editor edit = prefs.edit().putString(KEY_LAST_RESULT, result);
        if (delivered) {
            edit.putInt(KEY_FORWARDED, forwardedCount() + 1).putLong(KEY_LAST_AT, System.currentTimeMillis());
        }
        edit.apply();
    }

    public int forwardedCount() {
        return prefs.getInt(KEY_FORWARDED, 0);
    }

    public long lastForwardedAt() {
        return prefs.getLong(KEY_LAST_AT, 0L);
    }

    public String lastResult() {
        return prefs.getString(KEY_LAST_RESULT, "");
    }

    private static String[] split(String value) {
        if (value == null || value.trim().isEmpty()) return new String[0];
        String[] parts = value.split(",");
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) out.add(trimmed);
        }
        return out.toArray(new String[0]);
    }
}
