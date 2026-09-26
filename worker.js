/**
 * ============================================================
 * OV REAL ESTATE CRM — CLOUDFLARE WORKER
 * Version: 0.2.0-auth-read
 * ============================================================
 *
 * Incluye:
 * - Google Sign-In
 * - Verificación real del ID token con JWKS de Google
 * - Sesión firmada HttpOnly
 * - /api/me
 * - /api/leads
 * - /api/leads/:crm_lead_id
 * - Proxy seguro a Apps Script
 *
 * TODAVÍA NO ESCRIBE EN EL CRM.
 */

const APP_VERSION = "0.2.0-auth-read";

const SESSION_COOKIE = "ov_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/oauth2/v3/certs";

let googleJwksCache = {
  keys: null,
  expiresAt: 0
};


export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error("Worker error:", error);

      const status =
        Number(error?.status) || 500;

      const message =
        error?.publicMessage ||
        "Ocurrió un error interno.";

      return jsonResponse(
        {
          ok: false,
          error: message
        },
        status
      );
    }
  }
};


/**
 * ============================================================
 * ROUTER
 * ============================================================
 */

async function routeRequest(request, env) {
  const url =
    new URL(request.url);

  const method =
    request.method.toUpperCase();


  /**
   * HEALTH CHECK
   */

  if (
    url.pathname === "/health" &&
    method === "GET"
  ) {
    return jsonResponse({
      ok: true,
      service: "OV CRM Worker",
      version: APP_VERSION
    });
  }


  /**
   * GOOGLE LOGIN
   */

  if (
    url.pathname === "/auth/google" &&
    method === "POST"
  ) {
    return handleGoogleLogin(
      request,
      env
    );
  }


  /**
   * LOGOUT
   */

  if (
    url.pathname === "/auth/logout" &&
    method === "POST"
  ) {
    requireSameOrigin(request);

    return jsonResponse(
      {
        ok: true
      },
      200,
      {
        "Set-Cookie":
          clearSessionCookie()
      }
    );
  }


  /**
   * API ME
   */

  if (
    url.pathname === "/api/me" &&
    method === "GET"
  ) {
    const session =
      await requireSession(
        request,
        env
      );

    const upstream =
      await callAppsScript(
        env,
        session.email,
        {
          action: "me"
        }
      );

    return jsonResponse({
      ok: true,
      data: upstream.data
    });
  }


  /**
   * API LEADS LIST
   */

  if (
    url.pathname === "/api/leads" &&
    method === "GET"
  ) {
    const session =
      await requireSession(
        request,
        env
      );

    const upstream =
      await callAppsScript(
        env,
        session.email,
        {
          action: "leads.list",

          search:
            url.searchParams.get(
              "search"
            ) || "",

          etapa:
            url.searchParams.get(
              "etapa"
            ) || "",

          proyecto:
            url.searchParams.get(
              "proyecto"
            ) || "",

          limit:
            safeInteger(
              url.searchParams.get(
                "limit"
              ),
              100
            ),

          offset:
            safeInteger(
              url.searchParams.get(
                "offset"
              ),
              0
            )
        }
      );

    return jsonResponse({
      ok: true,
      data: upstream.data
    });
  }


  /**
   * API LEAD DETAIL
   */

  if (
    url.pathname.startsWith(
      "/api/leads/"
    ) &&
    method === "GET"
  ) {
    const session =
      await requireSession(
        request,
        env
      );

    const crmLeadId =
      decodeURIComponent(
        url.pathname.substring(
          "/api/leads/".length
        )
      ).trim();


    if (!crmLeadId) {
      throw publicError(
        400,
        "Falta crm_lead_id."
      );
    }


    const upstream =
      await callAppsScript(
        env,
        session.email,
        {
          action: "leads.get",
          crm_lead_id: crmLeadId
        }
      );


    return jsonResponse({
      ok: true,
      data: upstream.data
    });
  }


  /**
   * HOME
   */

  if (
    url.pathname === "/" &&
    method === "GET"
  ) {
    const session =
      await readSession(
        request,
        env
      );


    if (!session) {
      return htmlResponse(
        renderLoginPage(
          env.GOOGLE_CLIENT_ID
        )
      );
    }


    return htmlResponse(
      renderAppPage()
    );
  }


  throw publicError(
    404,
    "Not found"
  );
}


/**
 * ============================================================
 * GOOGLE LOGIN
 * ============================================================
 */

async function handleGoogleLogin(
  request,
  env
) {
  requireSameOrigin(
    request
  );


  requireEnvironment(
    env
  );


  let body;

  try {
    body =
      await request.json();

  } catch {
    throw publicError(
      400,
      "Solicitud inválida."
    );
  }


  const credential =
    String(
      body?.credential || ""
    ).trim();


  if (!credential) {
    throw publicError(
      400,
      "Falta la credencial de Google."
    );
  }


  /**
   * Verificación criptográfica.
   */

  const googleUser =
    await verifyGoogleIdToken(
      credential,
      env.GOOGLE_CLIENT_ID
    );


  /**
   * Además de ser una cuenta Google válida,
   * debe existir como usuario activo
   * en el Sheet Usuarios.
   */

  const upstream =
    await callAppsScript(
      env,
      googleUser.email,
      {
        action: "me"
      }
    );


  const usuario =
    upstream?.data?.usuario;


  if (
    !usuario ||
    usuario.activo !== true
  ) {
    throw publicError(
      403,
      "Usuario no autorizado."
    );
  }


  /**
   * La sesión NO confía permanentemente
   * en el rol.
   *
   * Guardamos identidad mínima.
   * Apps Script revalida usuario/rol
   * en cada llamada API.
   */

  const now =
    Math.floor(
      Date.now() / 1000
    );


  const sessionPayload = {
    v: 1,

    sub:
      googleUser.sub,

    email:
      googleUser.email
        .toLowerCase(),

    iat:
      now,

    exp:
      now +
      SESSION_TTL_SECONDS
  };


  const token =
    await createSessionToken(
      sessionPayload,
      env.OV_SESSION_SECRET
    );


  return jsonResponse(
    {
      ok: true,

      user: {
        nombre:
          usuario.nombre || "",

        correo:
          usuario.correo,

        rol:
          usuario.rol
      }
    },
    200,
    {
      "Set-Cookie":
        makeSessionCookie(
          token
        )
    }
  );
}


/**
 * ============================================================
 * VERIFY GOOGLE ID TOKEN
 * ============================================================
 */

async function verifyGoogleIdToken(
  token,
  clientId
) {
  const parts =
    token.split(".");


  if (
    parts.length !== 3
  ) {
    throw publicError(
      401,
      "Credencial de Google inválida."
    );
  }


  let header;
  let payload;


  try {
    header =
      JSON.parse(
        decodeBase64UrlText(
          parts[0]
        )
      );


    payload =
      JSON.parse(
        decodeBase64UrlText(
          parts[1]
        )
      );

  } catch {
    throw publicError(
      401,
      "Credencial de Google inválida."
    );
  }


  if (
    header.alg !== "RS256" ||
    !header.kid
  ) {
    throw publicError(
      401,
      "Firma de Google inválida."
    );
  }


  let jwk =
    await getGoogleJwk(
      header.kid,
      false
    );


  /**
   * Si Google rotó llaves,
   * refrescamos una vez.
   */

  if (!jwk) {
    jwk =
      await getGoogleJwk(
        header.kid,
        true
      );
  }


  if (!jwk) {
    throw publicError(
      401,
      "No se pudo validar la firma de Google."
    );
  }


  const publicKey =
    await crypto.subtle.importKey(
      "jwk",

      jwk,

      {
        name:
          "RSASSA-PKCS1-v1_5",

        hash:
          "SHA-256"
      },

      false,

      [
        "verify"
      ]
    );


  const signingInput =
    new TextEncoder().encode(
      parts[0] +
      "." +
      parts[1]
    );


  const signature =
    base64UrlToBytes(
      parts[2]
    );


  const validSignature =
    await crypto.subtle.verify(
      {
        name:
          "RSASSA-PKCS1-v1_5"
      },

      publicKey,

      signature,

      signingInput
    );


  if (!validSignature) {
    throw publicError(
      401,
      "Firma de Google inválida."
    );
  }


  const now =
    Math.floor(
      Date.now() / 1000
    );


  /**
   * Audience
   */

  const audienceOk =
    Array.isArray(
      payload.aud
    )
      ? payload.aud.includes(
          clientId
        )
      : payload.aud ===
          clientId;


  if (!audienceOk) {
    throw publicError(
      401,
      "Credencial emitida para otra aplicación."
    );
  }


  /**
   * Issuer
   */

  if (
    payload.iss !==
      "accounts.google.com" &&
    payload.iss !==
      "https://accounts.google.com"
  ) {
    throw publicError(
      401,
      "Emisor de Google inválido."
    );
  }


  /**
   * Expiration
   */

  if (
    !payload.exp ||
    Number(
      payload.exp
    ) <= now
  ) {
    throw publicError(
      401,
      "La credencial de Google expiró."
    );
  }


  /**
   * Not-before
   */

  if (
    payload.nbf &&
    Number(
      payload.nbf
    ) >
      now + 60
  ) {
    throw publicError(
      401,
      "La credencial de Google aún no es válida."
    );
  }


  /**
   * Evitar tokens con fecha de emisión
   * anormalmente futura.
   */

  if (
    payload.iat &&
    Number(
      payload.iat
    ) >
      now + 300
  ) {
    throw publicError(
      401,
      "Fecha de credencial inválida."
    );
  }


  if (
    !payload.sub ||
    !payload.email
  ) {
    throw publicError(
      401,
      "La cuenta Google no contiene identidad válida."
    );
  }


  const verified =
    payload.email_verified === true ||
    String(
      payload.email_verified
    ).toLowerCase() ===
      "true";


  if (!verified) {
    throw publicError(
      401,
      "El correo de Google no está verificado."
    );
  }


  return {
    sub:
      String(
        payload.sub
      ),

    email:
      String(
        payload.email
      )
        .trim()
        .toLowerCase(),

    name:
      String(
        payload.name || ""
      ),

    picture:
      String(
        payload.picture || ""
      )
  };
}


/**
 * ============================================================
 * GOOGLE JWKS
 * ============================================================
 */

async function getGoogleJwk(
  kid,
  forceRefresh
) {
  const now =
    Date.now();


  if (
    !forceRefresh &&
    googleJwksCache.keys &&
    now <
      googleJwksCache.expiresAt
  ) {
    return (
      googleJwksCache.keys.find(
        key =>
          key.kid === kid
      ) || null
    );
  }


  const response =
    await fetch(
      GOOGLE_JWKS_URL,
      {
        headers: {
          Accept:
            "application/json"
        }
      }
    );


  if (!response.ok) {
    throw publicError(
      503,
      "No se pudieron validar las credenciales de Google."
    );
  }


  const data =
    await response.json();


  const keys =
    Array.isArray(
      data.keys
    )
      ? data.keys
      : [];


  const maxAge =
    parseMaxAge(
      response.headers.get(
        "Cache-Control"
      )
    );


  googleJwksCache = {
    keys,

    expiresAt:
      now +
      maxAge * 1000
  };


  return (
    keys.find(
      key =>
        key.kid === kid
    ) || null
  );
}


function parseMaxAge(
  cacheControl
) {
  const text =
    String(
      cacheControl || ""
    );


  const match =
    text.match(
      /max-age=(\d+)/i
    );


  if (!match) {
    return 3600;
  }


  const seconds =
    Number(
      match[1]
    );


  return Number.isFinite(
    seconds
  )
    ? Math.max(
        60,
        seconds
      )
    : 3600;
}


/**
 * ============================================================
 * SESSION
 * ============================================================
 */

async function createSessionToken(
  payload,
  secret
) {
  const body =
    bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify(
          payload
        )
      )
    );


  const signature =
    await signHmac(
      body,
      secret
    );


  return (
    body +
    "." +
    bytesToBase64Url(
      signature
    )
  );
}


async function readSession(
  request,
  env
) {
  const cookie =
    request.headers.get(
      "Cookie"
    ) || "";


  const token =
    getCookieValue(
      cookie,
      SESSION_COOKIE
    );


  if (!token) {
    return null;
  }


  const parts =
    token.split(".");


  if (
    parts.length !== 2
  ) {
    return null;
  }


  try {
    const valid =
      await verifyHmac(
        parts[0],
        base64UrlToBytes(
          parts[1]
        ),
        env.OV_SESSION_SECRET
      );


    if (!valid) {
      return null;
    }


    const payload =
      JSON.parse(
        new TextDecoder().decode(
          base64UrlToBytes(
            parts[0]
          )
        )
      );


    const now =
      Math.floor(
        Date.now() / 1000
      );


    if (
      payload.v !== 1 ||
      !payload.email ||
      !payload.sub ||
      !payload.exp ||
      Number(
        payload.exp
      ) <= now
    ) {
      return null;
    }


    return payload;

  } catch {
    return null;
  }
}


async function requireSession(
  request,
  env
) {
  const session =
    await readSession(
      request,
      env
    );


  if (!session) {
    throw publicError(
      401,
      "Sesión no válida o expirada."
    );
  }


  return session;
}


async function signHmac(
  text,
  secret
) {
  const key =
    await getHmacKey(
      secret,
      [
        "sign"
      ]
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",

      key,

      new TextEncoder().encode(
        text
      )
    );


  return new Uint8Array(
    signature
  );
}


async function verifyHmac(
  text,
  signature,
  secret
) {
  const key =
    await getHmacKey(
      secret,
      [
        "verify"
      ]
    );


  return crypto.subtle.verify(
    "HMAC",

    key,

    signature,

    new TextEncoder().encode(
      text
    )
  );
}


async function getHmacKey(
  secret,
  usages
) {
  if (
    !secret ||
    String(secret).length < 32
  ) {
    throw new Error(
      "OV_SESSION_SECRET inválido."
    );
  }


  return crypto.subtle.importKey(
    "raw",

    new TextEncoder().encode(
      String(secret)
    ),

    {
      name: "HMAC",
      hash: "SHA-256"
    },

    false,

    usages
  );
}


function makeSessionCookie(
  token
) {
  return (
    SESSION_COOKIE +
    "=" +
    token +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Lax" +
    "; Max-Age=" +
    SESSION_TTL_SECONDS
  );
}


function clearSessionCookie() {
  return (
    SESSION_COOKIE +
    "=; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Lax" +
    "; Max-Age=0"
  );
}


/**
 * ============================================================
 * APPS SCRIPT BRIDGE
 * ============================================================
 */

async function callAppsScript(
  env,
  email,
  payload
) {
  requireEnvironment(
    env
  );


  const response =
    await fetch(
      env.OV_APPS_SCRIPT_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            ...payload,

            user_email:
              String(
                email
              )
                .trim()
                .toLowerCase(),

            server_secret:
              env.OV_API_SHARED_SECRET
          }),

        redirect:
          "follow"
      }
    );


  const raw =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(
        raw
      );

  } catch {
    throw publicError(
      502,
      "Apps Script devolvió una respuesta inválida."
    );
  }


  if (!data.ok) {
    const upstreamStatus =
      Number(
        data?.error?.status
      );


    const status =
      Number.isFinite(
        upstreamStatus
      ) &&
      upstreamStatus >= 400 &&
      upstreamStatus < 600
        ? upstreamStatus
        : 502;


    throw publicError(
      status,

      data?.error?.message ||
      "Apps Script rechazó la solicitud."
    );
  }


  return data;
}


/**
 * ============================================================
 * LOGIN PAGE
 * ============================================================
 */

function renderLoginPage(
  clientId
) {
  const clientIdJson =
    JSON.stringify(
      String(
        clientId || ""
      )
    );


  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >

  <title>OV Real Estate CRM</title>

  <script
    src="https://accounts.google.com/gsi/client"
    async
    defer
  ></script>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0b0b0b;
      color: #fff;
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    .card {
      width: min(92vw, 420px);
      padding: 40px 32px;
      background: #151515;
      border: 1px solid #292929;
      border-radius: 20px;
    }

    .brand {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }

    .subtitle {
      color: #aaa;
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 30px;
    }

    #googleButton {
      min-height: 44px;
    }

    #error {
      display: none;
      margin-top: 18px;
      padding: 12px;
      border-radius: 10px;
      background: #351414;
      color: #ffb1b1;
      font-size: 14px;
      line-height: 1.4;
    }
  </style>
</head>

<body>

  <main class="card">
    <div class="brand">
      OV Real Estate
    </div>

    <div class="subtitle">
      CRM · Acceso privado
    </div>

    <div id="googleButton"></div>

    <div id="error"></div>
  </main>


  <script>
    const CLIENT_ID =
      ${clientIdJson};


    function showError(message) {
      const el =
        document.getElementById(
          "error"
        );

      el.textContent =
        message;

      el.style.display =
        "block";
    }


    async function handleCredentialResponse(
      response
    ) {
      try {
        const result =
          await fetch(
            "/auth/google",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  credential:
                    response.credential
                })
            }
          );


        const data =
          await result.json();


        if (!data.ok) {
          showError(
            data.error ||
            "No se pudo iniciar sesión."
          );

          return;
        }


        window.location.href =
          "/";

      } catch (error) {
        showError(
          "No se pudo conectar con el servidor."
        );
      }
    }


    window.addEventListener(
      "load",
      function() {

        if (
          !window.google ||
          !google.accounts
        ) {
          showError(
            "No se pudo cargar Google Sign-In."
          );

          return;
        }


        google.accounts.id.initialize({
          client_id:
            CLIENT_ID,

          callback:
            handleCredentialResponse,

          ux_mode:
            "popup",

          auto_select:
            false
        });


        google.accounts.id.renderButton(
          document.getElementById(
            "googleButton"
          ),

          {
            theme:
              "outline",

            size:
              "large",

            text:
              "signin_with",

            shape:
              "rectangular",

            width:
              350
          }
        );
      }
    );
  </script>

</body>
</html>`;
}


/**
 * ============================================================
 * TEMPORARY READ-ONLY APP PAGE
 * ============================================================
 *
 * Esta NO es todavía la interfaz final.
 * Sirve para comprobar autenticación,
 * sesión y lectura real.
 */

function renderAppPage() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >

  <title>OV Real Estate CRM</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #f5f5f5;
      color: #111;
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    header {
      background: #0b0b0b;
      color: #fff;
      padding: 18px 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }

    .brand {
      font-weight: 700;
      font-size: 19px;
    }

    button {
      font: inherit;
      cursor: pointer;
    }

    .logout {
      background: transparent;
      color: #fff;
      border: 1px solid #555;
      border-radius: 8px;
      padding: 8px 12px;
    }

    main {
      width: min(
        100% - 28px,
        900px
      );

      margin:
        28px auto 60px;
    }

    .status {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
    }

    .muted {
      color: #777;
      font-size: 14px;
    }

    .lead {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 12px;
      padding: 15px 16px;
      margin-bottom: 10px;
    }

    .lead-name {
      font-weight: 650;
      margin-bottom: 6px;
    }

    .lead-meta {
      color: #666;
      font-size: 14px;
    }

    #error {
      display: none;
      padding: 14px;
      background: #ffe4e4;
      border-radius: 10px;
      color: #880000;
      margin-bottom: 16px;
    }
  </style>
</head>

<body>

<header>
  <div class="brand">
    OV Real Estate CRM
  </div>

  <button
    class="logout"
    id="logout"
  >
    Cerrar sesión
  </button>
</header>


<main>

  <div id="error"></div>

  <section class="status">
    <div>
      <strong id="userName">
        Cargando...
      </strong>
    </div>

    <div
      class="muted"
      id="userMeta"
    ></div>
  </section>


  <section class="status">
    <strong>
      Leads
    </strong>

    <div
      class="muted"
      id="leadCount"
    >
      Cargando...
    </div>
  </section>


  <div id="leads"></div>

</main>


<script>

  function showError(
    message
  ) {
    const el =
      document.getElementById(
        "error"
      );

    el.textContent =
      message;

    el.style.display =
      "block";
  }


  async function api(
    path,
    options = {}
  ) {
    const response =
      await fetch(
        path,
        options
      );


    if (
      response.status === 401
    ) {
      window.location.href =
        "/";

      throw new Error(
        "Sesión expirada"
      );
    }


    const data =
      await response.json();


    if (!data.ok) {
      throw new Error(
        data.error ||
        "Error API"
      );
    }


    return data.data;
  }


  async function loadApp() {
    try {
      const me =
        await api(
          "/api/me"
        );


      const user =
        me.usuario || {};


      document.getElementById(
        "userName"
      ).textContent =
        user.nombre ||
        user.correo ||
        "Usuario";


      document.getElementById(
        "userMeta"
      ).textContent =
        [
          user.correo,
          user.rol
        ]
          .filter(Boolean)
          .join(" · ");


      const list =
        await api(
          "/api/leads?limit=100"
        );


      document.getElementById(
        "leadCount"
      ).textContent =
        list.total +
        " leads";


      const container =
        document.getElementById(
          "leads"
        );


      container.replaceChildren();


      list.leads.forEach(
        function(lead) {

          const item =
            document.createElement(
              "div"
            );


          item.className =
            "lead";


          const name =
            document.createElement(
              "div"
            );


          name.className =
            "lead-name";


          name.textContent =
            lead.nombre ||
            "Sin nombre";


          const meta =
            document.createElement(
              "div"
            );


          meta.className =
            "lead-meta";


          meta.textContent =
            [
              lead.proyecto,
              lead.etapa,
              lead.telefono
            ]
              .filter(Boolean)
              .join(" · ");


          item.append(
            name,
            meta
          );


          container.appendChild(
            item
          );
        }
      );

    } catch (error) {
      showError(
        error.message
      );
    }
  }


  document
    .getElementById(
      "logout"
    )
    .addEventListener(
      "click",
      async function() {

        await fetch(
          "/auth/logout",
          {
            method:
              "POST"
          }
        );


        window.location.href =
          "/";
      }
    );


  loadApp();

</script>

</body>
</html>`;
}


/**
 * ============================================================
 * SECURITY
 * ============================================================
 */

function requireSameOrigin(
  request
) {
  const origin =
    request.headers.get(
      "Origin"
    );


  const expected =
    new URL(
      request.url
    ).origin;


  if (
    !origin ||
    origin !== expected
  ) {
    throw publicError(
      403,
      "Origen de solicitud no permitido."
    );
  }
}


function requireEnvironment(
  env
) {
  const required = [
    "GOOGLE_CLIENT_ID",
    "OV_APPS_SCRIPT_URL",
    "OV_API_SHARED_SECRET",
    "OV_SESSION_SECRET"
  ];


  const missing =
    required.filter(
      name =>
        !env[name]
    );


  if (
    missing.length
  ) {
    console.error(
      "Missing env:",
      missing
    );


    throw publicError(
      503,
      "El servidor todavía no está completamente configurado."
    );
  }
}


/**
 * ============================================================
 * RESPONSE HELPERS
 * ============================================================
 */

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {
  return new Response(
    JSON.stringify(
      data
    ),

    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        "X-Content-Type-Options":
          "nosniff",

        ...extraHeaders
      }
    }
  );
}


function htmlResponse(
  html,
  status = 200
) {
  return new Response(
    html,

    {
      status,

      headers: {
        "Content-Type":
          "text/html; charset=utf-8",

        "Cache-Control":
          "no-store",

        "X-Content-Type-Options":
          "nosniff",

        "X-Frame-Options":
          "DENY",

        "Referrer-Policy":
          "strict-origin-when-cross-origin",

        "Cross-Origin-Opener-Policy":
          "same-origin-allow-popups"
      }
    }
  );
}


/**
 * ============================================================
 * GENERAL HELPERS
 * ============================================================
 */

function publicError(
  status,
  message
) {
  const error =
    new Error(
      message
    );


  error.status =
    status;

  error.publicMessage =
    message;


  return error;
}


function safeInteger(
  value,
  fallback
) {
  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {
    return fallback;
  }


  return Math.floor(
    number
  );
}


function getCookieValue(
  cookieHeader,
  name
) {
  const parts =
    String(
      cookieHeader || ""
    ).split(";");


  for (
    const part of parts
  ) {
    const index =
      part.indexOf("=");


    if (
      index === -1
    ) {
      continue;
    }


    const key =
      part
        .slice(
          0,
          index
        )
        .trim();


    if (
      key !== name
    ) {
      continue;
    }


    return part
      .slice(
        index + 1
      )
      .trim();
  }


  return "";
}


function decodeBase64UrlText(
  value
) {
  return new TextDecoder().decode(
    base64UrlToBytes(
      value
    )
  );
}


function base64UrlToBytes(
  value
) {
  let base64 =
    String(
      value || ""
    )
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );


  while (
    base64.length % 4
  ) {
    base64 += "=";
  }


  const binary =
    atob(
      base64
    );


  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(
        i
      );
  }


  return bytes;
}


function bytesToBase64Url(
  bytes
) {
  let binary =
    "";


  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    binary +=
      String.fromCharCode(
        bytes[i]
      );
  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}