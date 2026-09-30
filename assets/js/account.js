(() => {
  let client = null;
  let mode = "signin";
  let cutoff = "2027-01-02T00:00:00Z";
  let config = null;

  const $ = id => document.getElementById(id);
  const status = message => {
    if ($("auth-status")) $("auth-status").textContent = message || "";
    if ($("account-status")) $("account-status").textContent = message || "";
  };

  function showSignedOut() {
    $("signed-out-view").hidden = false;
    $("signed-in-view").hidden = true;
    $("account-hero-title").textContent = "Sign in to PAI.";
    $("account-hero-copy").textContent = "Your PAI account keeps your access, plan, and Founding Supporter status connected across the website and desktop app.";
  }

  function showSignedIn(session) {
    $("signed-out-view").hidden = true;
    $("signed-in-view").hidden = false;
    $("account-hero-title").textContent = "Your PAI account.";
    $("account-hero-copy").textContent = "Manage your access, membership status, and Founding Supporter benefits.";
    $("account-email").textContent = session.user.email || "";
    $("detail-email").textContent = session.user.email || "—";
  }

  function setMode(next) {
    mode = next;
    $("auth-submit").textContent = next === "signin" ? "Sign in" : "Create account";
    $("signin-tab").classList.toggle("primary", next === "signin");
    $("signup-tab").classList.toggle("primary", next === "signup");
    $("password").autocomplete = next === "signin" ? "current-password" : "new-password";
    status("");
  }

  async function loadProfile(session, retries = 0) {
    if (!session?.user) {
      showSignedOut();
      $("founder-checkout").hidden = true;
      return;
    }

    showSignedIn(session);

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

    $("detail-plan").textContent = plan;
    $("detail-founder").textContent = founder ? "Permanent" : "Not active";
    $("detail-usage").textContent = plan === "Pro" ? "Highest" : (founder ? "Higher" : "Standard");
    $("account-badge").textContent = founder ? "FOUNDING SUPPORTER" : plan.toUpperCase();

    const founderCard = $("founder-card");
    const founderCopy = $("founder-copy");
    const entitlements = $("entitlements");

    if (founder) {
      founderCard.classList.add("is-founder");
      founderCopy.textContent = "Your Founding Supporter status is permanently attached to this PAI account. Thank you for supporting PAI during active development.";
      entitlements.innerHTML = [
        "<span>Permanent Founding Supporter recognition</span>",
        "<span>Higher usage limits than Free</span>",
        "<span>Advanced features and early previews</span>",
        "<span>Priority feedback and testing access</span>"
      ].join("");
    } else {
      founderCard.classList.remove("is-founder");
      founderCopy.textContent = "A one-time $5 contribution directly supports continued PAI development and permanently adds Founding Supporter status to your account.";
      entitlements.innerHTML = [
        "<span>Permanent Founding Supporter recognition</span>",
        "<span>Higher usage limits than Free</span>",
        "<span>Advanced features and early previews</span>",
        "<span>Priority feedback and testing access</span>"
      ].join("");
    }

    const offerOpen = Date.now() < Date.parse(cutoff);
    $("founder-checkout").hidden = founder || !offerOpen;

    if (!offerOpen && !founder) {
      founderCopy.textContent = "The Founding Supporter offer has ended.";
    }
  }

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

  async function init() {
    try {
      const cfgRes = await fetch("account-config.json", { cache: "no-store" });
      if (!cfgRes.ok) {
        throw new Error("PAI account configuration is not available.");
      }

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

      $("signin-tab").addEventListener("click", () => setMode("signin"));
      $("signup-tab").addEventListener("click", () => setMode("signup"));

      $("auth-form").addEventListener("submit", async event => {
        event.preventDefault();

        const email = $("email").value.trim();
        const password = $("password").value;
        status(mode === "signin" ? "Signing in…" : "Creating account…");

        if (mode === "signin") {
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) {
            status(error.message);
            return;
          }

          status("Signed in.");
          await loadProfile(data.session);
          return;
        }

        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: config.accountUrl || window.location.origin + "/account.html"
          }
        });

        if (error) {
          status(error.message);
          return;
        }

        if (!data.session) {
          status("Account created. Check your email to confirm it, then sign in.");
        } else {
          status("Account created and signed in.");
          await loadProfile(data.session);
        }
      });

      $("signout").addEventListener("click", async () => {
        await client.auth.signOut();
        status("Signed out.");
        await loadProfile(null);
      });

      $("founder-checkout").addEventListener("click", async () => {
        const session = await currentSession();
        if (!session) {
          status("Sign in before purchasing Founding Supporter.");
          return;
        }

        $("founder-checkout").disabled = true;
        $("founder-checkout").textContent = "Opening secure PayPal checkout…";

        try {
          const data = await callFounderFunction("create-founder-order", session);
          sessionStorage.setItem("pai_paypal_order_id", data.orderId || "");
          window.location.href = data.url;
        } catch (error) {
          status(error.message || String(error));
          $("founder-checkout").disabled = false;
          $("founder-checkout").textContent = "Become a Founding Supporter — $5";
        }
      });

      client.auth.onAuthStateChange((_event, session) => {
        loadProfile(session);
      });

      const session = await currentSession();
      await loadProfile(session);

      const params = new URLSearchParams(window.location.search);

      if (params.get("founder") === "paypal-return") {
        if (!session) {
          status("Sign in again to finish confirming your PayPal payment.");
          return;
        }

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
      $("auth-submit").disabled = true;
      $("founder-checkout").hidden = true;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
