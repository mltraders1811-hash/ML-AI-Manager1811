import { describe, expect, it } from "vitest";

import { bankFromSender, findAccountLast4, parseBankAlert } from "../src/lib/bank/alertParser";

// The wordings below follow the shapes Indian banks actually send. Each one
// is here because it differs from the others in a way that broke a naive
// reading: where the amount sits relative to the balance, whether the payer
// is introduced by "from", "by" or an "Info-" tail, and how the date is
// punctuated.

function parse(text: string, sender?: string) {
  const result = parseBankAlert(text, { sender, receivedAt: new Date(Date.UTC(2026, 7, 5)) });
  if (!result.ok) throw new Error(`expected a readable alert, got: ${result.reason}`);
  return result.alert;
}

describe("credit alerts", () => {
  it("reads an HDFC UPI credit", () => {
    const alert = parse(
      "Rs.25000.00 credited to a/c XXXXXX4471 on 05-08-26 by a/c linked to VPA sharmatraders@okhdfcbank (UPI Ref No 451203377421).",
      "AD-HDFCBK",
    );
    expect(alert).toMatchObject({
      direction: "CREDIT",
      amount: 25000,
      accountLast4: "4471",
      reference: "451203377421",
      counterpartyKey: "SHARMATRADERS",
    });
    expect(alert.date.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("reads an ICICI credit that names the payer with 'from'", () => {
    const alert = parse(
      "Dear Customer, Acct XX471 is credited with Rs 25,000.00 on 05-Aug-26 from SHARMA TRADERS. UPI:451203377421-ICICI Bank.",
      "AD-ICICIB",
    );
    expect(alert).toMatchObject({ direction: "CREDIT", amount: 25000, counterpartyKey: "SHARMA TRADERS" });
    expect(alert.bankName).toBe("ICICI");
  });

  it("reads an SBI credit written without separators in the date", () => {
    const alert = parse(
      "Dear UPI user A/C X4471 credited by Rs.5000 on 05Aug26 by Sharma traders (UPI Ref no 451203377421)-SBI",
      "AD-SBIUPI",
    );
    expect(alert).toMatchObject({ direction: "CREDIT", amount: 5000, counterpartyKey: "SHARMA TRADERS" });
    expect(alert.date.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("does not mistake the closing balance for the payment", () => {
    const alert = parse(
      "Update! INR 12,000.00 deposited in HDFC Bank A/c XX4471 on 05-AUG-26 for NEFT Cr-UTIB0000123-VERMA AGENCY-AXISP00234981. Avl bal INR 3,25,000.00",
      "AD-HDFCBK",
    );
    expect(alert.amount).toBe(12000);
    expect(alert.balanceAfter).toBe(325000);
    expect(alert.counterpartyKey).toContain("VERMA AGENCY");
  });

  it("reads a payer out of an Axis 'Info' tail", () => {
    const alert = parse(
      "INR 18,000.00 credited to A/c no. XX4471 on 05-08-26 at 14:32:11 IST. Info- UPI/P2A/451203377/SHARMA TRAD. Avl Bal- INR 2,18,000.00",
      "AD-AXISBK",
    );
    expect(alert).toMatchObject({ direction: "CREDIT", amount: 18000, counterpartyKey: "SHARMA TRAD" });
  });
});

describe("debit alerts", () => {
  it("reads money going out and says so", () => {
    const alert = parse(
      "Rs.12000.00 debited from a/c XX4471 on 05-08-26 to VPA supplier@ybl. UPI Ref 998877665544.",
      "AD-HDFCBK",
    );
    expect(alert).toMatchObject({ direction: "DEBIT", amount: 12000, reference: "998877665544" });
  });

  it("takes the first of the two words when a message says both", () => {
    const alert = parse("Rs.5000 debited from A/c XX4471 and credited to beneficiary on 05-08-26. Ref 123456789012");
    expect(alert.direction).toBe("DEBIT");
  });
});

describe("messages that must not become receipts", () => {
  const rejected = [
    ["a collect request", "You have received a collect request of Rs.5000 from rahul@ybl. Approve in your UPI app by 6pm."],
    ["an OTP", "123456 is the OTP for your transaction of Rs.25000 on HDFC Bank Card. Do not share it with anyone."],
    ["a future debit", "Rs.4,500 will be debited from your A/c XX4471 on 10-08-26 towards your SIP mandate."],
    ["a failed payment", "Your payment of Rs.9,000 to sharma@okhdfc has failed. The amount will be refunded."],
    ["a card offer", "Get a lifetime free credit card with limit up to Rs.5,00,000. Apply now."],
  ];

  for (const [what, text] of rejected) {
    it(`refuses ${what}`, () => {
      const result = parseBankAlert(text!, { sender: "AD-HDFCBK" });
      expect(result.ok).toBe(false);
    });
  }

  it("explains why rather than failing silently", () => {
    const result = parseBankAlert("Aapka balance kam hai", { sender: "AD-HDFCBK" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/amount|short/i);
  });

  it("refuses a message that never says which way the money went", () => {
    const result = parseBankAlert("Rs.5,000.00 UPI transaction on A/c XX4471 on 05-08-26 Ref 451203377421", {});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/came in or went out/i);
  });
});

describe("which account the message is about", () => {
  it("picks the last four digits out of the wordings banks use", () => {
    expect(findAccountLast4("credited to a/c XXXXXX4471 on")).toBe("4471");
    expect(findAccountLast4("Acct XX471 is credited")).toBe("471");
    expect(findAccountLast4("A/C X4471 credited by")).toBe("4471");
    expect(findAccountLast4("your Kotak Bank AC X4471 from")).toBe("4471");
    expect(findAccountLast4("no account number here")).toBeNull();
  });

  it("names the bank from the sender id when the text doesn't", () => {
    expect(bankFromSender("AD-HDFCBK")).toBe("HDFC");
    expect(bankFromSender("VM-KOTAKB")).toBe("Kotak");
    expect(bankFromSender("+919812345678")).toBeNull();
  });
});
