package in.mlaimanager.app;

/**
 * Decides, on the phone, whether a message is worth sending to the server.
 *
 * The server does the real filtering (it is the one that knows the bank and
 * account rules, and it logs what it rejected). This exists for a different
 * reason: a phone's inbox is full of private messages that have nothing to do
 * with the business, and forwarding all of them so the server can throw most
 * away would be an unpleasant thing to build. So nothing leaves the phone
 * unless it looks like a bank message about a tracked account.
 *
 * Deliberately loose. A message this drops is one the owner will never see in
 * the app, so where it is unsure it forwards and lets the server decide -
 * being wrong here is silent, and silence is the failure mode that matters.
 * Deliberately free of every Android and androidx import, so the rules that
 * decide what leaves someone's phone can be compiled and run on a plain JVM -
 * by CI, and by anyone reviewing this without an Android SDK to hand.
 */
public final class SmsFilter {

    private SmsFilter() {}

    /** Money words, in the forms Indian banks actually send. */
    private static final String[] TRANSACTION_WORDS = {
        "credited", "debited", "deposited", "credit of", "received", "withdrawn", "transferred"
    };

    private static final String[] AMOUNT_MARKERS = { "rs.", "rs ", "inr", "₹" };

    /**
     * @param sender  the SMS sender id, e.g. "AD-ICICIB" - may be null
     * @param body    the message text
     * @param banks   sender fragments to accept, e.g. ["ICICI"]; empty accepts any sender
     * @param accounts last-4s to accept, e.g. ["1811"]; empty accepts any account
     */
    public static boolean shouldForward(String sender, String body, String[] banks, String[] accounts) {
        String text = body.toLowerCase();

        if (!looksLikeMoney(text)) return false;
        if (!mentionsBank(sender, text, banks)) return false;
        return mentionsAccount(text, accounts);
    }

    private static boolean looksLikeMoney(String text) {
        boolean hasAmount = false;
        for (String marker : AMOUNT_MARKERS) {
            if (text.contains(marker)) {
                hasAmount = true;
                break;
            }
        }
        if (!hasAmount) return false;

        for (String word : TRANSACTION_WORDS) {
            if (text.contains(word)) return true;
        }
        return false;
    }

    private static boolean mentionsBank(String sender, String text, String[] banks) {
        if (banks.length == 0) return true;
        String from = sender == null ? "" : sender.toLowerCase();
        for (String bank : banks) {
            String needle = bank.trim().toLowerCase();
            if (needle.isEmpty()) continue;
            // "AD-ICICIB" in the sender, or "-ICICI Bank" in the wording.
            if (from.contains(needle) || text.contains(needle)) return true;
        }
        return false;
    }

    /**
     * Account numbers are masked to different lengths by different banks -
     * ICICI writes "Acct XX811" where HDFC writes "XXXXXX1811" - so a run of
     * digits counts as this account when either is a suffix of the other,
     * down to three digits. Same rule the server applies; see
     * matchTrackedAccount in src/lib/bank/alertService.ts.
     */
    private static boolean mentionsAccount(String text, String[] accounts) {
        if (accounts.length == 0) return true;

        for (String digits : digitRuns(text)) {
            for (String wanted : accounts) {
                String want = wanted.trim();
                if (want.isEmpty()) continue;
                int length = Math.min(digits.length(), want.length());
                if (length < 3) continue;
                if (digits.substring(digits.length() - length).equals(want.substring(want.length() - length))) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Every run of digits in the message, longest-first order not required. */
    private static java.util.List<String> digitRuns(String text) {
        java.util.List<String> runs = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= '0' && c <= '9') {
                current.append(c);
            } else if (current.length() > 0) {
                runs.add(current.toString());
                current.setLength(0);
            }
        }
        if (current.length() > 0) runs.add(current.toString());
        return runs;
    }
}
