import axios from "axios";

// Replace with your actual Solscan Pro API key
const SOLSCAN_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjcmVhdGVkQXQiOjE3NDM2OTQ5OTY4OTcsImVtYWlsIjoiamFtYWFsLm11dGFsaXBoQHRyaXJlbWV0cmFkaW5nLmNvbSIsImFjdGlvbiI6InRva2VuLWFwaSIsImFwaVZlcnNpb24iOiJ2MiIsImlhdCI6MTc0MzY5NDk5Nn0.7qakaGTx9vPod2zjbaulgPV3kXILQABF0XokxE-ocPA";

// Function to fetch token transfers
async function fetchAllTransfers(
  walletAddress: string,
  fromTime: number,
  toTime: number,
  flow: "in" | "out",
  page: number = 1,
  pageSize: number = 20,
) {
  const url = "https://pro-api.solscan.io/v2.0/account/transfer";

  const params = {
    address: walletAddress,
    from_time: fromTime,
    to_time: toTime,
    flow: flow,
    page: page,
    page_size: pageSize,
    activity_type: ["ACTIVITY_SPL_TRANSFER"],
    exclude_amount_zero: true,
    sort_by: "block_time",
    sort_order: "desc",
  };

  try {
    const response = await axios.get(url, {
      headers: {
        token: SOLSCAN_API_KEY,
      },
      params,
    });

    if (response.data.success) {
      return response.data.data;
    } else {
      console.error("API error:", response.data);
      return [];
    }
  } catch (error) {
    console.error("Request failed:", error);
    return [];
  }
}

// Example usage
(async () => {
  const walletAddress = "H25JCfBpbdkFGhazRYPYqpuS6aoDzCzJBnvV6kQqf2xb";
  const fromTime = Math.floor(
    new Date("2025-05-01T00:00:00Z").getTime() / 1000,
  );
  const toTime = Math.floor(new Date("2025-05-02T23:59:59Z").getTime() / 1000);

  const incoming = await fetchAllTransfers(
    walletAddress,
    fromTime,
    toTime,
    "in",
  );
  const outgoing = await fetchAllTransfers(
    walletAddress,
    fromTime,
    toTime,
    "out",
  );

  console.log("Incoming transfers:", incoming);
  console.log("Outgoing transfers:", outgoing);
})();
