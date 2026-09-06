package in.mlaimanager.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * Catches the bank's SMS as it arrives, whether or not the app is open.
 *
 * A receiver gets about ten seconds and is killed after it returns, so it
 * does no network work itself: it assembles the message, applies the local
 * filter, and hands anything worth sending to WorkManager, which owns the
 * retrying (see ForwardWorker). That is what makes a payment received while
 * the phone is in a basement with no signal still reach the app later,
 * rather than being lost the moment the receiver returns.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "BankSms";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        Prefs prefs = new Prefs(context);
        if (!prefs.isConfigured()) return; // nothing set up yet; stay silent

        Bundle extras = intent.getExtras();
        if (extras == null) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        // A bank alert regularly runs past 160 characters and arrives as
        // several parts. Joining them is not optional: half a message has
        // half an amount in it.
        StringBuilder body = new StringBuilder();
        String sender = null;
        long timestamp = System.currentTimeMillis();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            if (sender == null) sender = part.getOriginatingAddress();
            timestamp = part.getTimestampMillis();
            String text = part.getMessageBody();
            if (text != null) body.append(text);
        }

        String text = body.toString().trim();
        if (text.isEmpty()) return;

        if (!SmsFilter.shouldForward(sender, text, prefs.banks(), prefs.accounts())) {
            // Deliberately not logged in full: this is somebody's private
            // inbox, and the message is not ours to record.
            Log.d(TAG, "Message ignored by the on-phone filter");
            return;
        }

        ForwardWorker.enqueue(context, text, sender, timestamp);
    }
}
