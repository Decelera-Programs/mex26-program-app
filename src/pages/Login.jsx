import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { supabase, supabaseConfigError } from "../lib/supabaseClient";


export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isFirstAccess, setIsFirstAccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [pendingCreds, setPendingCreds] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!supabase) return () => {};
    let mounted = true;
    async function redirectIfAuthenticated() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) navigate("/home", { replace: true });
    }
    redirectIfAuthenticated();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  async function doRegister(creds) {
    setShowConsentModal(false);
    setLoading(true);

    try {
      const registerRes = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"}/auth/register-first-access`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: creds.email, password: creds.password }),
        },
      );
      const registerPayload = await registerRes.json().catch(() => ({}));

      if (registerRes.status === 409) {
        setLoading(false);
        setError(registerPayload.error || "Account already exists. Sign in instead.");
        return;
      }
      if (!registerRes.ok) {
        setLoading(false);
        setError(registerPayload.error || "Unable to create account.");
        return;
      }

      const { error: signInAfterRegister } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
      });

      setLoading(false);

      if (signInAfterRegister) {
        setError(signInAfterRegister.message || "Account created but sign-in failed. Try signing in.");
        setSuccessMessage("If you see an error above, use Sign in with the same password.");
        return;
      }

      navigate("/home", { replace: true });
    } catch (err) {
      setLoading(false);
      const detail = err instanceof Error ? err.message : "";
      setError(`Could not complete registration. Try again.${detail ? ` (${detail})` : ""}`);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();

    if (isFirstAccess) {
      if (password.length < 6) {
        setLoading(false);
        setError("Password must have at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setLoading(false);
        setError("Passwords do not match.");
        return;
      }
      setPendingCreds({ email: normalizedEmail, password });
      setLoading(false);
      setShowConsentModal(true);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message || "Unable to sign in");
      return;
    }

    const nextPath =
      location.state?.from && location.state.from !== "/login"
        ? location.state.from
        : "/home";
    navigate(nextPath, { replace: true });
  }

  return (
    <div
      className="min-h-dvh w-full flex items-center justify-center px-0 py-10"
      style={{ background: "#F2F8FA" }}
    >
      {showConsentModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(15, 23, 42, 0.45)",
          }}
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              background: "#FFFFFF",
              borderRadius: 20,
              border: "1px solid #EEF2F5",
              boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
              padding: "24px 22px",
              width: "100%",
              maxWidth: 370,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  color: "#6E7892",
                  margin: 0,
                }}
              >
                Consentimiento
              </p>
              <h2
                style={{
                  fontFamily: "Taviraj, serif",
                  fontWeight: 300,
                  fontSize: 24,
                  color: "#2D3852",
                  letterSpacing: "-0.02em",
                  margin: "4px 0 0",
                  lineHeight: 1.1,
                }}
              >
                Antes de continuar
              </h2>
            </div>

            <p
              style={{
                fontSize: 13,
                color: "#4A5568",
                lineHeight: 1.55,
                margin: 0,
                padding: "14px 16px",
                background: "#F8FAFC",
                borderRadius: 12,
                border: "1px solid #E8EDF2",
              }}
            >
              Consiento el tratamiento de mis datos personales por Sancus Capital SGEIC, S.A. para gestionar mi acceso a la aplicación del evento y facilitar el networking entre los asistentes registrados. Entiendo que los datos que incluya en mi perfil —nombre o alias, fotografía y enlace a LinkedIn— serán visibles para los demás asistentes y para el equipo organizador, y que la app puede mostrar mi presencia en el lugar del evento. Sé que este consentimiento es voluntario, que no afecta a mi participación en el evento, y que puedo revocarlo en cualquier momento contactando con el DPO en dpo@sancuscapital.es. He leído la Política de Privacidad.
            </p>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                style={{
                  marginTop: 2,
                  width: 16,
                  height: 16,
                  accentColor: "#2D3852",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 13, color: "#2D3852", lineHeight: 1.4 }}>
                He leído y acepto los términos y condiciones del tratamiento de mis datos personales.
              </span>
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowConsentModal(false)}
                style={{
                  flex: 1,
                  padding: "11px 16px",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#6E7892",
                  background: "#F2F8FA",
                  border: "1px solid #EEF2F5",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => doRegister(pendingCreds)}
                disabled={!consentChecked}
                style={{
                  flex: 2,
                  padding: "11px 16px",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#FFFFFF",
                  background: !consentChecked ? "#9BA8C0" : "#2D3852",
                  border: "none",
                  cursor: !consentChecked ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                }}
              >
                Confirmar y crear cuenta
              </button>
            </div>
          </Motion.div>
        </div>
      )}

      <div
        style={{ width: "calc(100% - 20px)", maxWidth: 370, display: "flex", flexDirection: "column", gap: 12 }}
        className="mx-auto"
      >
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
            México 2026
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
            {isFirstAccess ? "Sign up." : "Log in."}
          </h1>
          <p style={{ fontSize: 12, color: "#6E7892", marginTop: 6 }}>
            {isFirstAccess
              ? "First access — set a password for your registered email."
              : "Use the email address you registered with to log in."}
          </p>
        </Motion.div>

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

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                Password
              </span>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="app-input"
                  style={{ paddingRight: 40 }}
                  autoComplete={isFirstAccess ? "new-password" : "current-password"}
                  required
                  disabled={!supabase}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#6E7892",
                    display: "flex",
                    alignItems: "center",
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {isFirstAccess && (
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
                <div style={{ position: "relative" }}>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="app-input"
                    style={{ paddingRight: 40 }}
                    autoComplete="new-password"
                    required
                    disabled={!supabase}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: "#6E7892",
                      display: "flex",
                      alignItems: "center",
                    }}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            )}

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
            {successMessage && (
              <p
                style={{
                  fontSize: 12,
                  color: "#4EA72E",
                  background: "#F3FBF0",
                  border: "1px solid #C3E6B5",
                  borderRadius: 12,
                  padding: "8px 12px",
                  margin: 0,
                }}
              >
                {successMessage}
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
              {loading
                ? isFirstAccess
                  ? "Creating account..."
                  : "Logging in..."
                : isFirstAccess
                  ? "Create password"
                  : "Log in"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsFirstAccess((prev) => !prev);
              setError("");
              setSuccessMessage("");
              setPassword("");
              setConfirmPassword("");
            }}
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
            {isFirstAccess ? "Already have a password? Log in" : "Sign up"}
          </button>

          {!isFirstAccess && (
            <button
              type="button"
              onClick={() => navigate("/reset-password")}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px 20px",
                borderRadius: 14,
                fontSize: 12,
                fontWeight: 500,
                color: "#6E7892",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                opacity: 0.8,
              }}
            >
              Forgot your password?
            </button>
          )}
        </Motion.div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#6E7892", opacity: 0.7, margin: 0 }}>
          By continuing, you agree to our{" "}
          <a
            href="https://www.decelera.ventures/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#6E7892", textDecoration: "underline" }}
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
