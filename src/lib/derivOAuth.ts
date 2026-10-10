export interface DerivAccount {
  account_id: string;
  token: string;
  currency: string;
  is_demo: boolean;
}

const DERIV_AUTH_BASE = "https://auth.deriv.com/oauth2";
const DERIV_CLIENT_ID = "34uMDWSkya9WpNmWIIuZY";
const DERIV_REDIRECT_URI = "https://x-one-new.vercel.app/oauth/callback";
const DERIV_SCOPE = "trade";

const randomBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomString = (length = 64): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return randomBase64Url(bytes).slice(0, length);
};

const sha256Base64Url = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return randomBase64Url(new Uint8Array(digest));
};

/** Starts the current Deriv OAuth 2.0 Authorization Code + PKCE flow. */
export const buildDerivOAuthUrl = async (): Promise<string> => {
  const state = randomString(48);
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  sessionStorage.setItem("xone_deriv_oauth_state", state);
  sessionStorage.setItem("xone_deriv_oauth_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_CLIENT_ID,
    redirect_uri: DERIV_REDIRECT_URI,
    scope: DERIV_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${DERIV_AUTH_BASE}/auth?${params.toString()}`;
};

export const getDerivOAuthRedirectUri = (): string => DERIV_REDIRECT_URI;

export const getStoredOAuthState = (): string | null =>
  sessionStorage.getItem("xone_deriv_oauth_state");

export const getStoredCodeVerifier = (): string | null =>
  sessionStorage.getItem("xone_deriv_oauth_code_verifier");

export const clearDerivOAuthState = (): void => {
  sessionStorage.removeItem("xone_deriv_oauth_state");
  sessionStorage.removeItem("xone_deriv_oauth_code_verifier");
};

export const saveDerivOAuthSession = (accessToken: string, accounts: DerivAccount[], activeAccount: DerivAccount): void => {
  sessionStorage.setItem("xone_deriv_oauth_access_token", accessToken);
  sessionStorage.setItem("xone_deriv_oauth_accounts", JSON.stringify(accounts));
  sessionStorage.setItem("xone_deriv_oauth_active_account", JSON.stringify(activeAccount));
};

export const loadDerivOAuthSession = (): {
  accessToken: string;
  accounts: DerivAccount[];
  activeAccount: DerivAccount | null;
} | null => {
  const accessToken = sessionStorage.getItem("xone_deriv_oauth_access_token");
  if (!accessToken) return null;
  try {
    const accounts = JSON.parse(sessionStorage.getItem("xone_deriv_oauth_accounts") || "[]") as DerivAccount[];
    const activeAccount = JSON.parse(sessionStorage.getItem("xone_deriv_oauth_active_account") || "null") as DerivAccount | null;
    return { accessToken, accounts, activeAccount };
  } catch {
    clearDerivOAuthSession();
    return null;
  }
};

export const clearDerivOAuthSession = (): void => {
  sessionStorage.removeItem("xone_deriv_oauth_access_token");
  sessionStorage.removeItem("xone_deriv_oauth_accounts");
  sessionStorage.removeItem("xone_deriv_oauth_active_account");
};

export const exchangeDerivOAuthCode = async (code: string, codeVerifier: string): Promise<string> => {
  const response = await fetch("/api/deriv/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Não foi possível obter o token OAuth da Deriv.");
  }
  return String(payload.access_token);
};
