(() => {
  let client = null;
  let mode = "signin";
  let cutoff = "2027-01-02T00:00:00Z";

  const $ = id => document.getElementById(id);
  const status = message => { if ($("auth-status")) $("auth-status").textContent = message || ""; };

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
      $("account-title").textContent = "Not signed in";
      $("account-email").textContent = "Sign in to view your PAI access.";
      $("entitlements").innerHTML = "<span>Free access</span>";
      $("founder-checkout").hidden = true;
      $("signout").hidden = true;
      return;
    }

    $("account-title").textContent = "PAI Account";
    $("account-email").textContent = session.user.email || "";
    $("signout").hidden = false;

    const { data, error } = await client
      .from("profiles")
      .select("plan,founding_supporter,founding_supporter_purchased_at")
      .eq("id", session.user.id)
      .single();

    if (error && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 900));
      return loadProfile(session, retries + 1);
    }

    const plan = data?.plan === "pro" ? "Pro" : "Free";
    const founder = Boolean(data?.founding_supporter);
    const rows = [
      `<span>Plan: ${plan}</span>`,
      founder ? "<span>Founding Supporter: permanent</span>" : "<span>Founding Supporter: not active</span>"
    ];
    $("entitlements").innerHTML = rows.join("");

    const offerOpen = Date.now() < Date.parse(cutoff);
    $("founder-checkout").hidden = founder || !offerOpen;
    if (!offerOpen && !founder) {
      $("entitlements").insertAdjacentHTML("beforeend", "<span>Founding Supporter offer ended</span>");
    }
  }

  async function session() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function init() {
    try {
      const cfgRes = await fetch("/api/public-config", { cache: "no-store" });
      const cfg = await cfgRes.json();
      if (!cfgRes.ok) throw new Error(cfg.error || "Account service unavailable.");
      cutoff = cfg.foundingSupporterCutoff || cutoff;
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      $("signin-tab").addEventListener("click", () => setMode("signin"));
      $("signup-tab").addEventListener("click", () => setMode("signup"));

      $("auth-form").addEventListener("submit", async event => {
        event.preventDefault();
        const email = $("email").value.trim();
        const password = $("password").value;
        status(mode === "signin" ? "Signing in…" : "Creating account…");

        if (mode === "signin") {
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) return status(error.message);
          status("Signed in.");
          await loadProfile(data.session);
        } else {
          const { data, error } = await client.auth.signUp({ email, password });
          if (error) return status(error.message);
          if (!data.session) {
            status("Account created. Check your email to confirm it, then sign in.");
          } else {
            status("Account created and signed in.");
            await loadProfile(data.session);
          }
        }
      });

      $("signout").addEventListener("click", async () => {
        await client.auth.signOut();
        status("Signed out.");
        await loadProfile(null);
      });

      $("founder-checkout").addEventListener("click", async () => {
        const current = await session();
        if (!current) return status("Sign in before purchasing Founding Supporter.");
        $("founder-checkout").disabled = true;
        $("founder-checkout").textContent = "Opening secure checkout…";
        try {
          const response = await fetch("/api/create-founder-order", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${current.access_token}`,
              "Content-Type": "application/json"
            },
            body: "{}"
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not start checkout.");
          sessionStorage.setItem("pai_paypal_order_id", data.orderId || "");\n          window.location.href = data.url;
        } catch (error) {
          status(error.message || String(error));
          $("founder-checkout").disabled = false;
          $("founder-checkout").textContent = "Become a Founding Supporter — $5";
        }
      });

      client.auth.onAuthStateChange((_event, nextSession) => loadProfile(nextSession));

      const current = await session();
      await loadProfile(current);

      const params = new URLSearchParams(location.search);
      if (params.get("founder") === "paypal-return") {
        if (!current) {
          status("Sign in again to finish confirming your PayPal payment.");
        } else {
          const orderId = params.get("token") || sessionStorage.getItem("pai_paypal_order_id") || "";
          if (!orderId) {
            status("PayPal returned without an order ID. No entitlement was changed.");
          } else {
            status("Confirming your PayPal payment…");
            try {
              const captureRes = await fetch("/api/capture-founder-order", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${current.access_token}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ orderId })
              });
              const capture = await captureRes.json();
              if (!captureRes.ok) throw new Error(capture.error || "Could not confirm PayPal payment.");
              sessionStorage.removeItem("pai_paypal_order_id");
              await loadProfile(current);
              status("Founding Supporter activated. Thank you for supporting PAI development.");
              history.replaceState({}, "", location.pathname);
            } catch (error) {
              status(error.message || String(error));
            }
          }
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