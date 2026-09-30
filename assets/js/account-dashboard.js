(() => {
  let client = null;
  let config = null;
  let cutoff = "2027-01-02T00:00:00Z";

  const $ = id => document.getElementById(id);
  const status = message => {
    if ($("account-status")) $("account-status").textContent = message || "";
  };

  async function currentSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function callFounderFunction(name, session, body = {}) {
    const response = await fetch(`${config.edgeFunctionBase}/${name}`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `PAI payment service returned HTTP ${response.status}.`);
    }
    return data;
  }

  async function loadProfile(session, retries = 0) {
    const { data, error } = await client
      .from("profiles")
      .select("plan,founding_supporter,founding_supporter_purchased_at")
      .eq("id", session.user.id)
      .single();

    if (error && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 900));
      return loadProfile(session, retries + 1);
    }

    if (error) {
      status(error.message || "Could not load your PAI account.");
      return;
    }

    const plan = data?.plan === "pro" ? "Pro" : "Free";
    const founder = Boolean(data?.founding_supporter);

    $("account-email").textContent = session.user.email || "";
    $("detail-email").textContent = session.user.email || "—";
    $("detail-plan").textContent = plan;
    $("detail-founder").textContent = founder ? "Permanent" : "Not active";
    $("detail-usage").textContent = plan === "Pro" ? "Highest" : (founder ? "Higher" : "Standard");
    $("account-badge").textContent = founder ? "FOUNDING SUPPORTER" : plan.toUpperCase();

    if (founder) {
      $("founder-card").classList.add("is-founder");
      $("founder-copy").textContent = "Your Founding Supporter status is permanently attached to this PAI account. Thank you for supporting PAI during active development.";
    } else {
      $("founder-card").classList.remove("is-founder");
      $("founder-copy").textContent = "A one-time $5 contribution directly supports continued PAI development and permanently adds Founding Supporter status to your account.";
    }

    const offerOpen = Date.now() < Date.parse(cutoff);
    $("founder-checkout").hidden = founder || !offerOpen;

    if (!offerOpen && !founder) {
      $("founder-copy").textContent = "The Founding Supporter offer has ended.";
    }
  }

  async function init() {
    try {
      const cfgRes = await fetch("account-config.json", { cache: "no-store" });
      if (!cfgRes.ok) throw new Error("PAI account configuration is not available.");
      config = await cfgRes.json();

      if (!config.supabaseUrl || !config.supabaseAnonKey || !config.edgeFunctionBase) {
        throw new Error("PAI account configuration is incomplete.");
      }

      cutoff = config.foundingSupporterCutoff || cutoff;

      client = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );

      const session = await currentSession();
      if (!session) {
        window.location.replace("account.html");
        return;
      }

      await loadProfile(session);

      $("signout").addEventListener("click", async () => {
        await client.auth.signOut();
        window.location.replace("account.html");
      });

      $("founder-checkout").addEventListener("click", async () => {
        const activeSession = await currentSession();
        if (!activeSession) {
          window.location.replace("account.html");
          return;
        }

        $("founder-checkout").disabled = true;
        $("founder-checkout").textContent = "Opening secure PayPal checkout…";

        try {
          const data = await callFounderFunction("create-founder-order", activeSession);
          sessionStorage.setItem("pai_paypal_order_id", data.orderId || "");
          window.location.href = data.url;
        } catch (error) {
          status(error.message || String(error));
          $("founder-checkout").disabled = false;
          $("founder-checkout").textContent = "Become a Founding Supporter — $5";
        }
      });

      const params = new URLSearchParams(window.location.search);
      if (params.get("founder") === "paypal-return") {
        const orderId =
          params.get("token") ||
          sessionStorage.getItem("pai_paypal_order_id") ||
          "";

        if (!orderId) {
          status("PayPal returned without an order ID. No entitlement was changed.");
          return;
        }

        status("Confirming your PayPal payment…");

        try {
          await callFounderFunction("capture-founder-order", session, { orderId });
          sessionStorage.removeItem("pai_paypal_order_id");
          await loadProfile(session);
          status("Founding Supporter activated. Thank you for supporting PAI development.");
          history.replaceState({}, "", window.location.pathname);
        } catch (error) {
          status(error.message || String(error));
        }
      } else if (params.get("founder") === "cancelled") {
        status("Checkout cancelled. No payment was made.");
      }
    } catch (error) {
      status(error.message || String(error));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();