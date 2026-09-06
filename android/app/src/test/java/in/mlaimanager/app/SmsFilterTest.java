package in.mlaimanager.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The on-phone filter decides what leaves the device at all, so its two
 * failure modes are worth separating: forwarding a private message is a
 * privacy failure, and dropping a bank message is a silent one - the payment
 * simply never appears and nobody is told why. These cover both directions
 * against the wordings ICICI actually sends.
 */
public class SmsFilterTest {

    private static final String[] BANKS = { "ICICI" };
    private static final String[] ACCOUNTS = { "1811" };

    private boolean forward(String sender, String body) {
        return SmsFilter.shouldForward(sender, body, BANKS, ACCOUNTS);
    }

    @Test
    public void forwardsAnIciciCreditForTheTrackedAccount() {
        assertTrue(
            forward(
                "AD-ICICIB",
                "Dear Customer, Acct XX1811 is credited with Rs 25,000.00 on 05-Aug-26 from SHARMA TRADERS. UPI:451203377421-ICICI Bank."
            )
        );
    }

    @Test
    public void forwardsWhenIciciMasksTheAccountToThreeDigits() {
        // "XX811" is the same 1811 account; dropping this would lose real
        // payments and say nothing about it.
        assertTrue(
            forward(
                "AD-ICICIT",
                "ICICI Bank Acct XX811 credited with Rs 5,000.00 on 05-Aug-26. Info: UPI/451203377/SHARMA. Available Balance is Rs 1,25,000.00"
            )
        );
    }

    @Test
    public void forwardsWhenOnlyTheBodyNamesTheBank() {
        assertTrue(forward("+919812345678", "Acct XX1811 is credited with Rs 4,000.00 on 05-Aug-26. -ICICI Bank"));
    }

    @Test
    public void keepsAnotherBanksMessageOnThePhone() {
        assertFalse(
            forward("AD-HDFCBK", "Rs.7000.00 credited to a/c XXXXXX1811 on 05-08-26 by VPA someone@okhdfcbank (UPI Ref 5566778899).")
        );
    }

    @Test
    public void keepsAnotherAccountsMessageOnThePhone() {
        assertFalse(forward("AD-ICICIB", "Dear Customer, Acct XX9920 is credited with Rs 9,000.00 on 05-Aug-26. -ICICI Bank"));
    }

    @Test
    public void keepsPrivateAndPromotionalMessagesOnThePhone() {
        assertFalse(forward("AD-ICICIB", "Get a pre-approved ICICI Bank credit card for Acct XX1811. Apply now!"));
        assertFalse(forward("MUMMY", "Beta khana kha lena, Rs 500 bhej diye"));
        assertFalse(forward("AD-ICICIB", "Your ICICI Bank OTP is 123456. Valid for 10 minutes."));
    }

    @Test
    public void forwardsAnythingWhenNoFilterIsConfigured() {
        assertTrue(
            SmsFilter.shouldForward("AD-HDFCBK", "Rs.500 credited to a/c XX0001 on 05-08-26", new String[0], new String[0])
        );
    }
}
