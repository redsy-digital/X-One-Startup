export interface DerivAccount {
  account_id: string;
  token: string;
  currency: string;
  is_demo: boolean;
}

/**
 * Builds the Deriv OAuth authorization URL.
 */
export const buildDerivOAuthUrl = (): string => {
  const appId = import.meta.env.VITE_DERIV_APP_ID;
  return `https://oauth.deriv.com/oauth2/authorize?app_id=${appId}&l=EN&brand=deriv`;
};

/**
 * Parses all accounts returned by Deriv OAuth callback from the URL.
 * Deriv returns: ?acct1=CR...&token1=...&cur1=USD&acct2=VRTC...&token2=...&cur2=USD
 */
export const parseDerivOAuthCallback = (): DerivAccount[] => {
  const params = new URLSearchParams(window.location.search);
  const accounts: DerivAccount[] = [];

  let i = 1;
  while (params.has(`acct${i}`)) {
    const account_id = params.get(`acct${i}`) || "";
    const token = params.get(`token${i}`) || "";
    const currency = params.get(`cur${i}`) || "USD";
    // Deriv virtual accounts start with VRTC
    const is_demo = account_id.toUpperCase().startsWith("VRT");

    if (account_id && token) {
      accounts.push({ account_id, token, currency, is_demo });
    }
    i++;
  }

  return accounts;
};

/**
 * Checks if the current URL contains a Deriv OAuth callback.
 */
export const hasDerivOAuthCallback = (): boolean => {
  return new URLSearchParams(window.location.search).has("acct1");
};

/**
 * Removes OAuth params from URL without reloading the page.
 */
export const clearOAuthParams = (): void => {
  const url = new URL(window.location.href);
  // Remove all possible acct/token/cur params (Deriv supports up to ~5 accounts)
  for (let i = 1; i <= 5; i++) {
    url.searchParams.delete(`acct${i}`);
    url.searchParams.delete(`token${i}`);
    url.searchParams.delete(`cur${i}`);
  }
  window.history.replaceState({}, "", url.toString());
};
