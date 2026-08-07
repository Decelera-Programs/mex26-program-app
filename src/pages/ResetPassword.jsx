import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { supabase, supabaseConfigError, initialAuthSearch, initialAuthHash } from "../lib/supabaseClient";

export default function ResetPassword() {
  // "request" → send reset email | "recovery" → set new password | "done" → email sent
  const [mode, setMode] = useState("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const navigate = useNavigate();

  // Captured before this component mounts (and before Supabase may clear the URL)
  const hadRecoveryIndicator = useRef(
    initialAuthHash.includes("type=recovery") ||
    new URLSearchParams(initialAuthSearch).has("code")
  );

  useEffect(() => {
    if (!supabase) return () => {};

    // Primary: PASSWORD_RECOVERY event (Supabase fires this when the recovery link is processed)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("recovery");
        setError("");
        setSuccessMessage("");
      }
    });

    // Fallback A — implicit flow: #type=recovery in hash (before Supabase clears it)
    // Fallback B — PKCE flow: ?code=XXX in query params
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    if (hash.includes("type=recovery") || params.has("code")) {
      setMode("recovery");
      return () => subscription.unsubscribe();
    }

    // Fallback C — Supabase already processed and cleared the hash/code before this
    // component mounted. Only activate if there was a recovery indicator at page load.
    if (hadRecoveryIndicator.current) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) setMode("recovery");
      });
    }

    return () => subscription.unsubscribe();
  }, []);

  async function handleRequestReset(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${appUrl}/reset-password` },
    );

    setLoading(false);

    if (resetError) {
      setError(resetError.message || "Could not send reset email.");
      return;
    }

    setMode("done");
    setSuccessMessage(`We've sent a reset link to ${email.trim().toLowerCase()}. Check your inbox.`);
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must have at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (updateError) {
      setError(updateError.message || "Could not update password.");
      return;
    }

    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  const headerTitle =
    mode === "recovery" ? "New password." :
    mode === "done"     ? "Check your email." :
                          "Reset password.";

  const headerSubtitle =
    mode === "recovery" ? "Enter and confirm your new password." :
    mode === "done"     ? successMessage :
                          "Enter your email and we'll send you a reset link.";

  return (
    <div
      className="min-h-dvh w-full flex items-center justify-center px-0 py-10"
      style={{ background: "#F2F8FA" }}
    >
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370, display: "flex", flexDirection: "column", gap: 12 }} className="mx-auto">

        {/* Header card */}
        <Motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: "22px 22px 26px",
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.08)" }}
          />
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 500,
              color: "#6E7892",
              textTransform: "uppercase",
              opacity: 0.75,
              margin: 0,
            }}
          >
            Menorca 2026
          </p>
          <h1
            style={{
              fontFamily: "Taviraj, serif",
              fontWeight: 300,
              fontSize: 32,
              color: "#2D3852",
              letterSpacing: "-0.02em",
              margin: "4px 0 0",
              lineHeight: 1.1,
            }}
          >
            {headerTitle}
          </h1>
          <p style={{ fontSize: 12, color: "#6E7892", marginTop: 6 }}>
            {headerSubtitle}
          </p>
        </Motion.div>

        {/* Form card */}
        {mode !== "done" && (
          <Motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut", delay: 0.06 }}
            style={{
              background: "#FFFFFF",
              borderRadius: 20,
              border: "1px solid #EEF2F5",
              boxShadow: "0 8px 20px rgba(15,23,42,0.06)",
              padding: "22px 20px",
            }}
          >
            {!supabase && (
              <p
                style={{
                  fontSize: 12,
                  color: "#D9534F",
                  background: "#FFF5F5",
                  border: "1px solid #FECDCD",
                  borderRadius: 12,
                  padding: "8px 12px",
                  marginBottom: 14,
                }}
              >
                {supabaseConfigError}
              </p>
            )}

            {mode === "request" && (
              <form onSubmit={handleRequestReset} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "#6E7892",
                    }}
                  >
                    Email
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="app-input"
                    autoComplete="email"
                    required
                    disabled={!supabase}
                  />
                </label>

                {error && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#D9534F",
                      background: "#FFF5F5",
                      border: "1px solid #FECDCD",
                      borderRadius: 12,
                      padding: "8px 12px",
                      margin: 0,
                    }}
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !supabase}
                  style={{
                    background: "#2D3852",
                    color: "#FFFFFF",
                    borderRadius: 14,
                    fontSize: 14,
                    fontWeight: 600,
                    padding: "13px 20px",
                    border: "none",
                    cursor: loading || !supabase ? "not-allowed" : "pointer",
                    opacity: loading || !supabase ? 0.6 : 1,
                    marginTop: 2,
                  }}
                >
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>
            )}

            {mode === "recovery" && (
              <form onSubmit={handleUpdatePassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "#6E7892",
                    }}
                  >
                    New password
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="app-input"
                    autoComplete="new-password"
                    required
                    disabled={!supabase}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "#6E7892",
                    }}
                  >
                    Confirm password
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="app-input"
                    autoComplete="new-password"
                    required
                    disabled={!supabase}
                  />
                </label>

                {error && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#D9534F",
                      background: "#FFF5F5",
                      border: "1px solid #FECDCD",
                      borderRadius: 12,
                      padding: "8px 12px",
                      margin: 0,
                    }}
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !supabase}
                  style={{
                    background: "#2D3852",
                    color: "#FFFFFF",
                    borderRadius: 14,
                    fontSize: 14,
                    fontWeight: 600,
                    padding: "13px 20px",
                    border: "none",
                    cursor: loading || !supabase ? "not-allowed" : "pointer",
                    opacity: loading || !supabase ? 0.6 : 1,
                    marginTop: 2,
                  }}
                >
                  {loading ? "Updating..." : "Update password"}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "12px 20px",
                borderRadius: 14,
                fontSize: 13,
                fontWeight: 500,
                color: "#6E7892",
                background: "#F2F8FA",
                border: "1px solid #EEF2F5",
                cursor: "pointer",
              }}
            >
              Back to log in
            </button>
          </Motion.div>
        )}

        {/* Done state — just back to login */}
        {mode === "done" && (
          <Motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut", delay: 0.06 }}
            style={{
              background: "#FFFFFF",
              borderRadius: 20,
              border: "1px solid #EEF2F5",
              boxShadow: "0 8px 20px rgba(15,23,42,0.06)",
              padding: "22px 20px",
            }}
          >
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                width: "100%",
                padding: "13px 20px",
                borderRadius: 14,
                fontSize: 14,
                fontWeight: 600,
                color: "#FFFFFF",
                background: "#2D3852",
                border: "none",
                cursor: "pointer",
              }}
            >
              Back to log in
            </button>
          </Motion.div>
        )}

      </div>
    </div>
  );
}
