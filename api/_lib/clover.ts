import { config } from "./config.js";

type Customer = {
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
};

type CheckoutItem = { name: string; price: number; unitQty: number };

export async function createCloverCheckout(input: {
  customer: Customer;
  item: CheckoutItem;
}) {
  const response = await fetch(
    `${config.cloverApiBaseUrl()}/invoicingcheckoutservice/v1/checkouts`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "clover-ticket-checkout-backend/0.1",
        "X-Clover-Merchant-Id": config.cloverMerchantId(),
        Authorization: `Bearer ${config.cloverPrivateToken()}`
      },
      body: JSON.stringify({
        customer: input.customer,
        redirectUrls: {
          success: `${config.siteUrl()}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          failure: `${config.siteUrl()}/payment-failed?error_code={ERROR_CODE}`
        },
        shoppingCart: { lineItems: [input.item] }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Clover checkout creation failed (${response.status}): ${body}`);
  }

  const result = (await response.json()) as {
    href: string;
    checkoutSessionId: string;
    expirationTime: number;
  };
  if (!result.href || !result.checkoutSessionId) {
    throw new Error("Clover returned an incomplete checkout session.");
  }
  return result;
}
