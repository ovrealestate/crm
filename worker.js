/**

 * ============================================================

 * OV REAL ESTATE CRM — CLOUDFLARE WORKER

 * Version: 0.3.0-ui-hoy

 * ============================================================

 *

 * Incluye:

 * - Google Sign-In

 * - Verificación real del ID token con JWKS de Google

 * - Sesión firmada HttpOnly

 * - /api/me

 * - /api/hoy

 * - /api/leads

 * - /api/leads/:crm_lead_id

 * - Proxy seguro a Apps Script

 *

 * Interfaz real inicial: Hoy + Leads + detalle de lead.\n * TODAVÍA NO ESCRIBE EN EL CRM.

 */



const APP_VERSION = "0.3.0-ui-hoy";



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

   * API HOY

   */

  if (

    url.pathname === "/api/hoy" &&

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

          action: "hoy"

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
    content="width=device-width,initial-scale=1,viewport-fit=cover"
  >
  <meta name="theme-color" content="#0b0b0b">

  <title>OV Real Estate CRM</title>

  <style>
    :root {
      --bg: #f4f4f2;
      --panel: #ffffff;
      --ink: #111111;
      --muted: #727272;
      --line: #e4e4e1;
      --black: #0b0b0b;
      --purple: #6d4aff;
      --red: #d92d20;
      --amber: #d28a00;
      --green: #168a55;
      --blue: #2767d8;
      --gray: #7b7b7b;
      --shadow: 0 8px 28px rgba(0,0,0,.055);
      --radius: 18px;
      --nav-width: 228px;
    }

    * {
      box-sizing: border-box;
    }

    html {
      background: var(--bg);
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button {
      cursor: pointer;
    }

    .app-shell {
      min-height: 100vh;
    }

    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      width: var(--nav-width);
      padding: 22px 16px;
      background: var(--black);
      color: #fff;
      display: flex;
      flex-direction: column;
      z-index: 20;
    }

    .brand-wrap {
      padding: 4px 10px 24px;
    }

    .brand {
      font-size: 21px;
      font-weight: 780;
      letter-spacing: -.45px;
    }

    .brand-sub {
      margin-top: 5px;
      color: #9f9f9f;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .nav-list {
      display: grid;
      gap: 7px;
    }

    .nav-button {
      width: 100%;
      min-height: 46px;
      border: 0;
      border-radius: 12px;
      padding: 0 13px;
      background: transparent;
      color: #a9a9a9;
      display: flex;
      align-items: center;
      gap: 11px;
      text-align: left;
      font-weight: 650;
    }

    .nav-button:hover {
      background: #181818;
      color: #fff;
    }

    .nav-button.active {
      background: #fff;
      color: #111;
    }

    .nav-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      opacity: .9;
      flex: 0 0 auto;
    }

    .sidebar-bottom {
      margin-top: auto;
      padding: 18px 10px 4px;
      border-top: 1px solid #292929;
    }

    .user-small {
      color: #d0d0d0;
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .user-role {
      color: #777;
      margin-top: 3px;
    }

    .main-shell {
      min-height: 100vh;
      margin-left: var(--nav-width);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 15;
      min-height: 72px;
      padding: 0 28px;
      background: rgba(244,244,242,.93);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(225,225,222,.9);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .topbar-title {
      font-size: 22px;
      font-weight: 780;
      letter-spacing: -.4px;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ghost-button,
    .primary-button,
    .icon-button {
      border: 1px solid var(--line);
      border-radius: 11px;
      background: #fff;
      color: var(--ink);
      min-height: 40px;
      padding: 0 13px;
      font-weight: 650;
    }

    .ghost-button:hover,
    .icon-button:hover {
      background: #f8f8f7;
    }

    .primary-button {
      border-color: var(--black);
      background: var(--black);
      color: #fff;
    }

    .page {
      width: min(1180px, calc(100% - 48px));
      margin: 0 auto;
      padding: 28px 0 92px;
    }

    .hero-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 22px;
    }

    .eyebrow {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .page-title {
      margin: 0;
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1.05;
      letter-spacing: -1.2px;
    }

    .page-subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }

    .readonly-pill {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid #ddddda;
      border-radius: 999px;
      background: #fff;
      color: #686868;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .counter-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 22px;
    }

    .counter-card {
      position: relative;
      min-height: 112px;
      padding: 16px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
      text-align: left;
      overflow: hidden;
    }

    .counter-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--accent, var(--gray));
    }

    .counter-card:hover {
      transform: translateY(-1px);
      border-color: #d3d3cf;
    }

    .counter-value {
      display: block;
      font-size: 30px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -.7px;
      margin: 5px 0 12px;
    }

    .counter-label {
      color: #5f5f5f;
      font-size: 12px;
      line-height: 1.25;
      font-weight: 700;
    }

    .accent-purple { --accent: var(--purple); }
    .accent-red { --accent: var(--red); }
    .accent-blue { --accent: var(--blue); }
    .accent-green { --accent: var(--green); }
    .accent-gray { --accent: var(--gray); }

    .toolbar {
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .search-wrap {
      flex: 1 1 320px;
      position: relative;
    }

    .search-input {
      width: 100%;
      min-height: 46px;
      padding: 0 15px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: #fff;
      color: #111;
      outline: none;
    }

    .search-input:focus {
      border-color: #b6b6b1;
      box-shadow: 0 0 0 3px rgba(0,0,0,.04);
    }

    .filter-select {
      min-height: 46px;
      padding: 0 38px 0 13px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: #fff;
      color: #222;
    }

    .section {
      margin-top: 26px;
      scroll-margin-top: 92px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 10px;
    }

    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .section-accent {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent, var(--gray));
      flex: 0 0 auto;
    }

    .section-title {
      margin: 0;
      font-size: 18px;
      font-weight: 760;
      letter-spacing: -.2px;
    }

    .section-count {
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }

    .lead-list {
      display: grid;
      gap: 9px;
    }

    .lead-card {
      width: 100%;
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 18px;
      padding: 16px 17px 16px 20px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 15px;
      box-shadow: 0 3px 16px rgba(0,0,0,.025);
      text-align: left;
      color: inherit;
    }

    .lead-card::before {
      content: "";
      position: absolute;
      inset: 12px auto 12px 0;
      width: 4px;
      border-radius: 0 5px 5px 0;
      background: var(--accent, var(--gray));
    }

    .lead-card:hover {
      border-color: #cfcfcb;
      box-shadow: 0 7px 22px rgba(0,0,0,.05);
    }

    .lead-name {
      font-size: 16px;
      font-weight: 760;
      line-height: 1.25;
      margin-bottom: 5px;
    }

    .lead-meta {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .lead-right {
      display: grid;
      justify-items: end;
      gap: 6px;
      min-width: 92px;
    }

    .stage-pill {
      display: inline-flex;
      align-items: center;
      min-height: 27px;
      padding: 0 9px;
      border-radius: 999px;
      background: #f1f1ef;
      color: #555;
      font-size: 11px;
      font-weight: 760;
      white-space: nowrap;
    }

    .time-text {
      color: #555;
      font-size: 12px;
      font-weight: 680;
      white-space: nowrap;
    }

    .empty-state {
      padding: 24px 18px;
      border: 1px dashed #d6d6d2;
      border-radius: 15px;
      color: var(--muted);
      text-align: center;
      background: rgba(255,255,255,.48);
    }

    .panel {
      padding: 20px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .chips {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      margin: 0 0 18px;
    }

    .chip {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 12px;
      background: #fff;
      color: #555;
      font-size: 12px;
      font-weight: 700;
    }

    .chip.active {
      background: var(--black);
      border-color: var(--black);
      color: #fff;
    }

    .detail-back {
      border: 0;
      padding: 0;
      background: transparent;
      color: #565656;
      font-weight: 700;
      margin-bottom: 18px;
    }

    .detail-head {
      padding: 22px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      margin-bottom: 16px;
    }

    .detail-name {
      margin: 0;
      font-size: 30px;
      line-height: 1.12;
      letter-spacing: -.7px;
    }

    .detail-meta {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.5;
      font-size: 14px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .detail-card {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
    }

    .detail-card.full {
      grid-column: 1 / -1;
    }

    .detail-card h3 {
      margin: 0 0 14px;
      font-size: 15px;
    }

    .info-row {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 12px;
      padding: 8px 0;
      border-top: 1px solid #eeeeeb;
      font-size: 13px;
      line-height: 1.45;
    }

    .info-row:first-of-type {
      border-top: 0;
      padding-top: 0;
    }

    .info-label {
      color: var(--muted);
    }

    .info-value {
      color: #1a1a1a;
      overflow-wrap: anywhere;
    }

    .history-list {
      display: grid;
      gap: 9px;
    }

    .history-item {
      padding: 13px 14px;
      border: 1px solid #e7e7e4;
      border-radius: 13px;
      background: #fbfbfa;
    }

    .history-top {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 5px;
    }

    .history-action {
      font-weight: 720;
      font-size: 13px;
    }

    .history-date {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .history-detail {
      color: #555;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .placeholder-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .placeholder-card {
      min-height: 132px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
    }

    .placeholder-card h3 {
      margin: 0 0 7px;
      font-size: 16px;
    }

    .placeholder-card p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .loading {
      display: grid;
      place-items: center;
      min-height: 260px;
      color: var(--muted);
    }

    .error-box {
      margin-bottom: 18px;
      padding: 13px 14px;
      border-radius: 13px;
      background: #fff0ef;
      color: #8d1b13;
      border: 1px solid #f2cbc8;
      font-size: 13px;
      display: none;
    }

    .mobile-nav {
      display: none;
    }

    @media (max-width: 980px) {
      .counter-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      :root {
        --nav-width: 0px;
      }

      .sidebar {
        display: none;
      }

      .main-shell {
        margin-left: 0;
      }

      .topbar {
        min-height: 62px;
        padding:
          env(safe-area-inset-top)
          16px
          0;
      }

      .topbar-title {
        font-size: 19px;
      }

      .top-actions .ghost-button {
        display: none;
      }

      .page {
        width: min(100% - 24px, 680px);
        padding: 22px 0 104px;
      }

      .hero-row {
        align-items: flex-start;
      }

      .page-title {
        font-size: 31px;
      }

      .counter-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .counter-card {
        min-height: 102px;
      }

      .counter-grid .counter-card:last-child {
        grid-column: 1 / -1;
      }

      .detail-grid {
        grid-template-columns: 1fr;
      }

      .detail-card.full {
        grid-column: auto;
      }

      .placeholder-grid {
        grid-template-columns: 1fr;
      }

      .lead-card {
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .lead-right {
        justify-items: start;
        min-width: 0;
        grid-auto-flow: column;
        justify-content: start;
        align-items: center;
      }

      .info-row {
        grid-template-columns: 112px minmax(0, 1fr);
      }

      .mobile-nav {
        position: fixed;
        z-index: 30;
        left: 10px;
        right: 10px;
        bottom: max(10px, env(safe-area-inset-bottom));
        min-height: 64px;
        padding: 7px;
        border: 1px solid #242424;
        border-radius: 18px;
        background: rgba(10,10,10,.95);
        box-shadow: 0 14px 42px rgba(0,0,0,.25);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
      }

      .mobile-nav button {
        min-width: 0;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: #8e8e8e;
        padding: 6px 3px;
        font-size: 11px;
        font-weight: 700;
      }

      .mobile-nav button.active {
        background: #fff;
        color: #111;
      }

      .mobile-nav .nav-dot {
        display: block;
        margin: 0 auto 5px;
      }
    }

    @media (max-width: 410px) {
      .counter-grid {
        gap: 8px;
      }

      .counter-card {
        padding: 14px;
      }

      .counter-value {
        font-size: 27px;
      }

      .info-row {
        grid-template-columns: 1fr;
        gap: 3px;
      }
    }
  </style>
</head>

<body>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand-wrap">
      <div class="brand">OV Real Estate</div>
      <div class="brand-sub">CRM</div>
    </div>

    <nav class="nav-list" aria-label="Principal">
      <button class="nav-button" data-view="hoy">
        <span class="nav-dot"></span>
        Hoy
      </button>

      <button class="nav-button" data-view="leads">
        <span class="nav-dot"></span>
        Leads
      </button>

      <button class="nav-button" data-view="campanas">
        <span class="nav-dot"></span>
        Campañas
      </button>

      <button class="nav-button" data-view="mas">
        <span class="nav-dot"></span>
        Más
      </button>
    </nav>

    <div class="sidebar-bottom">
      <div class="user-small" id="sidebarUser">Cargando...</div>
      <div class="user-small user-role" id="sidebarRole"></div>
    </div>
  </aside>

  <div class="main-shell">
    <header class="topbar">
      <div class="topbar-title" id="topbarTitle">Hoy</div>

      <div class="top-actions">
        <button class="ghost-button" id="refreshButton">
          Actualizar
        </button>

        <button class="ghost-button" id="logoutButton">
          Cerrar sesión
        </button>
      </div>
    </header>

    <div class="page">
      <div class="error-box" id="errorBox"></div>
      <div id="content" class="loading">Cargando CRM...</div>
    </div>
  </div>
</div>

<nav class="mobile-nav" aria-label="Principal móvil">
  <button data-view="hoy">
    <span class="nav-dot"></span>
    Hoy
  </button>

  <button data-view="leads">
    <span class="nav-dot"></span>
    Leads
  </button>

  <button data-view="campanas">
    <span class="nav-dot"></span>
    Campañas
  </button>

  <button data-view="mas">
    <span class="nav-dot"></span>
    Más
  </button>
</nav>

<script>
  const state = {
    me: null,
    hoy: null,
    leads: null,
    currentView: "hoy",
    hoySearch: "",
    leadsSearch: "",
    leadsStage: "",
    leadsProject: "",
    loadingDetailId: "",
    lastHoyLoad: 0,
    lastLeadsLoad: 0
  };

  const VIEW_TITLES = {
    hoy: "Hoy",
    leads: "Leads",
    campanas: "Campañas",
    mas: "Más"
  };

  const HOY_SECTIONS = [
    {
      key: "nuevos",
      label: "Nuevos sin contacto",
      counterLabel: "Nuevos",
      accent: "purple"
    },
    {
      key: "vencidos",
      label: "Seguimientos vencidos",
      counterLabel: "Vencidos",
      accent: "red"
    },
    {
      key: "citas_hoy",
      label: "Citas de hoy",
      counterLabel: "Citas hoy",
      accent: "blue"
    },
    {
      key: "seguimientos_hoy",
      label: "Seguimientos de hoy",
      counterLabel: "Seguimientos hoy",
      accent: "green"
    },
    {
      key: "sin_seguimiento",
      label: "Sin próximo seguimiento",
      counterLabel: "Sin seguimiento",
      accent: "gray"
    }
  ];


  function showError(message) {
    const box = document.getElementById("errorBox");

    if (!message) {
      box.style.display = "none";
      box.textContent = "";
      return;
    }

    box.textContent = message;
    box.style.display = "block";
  }


  async function api(path, options = {}) {
    const response =
      await fetch(
        path,
        {
          ...options,
          headers: {
            ...(options.headers || {}),
            "Accept": "application/json"
          }
        }
      );

    if (response.status === 401) {
      window.location.href = "/";
      throw new Error("Sesión expirada");
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Error API"
      );
    }

    return data.data;
  }


  function normalized(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "");
  }


  function formatDateValue(value, includeTime = false) {
    if (!value) {
      return "";
    }

    const text = String(value).trim();

    const mx =
      text.match(
        /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?$/
      );

    if (mx) {
      const day = String(mx[1]).padStart(2, "0");
      const month = String(mx[2]).padStart(2, "0");
      const year = mx[3];
      const time =
        mx[4]
          ? " · " +
            String(mx[4]).padStart(2, "0") +
            ":" +
            mx[5]
          : "";

      return day + "/" + month + "/" + year + time;
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
      return text;
    }

    const options = {
      day: "2-digit",
      month: "short",
      year: "numeric"
    };

    if (includeTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
    }

    return new Intl.DateTimeFormat(
      "es-MX",
      options
    ).format(date);
  }


  function formatTodayDate(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(
        String(value) +
        "T12:00:00"
      );

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    const formatted =
      new Intl.DateTimeFormat(
        "es-MX",
        {
          weekday: "long",
          day: "numeric",
          month: "long"
        }
      ).format(date);

    return formatted.charAt(0).toUpperCase() +
      formatted.slice(1);
  }


  function clearContent() {
    const content =
      document.getElementById(
        "content"
      );

    content.className = "";
    content.replaceChildren();

    return content;
  }


  function element(tag, className, text) {
    const el =
      document.createElement(tag);

    if (className) {
      el.className = className;
    }

    if (
      text !== undefined &&
      text !== null
    ) {
      el.textContent =
        String(text);
    }

    return el;
  }


  function setActiveNav(view) {
    document
      .querySelectorAll(
        "[data-view]"
      )
      .forEach(
        function(button) {
          button.classList.toggle(
            "active",
            button.dataset.view === view
          );
        }
      );

    document.getElementById(
      "topbarTitle"
    ).textContent =
      VIEW_TITLES[view] ||
      "OV CRM";
  }


  function rememberScroll() {
    try {
      sessionStorage.setItem(
        "ov-scroll:" +
        (location.hash || "#hoy"),
        String(window.scrollY)
      );
    } catch {}
  }


  function restoreScroll(hash) {
    window.requestAnimationFrame(
      function() {
        let y = 0;

        try {
          y =
            Number(
              sessionStorage.getItem(
                "ov-scroll:" + hash
              )
            ) || 0;
        } catch {}

        window.scrollTo(
          0,
          y
        );
      }
    );
  }


  function navigate(view) {
    rememberScroll();

    const target =
      "#" + view;

    if (location.hash === target) {
      handleRoute();
    } else {
      location.hash = target;
    }
  }


  function openLead(crmLeadId, fromView) {
    rememberScroll();

    location.hash =
      "#lead/" +
      encodeURIComponent(
        crmLeadId
      ) +
      "?from=" +
      encodeURIComponent(
        fromView || "leads"
      );
  }


  function parseRoute() {
    const hash =
      String(
        location.hash || "#hoy"
      );

    if (
      hash.startsWith("#lead/")
    ) {
      const raw =
        hash.substring(
          "#lead/".length
        );

      const parts =
        raw.split("?");

      const id =
        decodeURIComponent(
          parts[0] || ""
        );

      const params =
        new URLSearchParams(
          parts[1] || ""
        );

      return {
        type: "lead",
        id: id,
        from:
          params.get("from") ||
          "leads"
      };
    }

    const view =
      hash.replace("#", "") ||
      "hoy";

    return {
      type: "view",
      view:
        VIEW_TITLES[view]
          ? view
          : "hoy"
    };
  }


  async function handleRoute() {
    showError("");

    const route =
      parseRoute();

    if (
      route.type === "lead"
    ) {
      setActiveNav(
        route.from
      );

      document.getElementById(
        "topbarTitle"
      ).textContent =
        "Lead";

      await renderLeadDetail(
        route.id,
        route.from
      );

      return;
    }

    state.currentView =
      route.view;

    setActiveNav(
      route.view
    );

    if (
      route.view === "hoy"
    ) {
      await renderHoy();
    } else if (
      route.view === "leads"
    ) {
      await renderLeads();
    } else if (
      route.view === "campanas"
    ) {
      renderCampanas();
    } else {
      renderMas();
    }

    restoreScroll(
      "#" + route.view
    );
  }


  async function loadMe(force) {
    if (
      state.me &&
      !force
    ) {
      return state.me;
    }

    state.me =
      await api(
        "/api/me"
      );

    const user =
      state.me.usuario || {};

    document.getElementById(
      "sidebarUser"
    ).textContent =
      user.nombre ||
      user.correo ||
      "Usuario";

    document.getElementById(
      "sidebarRole"
    ).textContent =
      [
        user.correo,
        user.rol
      ]
        .filter(Boolean)
        .join(" · ");

    return state.me;
  }


  async function loadHoy(force) {
    const fresh =
      Date.now() -
      state.lastHoyLoad <
      30000;

    if (
      state.hoy &&
      fresh &&
      !force
    ) {
      return state.hoy;
    }

    state.hoy =
      await api(
        "/api/hoy"
      );

    state.lastHoyLoad =
      Date.now();

    return state.hoy;
  }


  async function loadLeads(force) {
    const fresh =
      Date.now() -
      state.lastLeadsLoad <
      30000;

    if (
      state.leads &&
      fresh &&
      !force
    ) {
      return state.leads;
    }

    state.leads =
      await api(
        "/api/leads?limit=500"
      );

    state.lastLeadsLoad =
      Date.now();

    return state.leads;
  }


  function createHero(
    eyebrow,
    title,
    subtitle
  ) {
    const wrap =
      element(
        "div",
        "hero-row"
      );

    const left =
      element("div");

    left.appendChild(
      element(
        "div",
        "eyebrow",
        eyebrow
      )
    );

    left.appendChild(
      element(
        "h1",
        "page-title",
        title
      )
    );

    if (subtitle) {
      left.appendChild(
        element(
          "p",
          "page-subtitle",
          subtitle
        )
      );
    }

    wrap.appendChild(
      left
    );

    wrap.appendChild(
      element(
        "div",
        "readonly-pill",
        "Solo lectura"
      )
    );

    return wrap;
  }


  function leadMatchesSearch(
    lead,
    query
  ) {
    if (!query) {
      return true;
    }

    const haystack =
      normalized(
        [
          lead.nombre,
          lead.proyecto,
          lead.etapa,
          lead.prioridad,
          lead.telefono
        ].join(" ")
      );

    return haystack.includes(
      normalized(query)
    );
  }


  function createLeadCard(
    lead,
    accent,
    fromView,
    timeText
  ) {
    const button =
      element(
        "button",
        "lead-card accent-" +
        accent
      );

    button.type =
      "button";

    button.addEventListener(
      "click",
      function() {
        openLead(
          lead.crm_lead_id,
          fromView
        );
      }
    );

    const left =
      element("div");

    left.appendChild(
      element(
        "div",
        "lead-name",
        lead.nombre ||
        "Sin nombre"
      )
    );

    left.appendChild(
      element(
        "div",
        "lead-meta",
        [
          lead.proyecto,
          lead.telefono
        ]
          .filter(Boolean)
          .join(" · ")
      )
    );

    const right =
      element(
        "div",
        "lead-right"
      );

    right.appendChild(
      element(
        "div",
        "stage-pill",
        lead.etapa ||
        "Sin etapa"
      )
    );

    if (timeText) {
      right.appendChild(
        element(
          "div",
          "time-text",
          timeText
        )
      );
    }

    button.append(
      left,
      right
    );

    return button;
  }


  function hoyTimeText(
    key,
    lead
  ) {
    if (
      key ===
      "citas_hoy"
    ) {
      return formatDateValue(
        lead.fecha_cita,
        true
      );
    }

    if (
      key ===
      "seguimientos_hoy"
    ) {
      const formatted =
        formatDateValue(
          lead.proximo_seguimiento,
          true
        );

      return formatted ||
        "Hoy";
    }

    if (
      key ===
      "vencidos"
    ) {
      if (
        Number(
          lead.dias_vencido
        ) > 0
      ) {
        return (
          lead.dias_vencido +
          (
            Number(
              lead.dias_vencido
            ) === 1
              ? " día vencido"
              : " días vencido"
          )
        );
      }

      return "Vencido";
    }

    if (
      key ===
      "nuevos"
    ) {
      return formatDateValue(
        lead.fecha_lead,
        true
      );
    }

    return "";
  }


  async function renderHoy(force) {
    const content =
      clearContent();

    content.className =
      "loading";

    content.textContent =
      "Cargando Hoy...";

    try {
      const hoy =
        await loadHoy(
          !!force
        );

      content.className = "";
      content.replaceChildren();

      content.appendChild(
        createHero(
          "Agenda operativa",
          "Hoy",
          formatTodayDate(
            hoy.fecha
          )
        )
      );

      const counters =
        element(
          "div",
          "counter-grid"
        );

      HOY_SECTIONS.forEach(
        function(section) {
          const button =
            element(
              "button",
              "counter-card accent-" +
              section.accent
            );

          button.type =
            "button";

          const value =
            element(
              "span",
              "counter-value",
              hoy.contadores[
                section.key
              ] || 0
            );

          const label =
            element(
              "span",
              "counter-label",
              section.counterLabel
            );

          button.append(
            value,
            label
          );

          button.addEventListener(
            "click",
            function() {
              const target =
                document.getElementById(
                  "hoy-section-" +
                  section.key
                );

              if (target) {
                target.scrollIntoView({
                  behavior: "smooth",
                  block: "start"
                });
              }
            }
          );

          counters.appendChild(
            button
          );
        }
      );

      content.appendChild(
        counters
      );

      const toolbar =
        element(
          "div",
          "toolbar"
        );

      const searchWrap =
        element(
          "div",
          "search-wrap"
        );

      const input =
        element(
          "input",
          "search-input"
        );

      input.type =
        "search";

      input.placeholder =
        "Buscar en pendientes de hoy";

      input.value =
        state.hoySearch;

      searchWrap.appendChild(
        input
      );

      toolbar.appendChild(
        searchWrap
      );

      content.appendChild(
        toolbar
      );

      const sectionsHost =
        element("div");

      content.appendChild(
        sectionsHost
      );

      function drawSections() {
        state.hoySearch =
          input.value;

        sectionsHost.replaceChildren();

        let visibleTotal = 0;

        HOY_SECTIONS.forEach(
          function(section) {
            const original =
              (
                hoy.secciones[
                  section.key
                ] || []
              );

            const filtered =
              original.filter(
                function(lead) {
                  return leadMatchesSearch(
                    lead,
                    state.hoySearch
                  );
                }
              );

            visibleTotal +=
              filtered.length;

            const sectionEl =
              element(
                "section",
                "section accent-" +
                section.accent
              );

            sectionEl.id =
              "hoy-section-" +
              section.key;

            const head =
              element(
                "div",
                "section-header"
              );

            const titleWrap =
              element(
                "div",
                "section-title-wrap"
              );

            titleWrap.appendChild(
              element(
                "span",
                "section-accent"
              )
            );

            titleWrap.appendChild(
              element(
                "h2",
                "section-title",
                section.label
              )
            );

            head.appendChild(
              titleWrap
            );

            head.appendChild(
              element(
                "div",
                "section-count",
                filtered.length
              )
            );

            sectionEl.appendChild(
              head
            );

            const list =
              element(
                "div",
                "lead-list"
              );

            if (
              filtered.length
            ) {
              filtered.forEach(
                function(lead) {
                  let accent =
                    section.accent;

                  if (
                    section.key ===
                      "vencidos" &&
                    Number(
                      lead.dias_vencido
                    ) === 1
                  ) {
                    accent =
                      "amber";
                  }

                  list.appendChild(
                    createLeadCard(
                      lead,
                      accent,
                      "hoy",
                      hoyTimeText(
                        section.key,
                        lead
                      )
                    )
                  );
                }
              );
            } else {
              list.appendChild(
                element(
                  "div",
                  "empty-state",
                  state.hoySearch
                    ? "Sin coincidencias."
                    : "Nada pendiente en esta sección."
                )
              );
            }

            sectionEl.appendChild(
              list
            );

            sectionsHost.appendChild(
              sectionEl
            );
          }
        );

        if (
          state.hoySearch &&
          visibleTotal === 0
        ) {
          showError(
            "No encontramos pendientes con esa búsqueda."
          );
        } else {
          showError("");
        }
      }

      input.addEventListener(
        "input",
        drawSections
      );

      drawSections();

    } catch (error) {
      content.className = "";
      content.replaceChildren(
        element(
          "div",
          "empty-state",
          "No se pudo cargar Hoy."
        )
      );

      showError(
        error.message
      );
    }
  }


  async function renderLeads(force) {
    const content =
      clearContent();

    content.className =
      "loading";

    content.textContent =
      "Cargando leads...";

    try {
      const list =
        await loadLeads(
          !!force
        );

      content.className = "";
      content.replaceChildren();

      content.appendChild(
        createHero(
          "Base comercial",
          "Leads",
          list.total +
          " leads"
        )
      );

      const toolbar =
        element(
          "div",
          "toolbar"
        );

      const searchWrap =
        element(
          "div",
          "search-wrap"
        );

      const input =
        element(
          "input",
          "search-input"
        );

      input.type =
        "search";

      input.placeholder =
        "Nombre, teléfono, correo, proyecto o campaña";

      input.value =
        state.leadsSearch;

      searchWrap.appendChild(
        input
      );

      const stageSelect =
        element(
          "select",
          "filter-select"
        );

      const projectSelect =
        element(
          "select",
          "filter-select"
        );

      toolbar.append(
        searchWrap,
        stageSelect,
        projectSelect
      );

      content.appendChild(
        toolbar
      );

      const stages =
        Array.from(
          new Set(
            list.leads
              .map(
                lead =>
                  String(
                    lead.etapa || ""
                  ).trim()
              )
              .filter(Boolean)
          )
        ).sort();

      const projects =
        Array.from(
          new Set(
            list.leads
              .map(
                lead =>
                  String(
                    lead.proyecto || ""
                  ).trim()
              )
              .filter(Boolean)
          )
        ).sort();

      function fillSelect(
        select,
        firstLabel,
        values,
        selected
      ) {
        select.replaceChildren();

        const all =
          element(
            "option",
            "",
            firstLabel
          );

        all.value = "";

        select.appendChild(
          all
        );

        values.forEach(
          function(value) {
            const option =
              element(
                "option",
                "",
                value
              );

            option.value =
              value;

            if (
              value === selected
            ) {
              option.selected =
                true;
            }

            select.appendChild(
              option
            );
          }
        );
      }

      fillSelect(
        stageSelect,
        "Todas las etapas",
        stages,
        state.leadsStage
      );

      fillSelect(
        projectSelect,
        "Todos los proyectos",
        projects,
        state.leadsProject
      );

      const chips =
        element(
          "div",
          "chips"
        );

      content.appendChild(
        chips
      );

      const listHost =
        element(
          "div",
          "lead-list"
        );

      content.appendChild(
        listHost
      );

      function drawProjectChips() {
        chips.replaceChildren();

        const allChip =
          element(
            "button",
            "chip" +
            (
              !state.leadsProject
                ? " active"
                : ""
            ),
            "Todos"
          );

        allChip.type =
          "button";

        allChip.addEventListener(
          "click",
          function() {
            state.leadsProject = "";
            projectSelect.value = "";
            draw();
          }
        );

        chips.appendChild(
          allChip
        );

        projects.forEach(
          function(project) {
            const chip =
              element(
                "button",
                "chip" +
                (
                  state.leadsProject ===
                    project
                    ? " active"
                    : ""
                ),
                project
              );

            chip.type =
              "button";

            chip.addEventListener(
              "click",
              function() {
                state.leadsProject =
                  project;

                projectSelect.value =
                  project;

                draw();
              }
            );

            chips.appendChild(
              chip
            );
          }
        );
      }

      function draw() {
        state.leadsSearch =
          input.value;

        state.leadsStage =
          stageSelect.value;

        state.leadsProject =
          projectSelect.value;

        drawProjectChips();

        const query =
          normalized(
            state.leadsSearch
          );

        const filtered =
          list.leads.filter(
            function(lead) {
              if (
                state.leadsStage &&
                lead.etapa !==
                  state.leadsStage
              ) {
                return false;
              }

              if (
                state.leadsProject &&
                lead.proyecto !==
                  state.leadsProject
              ) {
                return false;
              }

              if (!query) {
                return true;
              }

              const haystack =
                normalized(
                  [
                    lead.nombre,
                    lead.telefono,
                    lead.telefono_original,
                    lead.correo,
                    lead.proyecto,
                    lead.campaign_id,
                    lead.etapa
                  ].join(" ")
                );

              return haystack.includes(
                query
              );
            }
          );

        listHost.replaceChildren();

        if (!filtered.length) {
          listHost.appendChild(
            element(
              "div",
              "empty-state",
              "No encontramos leads con esos filtros."
            )
          );

          return;
        }

        filtered.forEach(
          function(lead) {
            listHost.appendChild(
              createLeadCard(
                lead,
                lead.etapa === "Nuevo"
                  ? "purple"
                  : "gray",
                "leads",
                formatDateValue(
                  lead.fecha_lead,
                  false
                )
              )
            );
          }
        );
      }

      input.addEventListener(
        "input",
        draw
      );

      stageSelect.addEventListener(
        "change",
        draw
      );

      projectSelect.addEventListener(
        "change",
        draw
      );

      draw();

    } catch (error) {
      content.className = "";
      content.replaceChildren(
        element(
          "div",
          "empty-state",
          "No se pudieron cargar los leads."
        )
      );

      showError(
        error.message
      );
    }
  }


  function addInfoRow(
    card,
    label,
    value
  ) {
    if (
      value === "" ||
      value === null ||
      value === undefined ||
      value === false
    ) {
      return;
    }

    const row =
      element(
        "div",
        "info-row"
      );

    row.appendChild(
      element(
        "div",
        "info-label",
        label
      )
    );

    row.appendChild(
      element(
        "div",
        "info-value",
        value === true
          ? "Sí"
          : value
      )
    );

    card.appendChild(
      row
    );
  }


  function createDetailCard(
    title,
    full
  ) {
    const card =
      element(
        "section",
        "detail-card" +
        (
          full
            ? " full"
            : ""
        )
      );

    card.appendChild(
      element(
        "h3",
        "",
        title
      )
    );

    return card;
  }


  async function renderLeadDetail(
    crmLeadId,
    fromView
  ) {
    const content =
      clearContent();

    content.className =
      "loading";

    content.textContent =
      "Cargando lead...";

    state.loadingDetailId =
      crmLeadId;

    try {
      const data =
        await api(
          "/api/leads/" +
          encodeURIComponent(
            crmLeadId
          )
        );

      if (
        state.loadingDetailId !==
        crmLeadId
      ) {
        return;
      }

      const lead =
        data.lead || {};

      const historial =
        data.historial || [];

      content.className = "";
      content.replaceChildren();

      const back =
        element(
          "button",
          "detail-back",
          "← Volver"
        );

      back.type =
        "button";

      back.addEventListener(
        "click",
        function() {
          history.back();
        }
      );

      content.appendChild(
        back
      );

      const head =
        element(
          "section",
          "detail-head"
        );

      head.appendChild(
        element(
          "h1",
          "detail-name",
          lead.nombre ||
          "Sin nombre"
        )
      );

      head.appendChild(
        element(
          "div",
          "detail-meta",
          [
            lead.proyecto,
            lead.etapa,
            lead.telefono
          ]
            .filter(Boolean)
            .join(" · ")
        )
      );

      content.appendChild(
        head
      );

      const grid =
        element(
          "div",
          "detail-grid"
        );

      const contact =
        createDetailCard(
          "Contacto",
          false
        );

      addInfoRow(
        contact,
        "Teléfono",
        lead.telefono
      );

      addInfoRow(
        contact,
        "País",
        lead.pais_telefono
      );

      addInfoRow(
        contact,
        "Correo",
        lead.correo
      );

      addInfoRow(
        contact,
        "Tel. original",
        lead.telefono_original
      );

      const commercial =
        createDetailCard(
          "Perfil comercial",
          false
        );

      addInfoRow(
        commercial,
        "Plazo",
        lead.plazo_texto_original ||
        lead.plazo
      );

      addInfoRow(
        commercial,
        "Presupuesto",
        lead.presupuesto_texto_original ||
        lead.presupuesto
      );

      addInfoRow(
        commercial,
        "Recámaras",
        lead.recamaras
      );

      addInfoRow(
        commercial,
        "Flex",
        lead.flex
          ? "Sí"
          : ""
      );

      addInfoRow(
        commercial,
        "Forma de pago",
        lead.forma_pago
      );

      const pipeline =
        createDetailCard(
          "Pipeline",
          false
        );

      addInfoRow(
        pipeline,
        "Etapa",
        lead.etapa
      );

      addInfoRow(
        pipeline,
        "Prioridad",
        lead.prioridad
      );

      addInfoRow(
        pipeline,
        "Último contacto",
        formatDateValue(
          lead.ultimo_contacto,
          true
        )
      );

      addInfoRow(
        pipeline,
        "Seguimiento",
        formatDateValue(
          lead.proximo_seguimiento,
          true
        )
      );

      addInfoRow(
        pipeline,
        "Cita",
        formatDateValue(
          lead.fecha_cita,
          true
        )
      );

      addInfoRow(
        pipeline,
        "Motivo descarte",
        lead.motivo_descarte
      );

      const acquisition =
        createDetailCard(
          "Adquisición",
          false
        );

      addInfoRow(
        acquisition,
        "Fecha lead",
        formatDateValue(
          lead.fecha_lead,
          true
        )
      );

      addInfoRow(
        acquisition,
        "Fuente",
        lead.fuente
      );

      addInfoRow(
        acquisition,
        "Formato",
        lead.formato
      );

      addInfoRow(
        acquisition,
        "Origen",
        lead.origen_registro
      );

      addInfoRow(
        acquisition,
        "Asignado",
        lead.usuario_asignado
      );

      grid.append(
        contact,
        commercial,
        pipeline,
        acquisition
      );

      const historyCard =
        createDetailCard(
          "Historial",
          true
        );

      const historyList =
        element(
          "div",
          "history-list"
        );

      if (
        historial.length
      ) {
        historial
          .slice()
          .reverse()
          .forEach(
            function(event) {
              const item =
                element(
                  "div",
                  "history-item"
                );

              const top =
                element(
                  "div",
                  "history-top"
                );

              top.appendChild(
                element(
                  "div",
                  "history-action",
                  event.accion ||
                  event.tipo_evento ||
                  "Evento"
                )
              );

              top.appendChild(
                element(
                  "div",
                  "history-date",
                  formatDateValue(
                    event.fecha_hora,
                    true
                  )
                )
              );

              item.appendChild(
                top
              );

              const detail =
                [
                  event.detalle,
                  event.mensaje,
                  event.resultado
                ]
                  .filter(Boolean)
                  .join("\\n");

              if (detail) {
                item.appendChild(
                  element(
                    "div",
                    "history-detail",
                    detail
                  )
                );
              }

              historyList.appendChild(
                item
              );
            }
          );
      } else {
        historyList.appendChild(
          element(
            "div",
            "empty-state",
            "Este lead todavía no tiene eventos de historial."
          )
        );
      }

      historyCard.appendChild(
        historyList
      );

      grid.appendChild(
        historyCard
      );

      content.appendChild(
        grid
      );

      window.scrollTo(
        0,
        0
      );

    } catch (error) {
      content.className = "";
      content.replaceChildren(
        element(
          "div",
          "empty-state",
          "No se pudo cargar el detalle del lead."
        )
      );

      showError(
        error.message
      );
    }
  }


  function renderCampanas() {
    const content =
      clearContent();

    content.appendChild(
      createHero(
        "Marketing",
        "Campañas",
        "El módulo comercial de campañas será conectado en la siguiente fase."
      )
    );

    const grid =
      element(
        "div",
        "placeholder-grid"
      );

    const cards = [
      [
        "Campañas activas",
        "Aquí aparecerán las campañas comerciales activas y su estado."
      ],
      [
        "Resultados",
        "La lectura de gasto, leads, CPL y conversión se conectará sin exponer IDs técnicos."
      ],
      [
        "Comparativos",
        "Tendremos vista por campaña y formato manteniendo el modelo de métricas definido."
      ],
      [
        "Configuración",
        "Los IDs de Meta y la configuración técnica seguirán fuera de la interfaz normal."
      ]
    ];

    cards.forEach(
      function(item) {
        const card =
          element(
            "section",
            "placeholder-card"
          );

        card.appendChild(
          element(
            "h3",
            "",
            item[0]
          )
        );

        card.appendChild(
          element(
            "p",
            "",
            item[1]
          )
        );

        grid.appendChild(
          card
        );
      }
    );

    content.appendChild(
      grid
    );
  }


  function renderMas() {
    const content =
      clearContent();

    content.appendChild(
      createHero(
        "Configuración",
        "Más",
        "Administración y herramientas del CRM."
      )
    );

    const grid =
      element(
        "div",
        "placeholder-grid"
      );

    const items = [
      [
        "Catálogos",
        "Etapas, prioridades, formas de pago, descartes y demás opciones."
      ],
      [
        "Plantillas mensajes",
        "Mensajes reutilizables por proyecto y campaña."
      ],
      [
        "Variables mensajes",
        "Tokens como {nombre}, {proyecto}, {presupuesto} y más."
      ],
      [
        "Mi inmobiliaria",
        "Configuración general de OV Real Estate."
      ],
      [
        "Usuarios",
        "Administradores y asesores autorizados."
      ],
      [
        "Historial global",
        "Consulta cronológica de eventos de todos los leads."
      ]
    ];

    items.forEach(
      function(item) {
        const card =
          element(
            "section",
            "placeholder-card"
          );

        card.appendChild(
          element(
            "h3",
            "",
            item[0]
          )
        );

        card.appendChild(
          element(
            "p",
            "",
            item[1]
          )
        );

        grid.appendChild(
          card
        );
      }
    );

    content.appendChild(
      grid
    );
  }


  async function refreshCurrentView() {
    showError("");

    const route =
      parseRoute();

    if (
      route.type === "lead"
    ) {
      await renderLeadDetail(
        route.id,
        route.from
      );

      return;
    }

    if (
      route.view === "hoy"
    ) {
      await renderHoy(true);
    } else if (
      route.view === "leads"
    ) {
      await renderLeads(true);
    } else {
      await handleRoute();
    }
  }


  async function logout() {
    try {
      await fetch(
        "/auth/logout",
        {
          method: "POST"
        }
      );
    } finally {
      window.location.href = "/";
    }
  }


  document
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(
      function(button) {
        button.addEventListener(
          "click",
          function() {
            navigate(
              button.dataset.view
            );
          }
        );
      }
    );


  document.getElementById(
    "refreshButton"
  ).addEventListener(
    "click",
    refreshCurrentView
  );


  document.getElementById(
    "logoutButton"
  ).addEventListener(
    "click",
    logout
  );


  window.addEventListener(
    "hashchange",
    handleRoute
  );


  window.addEventListener(
    "beforeunload",
    rememberScroll
  );


  async function boot() {
    try {
      await loadMe(false);

      if (!location.hash) {
        history.replaceState(
          null,
          "",
          "#hoy"
        );
      }

      await handleRoute();

    } catch (error) {
      showError(
        error.message
      );

      const content =
        clearContent();

      content.appendChild(
        element(
          "div",
          "empty-state",
          "No se pudo iniciar el CRM."
        )
      );
    }
  }


  boot();
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