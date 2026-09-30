(() => {
  let client = null;
  let mode = "signin";
  let config = null;

  const $ = id => document.getElementById(id);
  const status = message => {
    if ($("auth-status")) $("auth-status").textContent = message || "";
  };

  function dashboardUrl() {
    return "account-dashboard.html" + window.location.search + window.location.hash;
  }

  function setMode(next) {
    mode = next;
    $("auth-submit").textContent = next === "signin" ? "Sign in" : "Create account";
    $("signin-tab").classList.toggle("primary", next === "signin");
    $("signup-tab").classList.toggle("primary", next === "signup");
    $("password").autocomplete = next === "signin" ? "current-password" : "new-password";
    status("");
  }

  async function init() {
    try {
      const cfgRes = await fetch("account-config.json", { cache: "no-store" });
      if (!cfgRes.ok) throw new Error("PAI account configuration is not available.");
      config = await cfgRes.json();

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error("PAI account configuration is incomplete.");
      }

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

      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session) {
        window.location.replace(dashboardUrl());
        return;
      }

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

          if (data.session) {
            window.location.replace(dashboardUrl());
            return;
          }

          status("Could not start a PAI session.");
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
          window.location.replace(dashboardUrl());
        }
      });

      client.auth.onAuthStateChange((_event, session) => {
        if (session) window.location.replace(dashboardUrl());
      });
    } catch (error) {
      status(error.message || String(error));
      $("auth-submit").disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();