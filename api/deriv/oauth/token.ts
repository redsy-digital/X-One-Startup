const DERIV_TOKEN_ENDPOINT = "https://auth.deriv.com/oauth2/token";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { code, code_verifier } = req.body ?? {};
  const clientId = process.env.DERIV_CLIENT_ID;
  const redirectUri = "https://x-one-startup.vercel.app/oauth/callback";

  if (!clientId) {
    res.status(500).json({ error: "oauth_server_not_configured" });
    return;
  }
  if (!code || !code_verifier) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  try {
    const response = await fetch(DERIV_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: String(code),
        redirect_uri: redirectUri,
        code_verifier: String(code_verifier),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    res.status(response.status).json(payload);
  } catch (error: any) {
    res.status(502).json({
      error: "oauth_upstream_error",
      error_description: error?.message || "Falha ao contactar a Deriv.",
    });
  }
}
