import axios from "axios";

const PAYSTACK_SECRET = "sk_test_b260279d69c07196f87e47abce20c3f7a1f621f1";

async function simulateTransfer() {
  try {
    const res = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        email: "testuser@example.com",
        amount: 200000, // ₦2,000
        "customer": "CUS_6tovz7esrbsbx8c",
        "narration": "Test Transfer",
        "currency": "NGN",
        account_number: "1238407552"
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

simulateTransfer();