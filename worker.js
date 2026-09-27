/**

 * ============================================================

 * OV REAL ESTATE CRM — CLOUDFLARE WORKER

 * Version: 0.6.4-campaigns-adset-trend

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

 * - /api/campaigns

 * - Proxy seguro a Apps Script

 *

 * Interfaz real inicial: Hoy + Leads + detalle de lead.\n * TODAVÍA NO ESCRIBE EN EL CRM.

 */



const APP_VERSION = "0.6.4-campaigns-adset-trend";



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



 const meData =
 upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (!meData || typeof meData !== "object") {
 throw publicError(
 502,
 "El API no devolvió los datos del usuario."
 );
 }

 return jsonResponse({
 ok: true,
 data: meData
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



 const hoyData =
 upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (!hoyData || typeof hoyData !== "object") {
 throw publicError(
 502,
 "El API no devolvió la agenda de Hoy."
 );
 }

 return jsonResponse({
 ok: true,
 data: hoyData
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



 const listData =
 upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (!listData || typeof listData !== "object" || !Array.isArray(listData.leads)) {
 throw publicError(
 502,
 "El API no devolvió la lista de leads."
 );
 }

 if (!Number.isFinite(Number(listData.total))) {
 listData.total = listData.leads.length;
 }

 return jsonResponse({
 ok: true,
 data: listData
 });

 }





 /**

 * API CAMPAIGNS DASHBOARD — SOLO LECTURA

 */

 if (
 url.pathname === "/api/campaigns" &&
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
 action: "campaigns.dashboard"
 }
 );

 const campaignData =
 upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (
 !campaignData ||
 typeof campaignData !== "object" ||
 !Array.isArray(campaignData.campaigns)
 ) {
 throw publicError(
 502,
 "El API no devolvió las métricas de campañas."
 );
 }

 return jsonResponse({
 ok: true,
 data: campaignData
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

 const detailData =
 upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (!detailData || !detailData.lead) {
 throw publicError(
 502,
 "El API no devolvió el detalle del lead."
 );
 }

 return jsonResponse({
 ok: true,
 data: detailData
 });

 }





 /**

 * API LEAD UPDATE — OPERACIÓN

 */

 if (

 url.pathname.startsWith(
 "/api/leads/"
 ) &&

 method === "PATCH"

 ) {

 requireSameOrigin(
 request
 );


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


 const upstream =
 await callAppsScript(
 env,
 session.email,
 {
 action:
 "leads.update",

 crm_lead_id:
 crmLeadId,

 expected_version:
 String(
 body?.expected_version ||
 ""
 ),

 changes:
 body?.changes || {}
 }
 );


 return jsonResponse({
 ok: true,
 data: upstream.data
 });
 }







 /**
 * API ADD NOTE
 */
 if (
 url.pathname.startsWith("/api/leads/") &&
 url.pathname.endsWith("/notes") &&
 method === "POST"
 ) {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 const rawId = url.pathname.substring("/api/leads/".length, url.pathname.length - "/notes".length);
 const crmLeadId = decodeURIComponent(rawId).trim();
 if (!crmLeadId) throw publicError(400, "Falta crm_lead_id.");

 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }

 const upstream = await callAppsScript(env, session.email, {
 action: "notes.add",
 crm_lead_id: crmLeadId,
 nota: String(body?.nota || "")
 });

 return jsonResponse({ok: true, data: upstream.data});
 }


 /**
 * CLIENT / APP LOG
 */
 if (url.pathname === "/api/app-log" && method === "POST") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }

 const upstream = await callAppsScript(env, session.email, {
 action: "app.log",
 log: body?.log || {}
 });

 return jsonResponse({ok: true, data: upstream.data});
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

 request_id:
 payload.request_id || crypto.randomUUID(),

 worker_version:
 APP_VERSION,

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

<html lang="es-MX">

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
<html lang="es-MX">
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
 position: sticky;
 top: 78px;
 z-index: 12;
 display: grid;
 grid-template-columns: repeat(5, minmax(0, 1fr));
 gap: 10px;
 margin-bottom: 22px;
 padding: 8px 0 10px;
 background: rgba(244,244,242,.96);
 backdrop-filter: blur(14px);
 -webkit-backdrop-filter: blur(14px);
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
 scroll-margin-top: 220px;
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

 .editable-info-row {
 display: grid;
 grid-template-columns: 132px minmax(0, 1fr) auto;
 gap: 12px;
 align-items: center;
 padding: 10px 0;
 border-top: 1px solid #eeeeeb;
 font-size: 13px;
 line-height: 1.45;
 }

 .editable-info-row:first-of-type {
 border-top: 0;
 padding-top: 0;
 }

 .editable-value-wrap {
 min-width: 0;
 }

 .editable-subtitle {
 margin-top: 2px;
 color: var(--muted);
 font-size: 11px;
 }

 .edit-link {
 border: 0;
 background: transparent;
 padding: 4px 0 4px 8px;
 color: #111;
 font-size: 12px;
 font-weight: 760;
 text-decoration: underline;
 text-underline-offset: 3px;
 cursor: pointer;
 }

 .card-action-button {
 border: 1px solid var(--line);
 background: #fff;
 border-radius: 10px;
 padding: 8px 11px;
 font-weight: 720;
 font-size: 12px;
 cursor: pointer;
 margin-bottom: 12px;
 }

 .popover-backdrop {
 position: fixed;
 inset: 0;
 z-index: 1000;
 background: rgba(0,0,0,.22);
 display: grid;
 place-items: center;
 padding: 18px;
 }

 .popover-panel {
 width: min(440px, 100%);
 max-height: min(82vh, 760px);
 overflow: auto;
 background: #fff;
 border: 1px solid #deded8;
 border-radius: 18px;
 box-shadow: 0 24px 70px rgba(0,0,0,.20);
 padding: 18px;
 }

 .popover-head {
 display: flex;
 justify-content: space-between;
 gap: 12px;
 align-items: center;
 margin-bottom: 15px;
 }

 .popover-title {
 font-size: 17px;
 font-weight: 790;
 }

 .popover-close {
 border: 0;
 background: #f3f3f0;
 width: 32px;
 height: 32px;
 border-radius: 50%;
 font-size: 18px;
 cursor: pointer;
 }

 .popover-body {
 display: grid;
 gap: 13px;
 }

 .popover-actions {
 display: flex;
 justify-content: flex-end;
 gap: 8px;
 margin-top: 4px;
 }

 .popover-help {
 color: var(--muted);
 font-size: 11px;
 line-height: 1.45;
 }

 .stage-link-box {
 display: none;
 padding: 12px;
 border: 1px solid #dddcd6;
 border-radius: 12px;
 background: #fafaf8;
 font-size: 12px;
 line-height: 1.45;
 }

 .stage-link-box.visible { display: block; }

 .form-textarea {
 min-height: 92px;
 padding-top: 10px;
 resize: vertical;
 }

 .value-money {
 display: none;
 }

 .value-money.visible { display: grid; }

 .operation-form {
 display: grid;
 gap: 14px;
 }

 .form-field {
 display: grid;
 gap: 6px;
 }

 .form-label {
 color: var(--muted);
 font-size: 12px;
 font-weight: 720;
 }

 .form-control {
 width: 100%;
 min-height: 42px;
 border: 1px solid var(--line);
 border-radius: 11px;
 padding: 0 11px;
 background: #fff;
 color: #111;
 outline: none;
 }

 .form-control:focus {
 border-color: #a7a7a1;
 box-shadow: 0 0 0 3px rgba(0,0,0,.04);
 }

 .form-control.input-invalid {
 border-color: #d92d20;
 box-shadow: 0 0 0 3px rgba(217,45,32,.08);
 }

 .mx-date-control {
 position: relative;
 display: grid;
 grid-template-columns: minmax(0, 1fr) 42px;
 width: 100%;
 }

 .mx-date-control .mx-date-text {
 padding-right: 10px;
 border-radius: 11px 0 0 11px;
 }

 .mx-date-picker-wrap {
 position: relative;
 min-width: 42px;
 height: 42px;
 border: 1px solid var(--line);
 border-left: 0;
 border-radius: 0 11px 11px 0;
 background: #fafaf8;
 overflow: hidden;
 }

 .mx-date-picker-wrap::before {
 content: "";
 position: absolute;
 left: 12px;
 top: 12px;
 width: 16px;
 height: 14px;
 border: 2px solid #555;
 border-radius: 3px;
 pointer-events: none;
 }

 .mx-date-picker-wrap::after {
 content: "";
 position: absolute;
 left: 12px;
 top: 16px;
 width: 16px;
 border-top: 2px solid #555;
 pointer-events: none;
 }

 .mx-date-picker {
 position: absolute;
 inset: 0;
 width: 100%;
 height: 100%;
 opacity: 0;
 cursor: pointer;
 }

 .mx-time-control {
 position: relative;
 display: grid;
 grid-template-columns: minmax(0, 1fr) 42px;
 width: 100%;
 }

 .mx-time-control .mx-time-text {
 padding-right: 10px;
 border-radius: 11px 0 0 11px;
 }

 .mx-time-picker-wrap {
 position: relative;
 min-width: 42px;
 height: 42px;
 border: 1px solid var(--line);
 border-left: 0;
 border-radius: 0 11px 11px 0;
 background: #fafaf8;
 overflow: hidden;
 }

 .mx-time-picker-wrap::before {
 content: "";
 position: absolute;
 left: 11px;
 top: 10px;
 width: 18px;
 height: 18px;
 border: 2px solid #555;
 border-radius: 50%;
 pointer-events: none;
 }

 .mx-time-picker-wrap::after {
 content: "";
 position: absolute;
 left: 20px;
 top: 14px;
 width: 5px;
 height: 7px;
 border-left: 2px solid #555;
 border-bottom: 2px solid #555;
 pointer-events: none;
 }

 .mx-time-picker {
 position: absolute;
 inset: 0;
 width: 100%;
 height: 100%;
 opacity: 0;
 cursor: pointer;
 }

 .confirm-box {
 display: grid;
 gap: 10px;
 padding: 12px;
 border: 1px solid #dddcd6;
 border-radius: 12px;
 background: #fafaf8;
 }

 .confirm-summary {
 color: #444;
 font-size: 12px;
 line-height: 1.45;
 }

 .followup-grid {
 display: grid;
 grid-template-columns: minmax(0, 1fr) 130px;
 gap: 8px;
 }

 .discard-box {
 display: none;
 gap: 12px;
 padding: 13px;
 border: 1px solid #ead7d4;
 border-radius: 13px;
 background: #fff8f7;
 }

 .discard-box.visible {
 display: grid;
 }

 .phone-warning {
 display: none;
 padding: 13px;
 border: 1px solid #e8c4c0;
 border-radius: 12px;
 background: #fff;
 }

 .phone-warning.visible {
 display: block;
 }

 .phone-warning-title {
 font-weight: 760;
 margin-bottom: 8px;
 }

 .phone-warning-line {
 font-size: 12px;
 line-height: 1.5;
 color: #555;
 overflow-wrap: anywhere;
 }

 .confirm-line {
 display: flex;
 align-items: flex-start;
 gap: 8px;
 margin-top: 10px;
 color: #333;
 font-size: 12px;
 line-height: 1.4;
 }

 .form-actions {
 display: flex;
 align-items: center;
 gap: 9px;
 flex-wrap: wrap;
 padding-top: 2px;
 }

 .save-button {
 min-height: 42px;
 border: 0;
 border-radius: 11px;
 padding: 0 15px;
 background: var(--black);
 color: #fff;
 font-weight: 740;
 }

 .save-button:disabled {
 opacity: .45;
 cursor: not-allowed;
 }

 .secondary-button {
 min-height: 42px;
 border: 1px solid var(--line);
 border-radius: 11px;
 padding: 0 13px;
 background: #fff;
 color: #333;
 font-weight: 680;
 }

 .save-status {
 min-height: 18px;
 color: var(--muted);
 font-size: 12px;
 line-height: 1.4;
 }

 .save-status.ok {
 color: var(--green);
 }

 .save-status.error {
 color: var(--red);
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

 .campaign-dashboard {
 display: grid;
 gap: 18px;
 }

 .campaign-summary-grid {
 display: grid;
 grid-template-columns: repeat(4, minmax(0, 1fr));
 gap: 12px;
 }

 .campaign-kpi {
 padding: 16px;
 border: 1px solid var(--line);
 border-radius: 16px;
 background: #fff;
 }

 .campaign-kpi-label {
 color: var(--muted);
 font-size: 12px;
 font-weight: 720;
 }

 .campaign-kpi-value {
 margin-top: 7px;
 font-size: 27px;
 line-height: 1;
 font-weight: 800;
 letter-spacing: -.03em;
 }

 .campaign-kpi-note {
 margin-top: 7px;
 color: var(--muted);
 font-size: 11px;
 line-height: 1.35;
 }

 .campaign-list {
 display: grid;
 grid-template-columns: repeat(2, minmax(0, 1fr));
 gap: 12px;
 }

 .campaign-card {
 width: 100%;
 text-align: left;
 border: 1px solid var(--line);
 border-radius: 17px;
 padding: 17px;
 background: #fff;
 color: inherit;
 cursor: pointer;
 transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
 }

 .campaign-card:hover {
 border-color: #bcbcb5;
 transform: translateY(-1px);
 }

 .campaign-card.active {
 border-color: #111;
 box-shadow: 0 0 0 1px #111 inset;
 }

 .campaign-card-top,
 .campaign-section-head {
 display: flex;
 align-items: flex-start;
 justify-content: space-between;
 gap: 12px;
 }

 .campaign-card-title {
 font-size: 17px;
 font-weight: 800;
 }

 .campaign-card-meta {
 margin-top: 4px;
 color: var(--muted);
 font-size: 12px;
 line-height: 1.4;
 }

 .campaign-status {
 display: inline-flex;
 align-items: center;
 gap: 6px;
 min-height: 28px;
 padding: 0 9px;
 border: 1px solid #d8e7dc;
 border-radius: 999px;
 background: #f4fbf6;
 color: #176b3a;
 font-size: 11px;
 font-weight: 780;
 white-space: nowrap;
 }

 .campaign-status::before {
 content: "";
 width: 7px;
 height: 7px;
 border-radius: 50%;
 background: #1b9a57;
 }

 .campaign-status.inactive {
 border-color: var(--line);
 background: #fafaf8;
 color: #666;
 }

 .campaign-status.inactive::before {
 background: #999;
 }

 .campaign-card-metrics {
 display: grid;
 grid-template-columns: repeat(4, minmax(0, 1fr));
 gap: 8px;
 margin-top: 15px;
 }

 .campaign-mini-label {
 color: var(--muted);
 font-size: 10px;
 font-weight: 700;
 }

 .campaign-mini-value {
 margin-top: 3px;
 font-size: 15px;
 font-weight: 780;
 }

 .campaign-section {
 padding: 18px;
 border: 1px solid var(--line);
 border-radius: 17px;
 background: #fff;
 }

 .campaign-section-title {
 margin: 0;
 font-size: 18px;
 font-weight: 800;
 }

 .campaign-section-sub {
 margin-top: 4px;
 color: var(--muted);
 font-size: 12px;
 line-height: 1.4;
 }

 .campaign-detail-kpis {
 display: grid;
 grid-template-columns: repeat(6, minmax(0, 1fr));
 gap: 9px;
 margin-top: 16px;
 }

 .campaign-detail-kpi {
 padding: 13px;
 border: 1px solid #ebeae5;
 border-radius: 13px;
 background: #fafaf8;
 }

 .campaign-detail-value {
 margin-top: 5px;
 font-size: 18px;
 font-weight: 800;
 }

 .campaign-delta {
 margin-top: 5px;
 color: var(--muted);
 font-size: 10px;
 line-height: 1.35;
 }

 .campaign-compare-grid {
 display: grid;
 grid-template-columns: repeat(2, minmax(0, 1fr));
 gap: 10px;
 margin-top: 14px;
 }

 .campaign-creative-card {
 padding: 15px;
 border: 1px solid #e3e2dd;
 border-radius: 14px;
 background: #fff;
 }

 .campaign-creative-title {
 font-size: 14px;
 font-weight: 800;
 }

 .campaign-creative-meta {
 margin-top: 3px;
 color: var(--muted);
 font-size: 11px;
 }

 .campaign-creative-metrics {
 display: grid;
 grid-template-columns: repeat(4, minmax(0, 1fr));
 gap: 8px;
 margin-top: 12px;
 }

 .campaign-bar {
 height: 6px;
 margin-top: 12px;
 border-radius: 999px;
 background: #ecebe6;
 overflow: hidden;
 }

 .campaign-bar > span {
 display: block;
 height: 100%;
 border-radius: inherit;
 background: #111;
 }

 .campaign-table-wrap {
 margin-top: 14px;
 overflow-x: auto;
 border: 1px solid #e8e7e2;
 border-radius: 13px;
 }

 .campaign-table {
 width: 100%;
 min-width: 720px;
 border-collapse: collapse;
 font-size: 12px;
 }

 .campaign-table th,
 .campaign-table td {
 padding: 10px 11px;
 border-bottom: 1px solid #efeee9;
 text-align: right;
 white-space: nowrap;
 }

 .campaign-table th:first-child,
 .campaign-table td:first-child {
 text-align: left;
 }

 .campaign-table th {
 color: var(--muted);
 font-size: 10px;
 font-weight: 780;
 letter-spacing: .02em;
 text-transform: uppercase;
 background: #fafaf8;
 }

 .campaign-table tr:last-child td {
 border-bottom: 0;
 }

 .campaign-config-grid {
 display: grid;
 grid-template-columns: repeat(3, minmax(0, 1fr));
 gap: 10px;
 margin-top: 14px;
 }

 .campaign-config-item {
 padding: 12px 13px;
 border: 1px solid #ebeae5;
 border-radius: 12px;
 background: #fafaf8;
 }

 .campaign-config-value {
 margin-top: 4px;
 font-size: 13px;
 font-weight: 760;
 }

 .campaign-source-note {
 color: var(--muted);
 font-size: 11px;
 line-height: 1.45;
 }

 .campaign-warning-stack {
 display: grid;
 gap: 8px;
 margin-top: 14px;
 }

 .campaign-warning {
 padding: 11px 13px;
 border: 1px solid #ead7a1;
 border-radius: 12px;
 background: #fffaf0;
 color: #6d5312;
 font-size: 12px;
 line-height: 1.4;
 }

 .campaign-hierarchy {
 display: grid;
 gap: 10px;
 margin-top: 14px;
 }

 .campaign-adset {
 border: 1px solid #e5e4df;
 border-radius: 14px;
 background: #fff;
 overflow: hidden;
 }

 .campaign-adset > summary {
 list-style: none;
 cursor: pointer;
 padding: 14px 15px;
 }

 .campaign-adset > summary::-webkit-details-marker {
 display: none;
 }

 .campaign-adset-summary {
 display: grid;
 grid-template-columns: minmax(180px, 1.2fr) repeat(7, minmax(72px, .65fr));
 gap: 10px;
 align-items: center;
 }

 .campaign-entity-name {
 font-size: 14px;
 font-weight: 800;
 min-width: 0;
 }

 .campaign-entity-meta {
 margin-top: 3px;
 color: var(--muted);
 font-size: 10px;
 line-height: 1.35;
 }

 .campaign-adset-arrow {
 display: inline-block;
 margin-right: 6px;
 color: var(--muted);
 transition: transform .15s ease;
 }

 .campaign-adset[open] .campaign-adset-arrow {
 transform: rotate(90deg);
 }

 .campaign-ad-list {
 display: grid;
 gap: 8px;
 padding: 0 12px 12px;
 border-top: 1px solid #efeee9;
 background: #fafaf8;
 }

 .campaign-ad-card {
 display: grid;
 grid-template-columns: minmax(180px, 1.2fr) repeat(6, minmax(72px, .65fr));
 gap: 10px;
 align-items: center;
 padding: 12px;
 border: 1px solid #e8e7e2;
 border-radius: 12px;
 background: #fff;
 }

 .campaign-hierarchy-secondary {
 grid-column: 1 / -1;
 color: var(--muted);
 font-size: 10px;
 line-height: 1.35;
 }

 .campaign-readonly-note {
 margin-top: 12px;
 padding: 10px 12px;
 border-radius: 11px;
 background: #f6f6f3;
 color: var(--muted);
 font-size: 11px;
 line-height: 1.45;
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

 .campaign-summary-grid {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-detail-kpis {
 grid-template-columns: repeat(3, minmax(0, 1fr));
 }
 }

 @media (max-width: 760px) {
 :root {
 --nav-width: 0px;
 }

 .campaign-summary-grid,
 .campaign-list,
 .campaign-compare-grid,
 .campaign-config-grid {
 grid-template-columns: 1fr;
 }

 .campaign-detail-kpis {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-card-metrics,
 .campaign-creative-metrics {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-adset-summary,
 .campaign-ad-card {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-adset-summary > :first-child,
 .campaign-ad-card > :first-child,
 .campaign-hierarchy-secondary {
 grid-column: 1 / -1;
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
 top: 66px;
 display: flex;
 gap: 8px;
 overflow-x: auto;
 overscroll-behavior-x: contain;
 margin-left: -12px;
 margin-right: -12px;
 padding: 8px 12px 10px;
 scrollbar-width: none;
 }

 .counter-grid::-webkit-scrollbar {
 display: none;
 }

 .counter-card {
 flex: 0 0 142px;
 min-height: 92px;
 }

 .counter-grid .counter-card:last-child {
 grid-column: auto;
 }

 .section {
 scroll-margin-top: 175px;
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

 .followup-grid {
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
 flex-basis: 132px;
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
 campaigns: null,
 selectedCampaignProject: "",
 openCampaignAdsetByProject: {},
 currentView: "hoy",
 hoySearch: "",
 leadsSearch: "",
 leadsStage: "",
 leadsProject: "",
 loadingDetailId: "",
 lastHoyLoad: 0,
 lastLeadsLoad: 0,
 lastCampaignLoad: 0
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


 function sleep(ms) {
 return new Promise(
 resolve =>
 setTimeout(resolve, ms)
 );
 }


 function reportClientError(error, context = {}) {
 try {
 fetch("/api/app-log", {
 method: "POST",
 headers: {"Content-Type": "application/json", "Accept": "application/json"},
 body: JSON.stringify({
 log: {
 nivel: "ERROR",
 capa: "FRONTEND",
 accion: context.accion || "client.error",
 endpoint: context.endpoint || window.location.pathname,
 crm_lead_id: context.crm_lead_id || "",
 http_status: context.http_status || "",
 error_code: context.error_code || "",
 mensaje: String(error?.message || error || "Error frontend").slice(0, 1000),
 worker_version: APP_VERSION,
 detalle: String(error?.stack || "").slice(0, 2000)
 }
 })
 }).catch(() => {});
 } catch (_) {}
 }

 window.addEventListener("error", event => {
 reportClientError(event.error || event.message, {accion: "window.error"});
 });

 window.addEventListener("unhandledrejection", event => {
 reportClientError(event.reason || "Promise rechazada", {accion: "unhandledrejection"});
 });

 async function api(path, options = {}) {
 const method =
 String(
 options.method || "GET"
 ).toUpperCase();

 const attempts =
 method === "GET"
 ? 2
 : 1;

 let lastError = null;

 for (
 let attempt = 1;
 attempt <= attempts;
 attempt++
 ) {
 try {
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


 let data;

 try {
 data =
 await response.json();
 } catch {
 const invalid =
 new Error(
 "El servidor devolvió una respuesta inválida."
 );

 invalid.retryable =
 response.status >= 500;

 throw invalid;
 }


 if (!data.ok) {
 const apiError =
 new Error(
 data.error ||
 "Error API"
 );

 apiError.retryable =
 response.status === 502 ||
 response.status === 503 ||
 response.status === 504 ||
 String(
 data.error || ""
 ).includes(
 "Apps Script devolvió una respuesta inválida"
 );

 throw apiError;
 }


 return data.data;

 } catch (error) {
 lastError = error;

 const canRetry =
 method === "GET" &&
 attempt < attempts &&
 (
 error.retryable === true ||
 error.name === "TypeError"
 );

 if (!canRetry) {
 if (path !== "/api/app-log") {
 reportClientError(error, {
 accion: "api.request",
 endpoint: path,
 http_status: error.httpStatus || ""
 });
 }
 throw error;
 }

 await sleep(500);
 }
 }


 throw (
 lastError ||
 new Error(
 "Error API"
 )
 );
 }


 function normalized(value) {
 return String(value || "")
 .trim()
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\\u0300-\\u036f]/g, "");
 }


 function formatTimeMx(hours, minutes) {
 const h = Number(hours);
 const m = Number(minutes);

 if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
 return "";
 }

 return new Intl.DateTimeFormat(
 "es-MX",
 {
 hour: "numeric",
 minute: "2-digit"
 }
 ).format(new Date(2000, 0, 1, h, m));
 }


 function formatDateValue(value, includeTime = false) {
 if (!value) {
 return "";
 }

 const text = String(value).trim();

 let match =
 text.match(
 /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})(?:[ T]+(\\d{1,2}):(\\d{2})(?::\\d{2})?)?/
 );

 if (match) {
 const day = String(match[1]).padStart(2, "0");
 const month = String(match[2]).padStart(2, "0");
 const year = match[3];
 const time =
 includeTime && match[4] && !(match[4] === "00" && match[5] === "00")
 ? " · " + formatTimeMx(match[4], match[5])
 : "";

 return day + "/" + month + "/" + year + time;
 }

 match =
 text.match(
 /^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::\\d{2})?)?/
 );

 if (match) {
 const year = match[1];
 const month = match[2];
 const day = match[3];
 const time =
 includeTime && match[4] && !(match[4] === "00" && match[5] === "00")
 ? " · " + formatTimeMx(match[4], match[5])
 : "";

 return day + "/" + month + "/" + year + time;
 }

 const date = new Date(text);

 if (Number.isNaN(date.getTime())) {
 return text;
 }

 return new Intl.DateTimeFormat(
 "es-MX",
 includeTime
 ? {day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit"}
 : {day: "2-digit", month: "2-digit", year: "numeric"}
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
 await renderCampanas();
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
 if (
 state.hoy &&
 !force
 ) {
 return state.hoy;
 }

 state.hoy =
 await api(
 "/api/hoy"
 );

 if (!state.hoy || typeof state.hoy !== "object") {
 throw new Error("El servidor no devolvió una agenda válida.");
 }

 state.lastHoyLoad =
 Date.now();

 return state.hoy;
 }


 async function loadLeads(force) {
 if (
 state.leads &&
 !force
 ) {
 return state.leads;
 }

 state.leads =
 await api(
 "/api/leads?limit=500"
 );

 if (!state.leads || typeof state.leads !== "object" || !Array.isArray(state.leads.leads)) {
 throw new Error("El servidor no devolvió una lista de leads válida.");
 }

 if (!Number.isFinite(Number(state.leads.total))) {
 state.leads.total = state.leads.leads.length;
 }

 state.lastLeadsLoad =
 Date.now();

 return state.leads;
 }


 async function loadCampaigns(force) {
 const now = Date.now();
 if (
 state.campaigns &&
 !force &&
 state.lastCampaignLoad &&
 now - state.lastCampaignLoad < 60 * 1000
 ) {
 return state.campaigns;
 }

 state.campaigns =
 await api(
 "/api/campaigns"
 );

 if (
 !state.campaigns ||
 typeof state.campaigns !== "object" ||
 !Array.isArray(state.campaigns.campaigns)
 ) {
 throw new Error(
 "El servidor no devolvió métricas de campañas válidas."
 );
 }

 state.lastCampaignLoad =
 Date.now();

 return state.campaigns;
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
 "Operativo"
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
 lead.campana_nombre ||
 lead.proyecto,
 lead.anuncio_nombre ||
 lead.formato,
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


 async function renderHoy(force, silent) {
 let content = document.getElementById("content");

 if (!silent) {
 content = clearContent();
 content.className = "loading";
 content.textContent = "Cargando Hoy...";
 }

 try {
 const hoy =
 await loadHoy(
 !!force
 );

 // Si el usuario cambió de vista mientras llegaban los datos, no pisamos la pantalla actual.
 const routeNow = parseRoute();
 if (silent && (routeNow.type !== "view" || routeNow.view !== "hoy")) return;

 content = document.getElementById("content");
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

 if (!filtered.length) {
 return;
 }

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


 async function renderLeads(force, silent) {
 let content = document.getElementById("content");

 if (!silent) {
 content = clearContent();
 content.className = "loading";
 content.textContent = "Cargando leads...";
 }

 try {
 const list =
 await loadLeads(
 !!force
 );

 const routeNow = parseRoute();
 if (silent && (routeNow.type !== "view" || routeNow.view !== "leads")) return;

 content = document.getElementById("content");
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


 function parseLeadDateParts(value) {
 const empty = {
 date: "",
 time: ""
 };


 if (!value) {
 return empty;
 }


 const text =
 String(value).trim();


 let match =
 text.match(
 /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?$/
 );


 if (match) {
 return {
 date:
 match[3] +
 "-" +
 String(match[2]).padStart(2, "0") +
 "-" +
 String(match[1]).padStart(2, "0"),

 time:
 match[4]
 ? String(match[4]).padStart(2, "0") +
 ":" +
 match[5]
 : ""
 };
 }


 match =
 text.match(
 /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/
 );


 if (match) {
 return {
 date:
 match[1] +
 "-" +
 match[2] +
 "-" +
 match[3],

 time:
 match[4] === "00" &&
 match[5] === "00"
 ? ""
 : match[4] +
 ":" +
 match[5]
 };
 }


 match =
 text.match(
 /^(\\d{4})-(\\d{2})-(\\d{2})$/
 );


 if (match) {
 return {
 date:
 text,

 time:
 ""
 };
 }


 return empty;
 }


 function formatMxDateInput(value) {
 const parts = parseLeadDateParts(value);

 if (!parts.date) {
 return "";
 }

 const match = parts.date.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);

 if (!match) {
 return "";
 }

 return match[3] + "/" + match[2] + "/" + match[1];
 }


 function parseMxDateInput(value) {
 const text = String(value || "").trim();
 if (!text) return "";

 let day;
 let month;
 let year;

 const compact = text.replace(/\\D/g, "");
 const slashMatch = text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);

 if (/^\\d{8}$/.test(compact) && text.indexOf("/") === -1) {
 day = Number(compact.slice(0, 2));
 month = Number(compact.slice(2, 4));
 year = Number(compact.slice(4, 8));
 } else if (slashMatch) {
 day = Number(slashMatch[1]);
 month = Number(slashMatch[2]);
 year = Number(slashMatch[3]);
 } else {
 return "";
 }

 if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1000 || year > 9999) {
 return "";
 }

 const date = new Date(year, month - 1, day, 12, 0, 0);

 if (
 date.getFullYear() !== year ||
 date.getMonth() !== month - 1 ||
 date.getDate() !== day
 ) {
 return "";
 }

 return (
 String(year).padStart(4, "0") +
 "-" +
 String(month).padStart(2, "0") +
 "-" +
 String(day).padStart(2, "0")
 );
 }


 function mxDateDisplayFromIso(isoDate) {
 const match = String(isoDate || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
 if (!match) return "";
 return match[3] + "/" + match[2] + "/" + match[1];
 }


 function apiLocalDateValue(dateIso) {
 const match = String(dateIso || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
 return match ? dateIso : "";
 }


 function apiLocalDateTimeValue(dateIso, timeValue) {
 const validDate = apiLocalDateValue(dateIso);
 const normalizedTime = parseMxTimeInput(timeValue);
 if (!validDate || !normalizedTime) return "";
 return validDate + "T" + normalizedTime;
 }


 function normalizeMxDateField(input) {
 const raw = String(input.value || "").trim();
 if (!raw) {
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 return "";
 }

 const iso = parseMxDateInput(raw);
 if (!iso) {
 input.classList.add("input-invalid");
 input.title = "Fecha inválida. Use DD/MM/AAAA.";
 return "";
 }

 input.value = mxDateDisplayFromIso(iso);
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 return iso;
 }


 function configureMxDateInput(input, value) {
 input.type = "text";
 input.inputMode = "numeric";
 input.autocomplete = "off";
 input.placeholder = "DD/MM/AAAA";
 input.maxLength = 10;
 input.value = formatMxDateInput(value);
 input.setAttribute("aria-label", "Fecha en formato DD/MM/AAAA");

 input.addEventListener("input", function() {
 const original = String(input.value || "");
 const cleaned = original.replace(/[^0-9/]/g, "").slice(0, 10);
 if (cleaned !== original) input.value = cleaned;
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 });

 input.addEventListener("blur", function() {
 normalizeMxDateField(input);
 });

 return input;
 }


 function createMxDateControl(value) {
 const root = element("div", "mx-date-control");
 const input = element("input", "form-control mx-date-text");
 configureMxDateInput(input, value);

 const pickerWrap = element("div", "mx-date-picker-wrap");
 pickerWrap.setAttribute("aria-label", "Abrir calendario");
 const picker = element("input", "mx-date-picker");
 picker.type = "date";
 const initial = parseLeadDateParts(value).date;
 picker.value = initial || "";

 picker.addEventListener("change", function() {
 if (!picker.value) return;
 input.value = mxDateDisplayFromIso(picker.value);
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 });

 input.addEventListener("blur", function() {
 const iso = parseMxDateInput(input.value);
 if (iso) picker.value = iso;
 });

 pickerWrap.appendChild(picker);
 root.append(input, pickerWrap);
 return {root, input, picker};
 }


 function parseMxTimeInput(value) {
 const text = String(value || "").trim().toUpperCase();
 if (!text) return "";

 let hour;
 let minute;
 let suffix = "";
 const compact = text.replace(/\\s+/g, "");
 let match = compact.match(/^(\\d{1,2}):(\\d{2})(AM|PM)?$/);

 if (match) {
 hour = Number(match[1]);
 minute = Number(match[2]);
 suffix = match[3] || "";
 } else {
 match = compact.match(/^(\\d{1,2})(AM|PM)$/);
 if (match) {
 hour = Number(match[1]);
 minute = 0;
 suffix = match[2];
 } else if (/^\\d{3,4}$/.test(compact)) {
 hour = Number(compact.slice(0, -2));
 minute = Number(compact.slice(-2));
 } else {
 return "";
 }
 }

 if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";

 if (suffix) {
 if (hour < 1 || hour > 12) return "";
 if (suffix === "AM" && hour === 12) hour = 0;
 if (suffix === "PM" && hour !== 12) hour += 12;
 } else if (hour < 0 || hour > 23) {
 return "";
 }

 return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
 }


 function mxTimeDisplayFrom24(value) {
 const normalized = parseMxTimeInput(value);
 if (!normalized) return "";
 const match = normalized.match(/^(\\d{2}):(\\d{2})$/);
 let hour = Number(match[1]);
 const minute = match[2];
 const suffix = hour >= 12 ? "PM" : "AM";
 hour = hour % 12 || 12;
 return String(hour).padStart(2, "0") + ":" + minute + " " + suffix;
 }


 function normalizeMxTimeField(input) {
 const raw = String(input.value || "").trim();
 if (!raw) {
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 return "";
 }
 const normalized = parseMxTimeInput(raw);
 if (!normalized) {
 input.classList.add("input-invalid");
 input.title = "Hora inválida. Use HHMM, HH:MM o seleccione el reloj.";
 return "";
 }
 input.value = mxTimeDisplayFrom24(normalized);
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 return normalized;
 }


 function configureMxTimeInput(input, value) {
 input.type = "text";
 input.inputMode = "text";
 input.autocomplete = "off";
 input.placeholder = "HHMM";
 input.maxLength = 10;
 input.value = mxTimeDisplayFrom24(value);
 input.setAttribute("aria-label", "Hora. Puede escribir 1800 para 6:00 PM.");
 input.addEventListener("input", function() {
 const original = String(input.value || "");
 const cleaned = original.replace(/[^0-9:apmAPM ]/g, "").slice(0, 10);
 if (cleaned !== original) input.value = cleaned;
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 });
 input.addEventListener("blur", function() { normalizeMxTimeField(input); });
 return input;
 }


 function createMxTimeControl(value) {
 const root = element("div", "mx-time-control");
 const input = element("input", "form-control mx-time-text");
 configureMxTimeInput(input, value);
 const pickerWrap = element("div", "mx-time-picker-wrap");
 pickerWrap.setAttribute("aria-label", "Abrir selector de hora");
 const picker = element("input", "mx-time-picker");
 picker.type = "time";
 const initial = parseMxTimeInput(value);
 picker.value = initial || "";
 const syncFromPicker = function() {
 const normalized = parseMxTimeInput(picker.value);
 if (!normalized) return;
 input.value = mxTimeDisplayFrom24(normalized);
 input.classList.remove("input-invalid");
 input.removeAttribute("title");
 };
 picker.addEventListener("input", syncFromPicker);
 picker.addEventListener("change", syncFromPicker);
 input.addEventListener("blur", function() {
 const normalized = parseMxTimeInput(input.value);
 if (normalized) picker.value = normalized;
 });
 pickerWrap.appendChild(picker);
 root.append(input, pickerWrap);
 return {root, input, picker};
 }


 function localDateTimeFromIso(dateIso, timeValue) {
 const dateMatch = String(dateIso || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
 const normalizedTime = parseMxTimeInput(timeValue);
 const timeMatch = normalizedTime.match(/^(\\d{2}):(\\d{2})$/);
 if (!dateMatch || !timeMatch) return null;
 const date = new Date(
 Number(dateMatch[1]),
 Number(dateMatch[2]) - 1,
 Number(dateMatch[3]),
 Number(timeMatch[1]),
 Number(timeMatch[2]),
 0,
 0
 );
 return isNaN(date.getTime()) ? null : date;
 }


 function localApiDateTime(date) {
 if (!(date instanceof Date) || isNaN(date.getTime())) return "";
 const dateIso =
 String(date.getFullYear()).padStart(4, "0") + "-" +
 String(date.getMonth() + 1).padStart(2, "0") + "-" +
 String(date.getDate()).padStart(2, "0");
 const time24 =
 String(date.getHours()).padStart(2, "0") + ":" +
 String(date.getMinutes()).padStart(2, "0");
 return apiLocalDateTimeValue(dateIso, time24);
 }


 function confirmationDateTime(mode, appointmentDateIso, appointmentTime, customDateValue, customTimeValue) {
 const appointment = localDateTimeFromIso(appointmentDateIso, appointmentTime);
 if (!appointment) return "";

 let reminder;

 if (mode === "24h") {
 reminder = new Date(appointment.getTime() - 24 * 60 * 60 * 1000);
 } else if (mode === "morning") {
 reminder = new Date(
 appointment.getFullYear(),
 appointment.getMonth(),
 appointment.getDate(),
 9,
 0,
 0,
 0
 );
 } else if (mode === "custom") {
 const customDateIso = parseMxDateInput(customDateValue);
 reminder = localDateTimeFromIso(customDateIso, customTimeValue);
 }

 if (!reminder || isNaN(reminder.getTime())) return "";
 if (reminder.getTime() >= appointment.getTime()) return "";
 return localApiDateTime(reminder);
 }


 function fillSelectOptions(
 select,
 options,
 currentValue,
 includeBlank,
 blankLabel
 ) {
 select.replaceChildren();


 if (includeBlank) {
 const blank =
 element(
 "option",
 "",
 blankLabel || "Sin seleccionar"
 );

 blank.value = "";

 select.appendChild(
 blank
 );
 }


 const list =
 Array.isArray(options)
 ? options
 : [];


 list.forEach(
 function(option) {
 const item =
 element(
 "option",
 "",
 option.nombre
 );

 item.value =
 option.nombre;

 item.dataset.codigo =
 option.codigo || "";

 if (
 option.nombre ===
 currentValue
 ) {
 item.selected =
 true;
 }

 select.appendChild(
 item
 );
 }
 );


 if (
 currentValue &&
 !Array.from(
 select.options
 ).some(
 option =>
 option.value ===
 currentValue
 )
 ) {
 const legacy =
 element(
 "option",
 "",
 currentValue +
 " (actual)"
 );

 legacy.value =
 currentValue;

 legacy.selected =
 true;

 select.appendChild(
 legacy
 );
 }
 }


 function selectedOptionCode(
 select
 ) {
 const option =
 select.options[
 select.selectedIndex
 ];

 return option
 ? String(
 option.dataset.codigo || ""
 )
 : "";
 }


 function makeOperationEditor(lead, options, crmLeadId, fromView) {
 const wrap = element("div", "operation-summary");

 addEditableInfoRow(
 wrap,
 "Etapa",
 lead.etapa || "Sin etapa",
 "",
 function() { openStagePopover(lead, options, crmLeadId, fromView); }
 );

 const priorityText = lead.prioridad_efectiva || "Sin prioridad";
 const prioritySub = [lead.prioridad_modo, lead.prioridad_motivo].filter(Boolean).join(" · ");
 addEditableInfoRow(
 wrap,
 "Prioridad",
 priorityText,
 prioritySub,
 function() { openPriorityPopover(lead, options, crmLeadId, fromView); }
 );

 const followupText = lead.proximo_seguimiento
 ? formatDateValue(lead.proximo_seguimiento, true)
 : "Sin seguimiento";
 const followupSub = [lead.seguimiento_actividad, lead.seguimiento_nota].filter(Boolean).join(" · ");
 addEditableInfoRow(
 wrap,
 "Próximo seguimiento",
 followupText,
 followupSub,
 function() { openFollowupPopover(lead, options, crmLeadId, fromView); }
 );

 return wrap;
 }

 function addEditableInfoRow(card, label, value, subtitle, onEdit) {
 const row = element("div", "editable-info-row");
 row.appendChild(element("div", "info-label", label));

 const valueWrap = element("div", "editable-value-wrap");
 valueWrap.appendChild(element("div", "info-value", value || "—"));
 if (subtitle) valueWrap.appendChild(element("div", "editable-subtitle", subtitle));
 row.appendChild(valueWrap);

 const edit = element("button", "edit-link", "Editar");
 edit.type = "button";
 edit.addEventListener("click", onEdit);
 row.appendChild(edit);
 card.appendChild(row);
 }

 function openPopover(title) {
 const backdrop = element("div", "popover-backdrop");
 const panel = element("div", "popover-panel");
 const head = element("div", "popover-head");
 head.appendChild(element("div", "popover-title", title));
 const close = element("button", "popover-close", "×");
 close.type = "button";
 head.appendChild(close);
 const body = element("div", "popover-body");
 panel.append(head, body);
 backdrop.appendChild(panel);
 document.body.appendChild(backdrop);

 let keyHandler;
 const dismiss = function() {
 document.removeEventListener("keydown", keyHandler);
 backdrop.remove();
 };
 close.addEventListener("click", dismiss);
 backdrop.addEventListener("click", event => {
 if (event.target === backdrop) dismiss();
 });
 keyHandler = event => { if (event.key === "Escape") dismiss(); };
 document.addEventListener("keydown", keyHandler);
 return {backdrop, panel, body, dismiss};
 }

 function popoverField(label, control) {
 const field = element("div", "form-field");
 field.appendChild(element("div", "form-label", label));
 field.appendChild(control);
 return field;
 }

 function popoverActions(pop, onSave, label = "Guardar") {
 const status = element("div", "save-status");
 const actions = element("div", "popover-actions");
 const cancel = element("button", "secondary-button", "Cancelar");
 cancel.type = "button";
 cancel.addEventListener("click", pop.dismiss);
 const save = element("button", "save-button", label);
 save.type = "button";
 save.addEventListener("click", async function() {
 status.className = "save-status";
 status.textContent = "";
 save.disabled = true;
 cancel.disabled = true;
 try {
 await onSave();
 pop.dismiss();
 } catch (error) {
 save.disabled = false;
 cancel.disabled = false;
 status.className = "save-status error";
 status.textContent = error.message || "No se pudo guardar.";
 }
 });
 actions.append(cancel, save);
 pop.body.append(actions, status);
 }

 async function saveLeadPatch(lead, crmLeadId, fromView, changes) {
 await api("/api/leads/" + encodeURIComponent(crmLeadId), {
 method: "PATCH",
 headers: {"Content-Type": "application/json"},
 body: JSON.stringify({expected_version: lead.operational_version, changes})
 });
 state.hoy = null;
 state.leads = null;
 state.lastHoyLoad = 0;
 state.lastLeadsLoad = 0;
 await renderLeadDetail(crmLeadId, fromView);
 }

 function makeDiscardControls(lead, options) {
 const box = element("div", "discard-box");
 const select = element("select", "form-control");
 fillSelectOptions(select, options.motivos_descarte, lead.motivo_descarte, true, "Seleccione un motivo");
 box.appendChild(popoverField("Motivo de descarte", select));

 const warning = element("div", "phone-warning");
 warning.appendChild(element("div", "phone-warning-title", "Revise el número antes de descartar"));
 warning.appendChild(element("div", "phone-warning-line", "Original: " + (lead.telefono_original || "Sin dato")));
 warning.appendChild(element("div", "phone-warning-line", "Normalizado: " + (lead.telefono_normalizado || lead.telefono || "Sin dato")));
 warning.appendChild(element("div", "phone-warning-line", "País: " + (lead.pais_telefono || "Sin dato")));
 const label = element("label", "confirm-line");
 const confirm = element("input");
 confirm.type = "checkbox";
 label.append(confirm, document.createTextNode("Confirmo que revisé el teléfono original y que el número es erróneo."));
 warning.appendChild(label);
 box.appendChild(warning);

 const sync = function(show) {
 box.classList.toggle("visible", show);
 const phone = show && selectedOptionCode(select) === "NUMERO_ERRONEO";
 warning.classList.toggle("visible", phone);
 if (!phone) confirm.checked = false;
 };
 select.addEventListener("change", () => sync(box.classList.contains("visible")));
 return {box, select, confirm, sync};
 }

 function openStagePopover(lead, options, crmLeadId, fromView) {
 const pop = openPopover("Cambiar etapa");
 const select = element("select", "form-control");
 fillSelectOptions(select, options.etapas, lead.etapa, false, "");
 pop.body.appendChild(popoverField("Etapa", select));

 const discard = makeDiscardControls(lead, options);
 pop.body.appendChild(discard.box);

 const appointmentDateControl = createMxDateControl(lead.fecha_cita);
 const appointmentDate = appointmentDateControl.input;
 const aptParts = parseLeadDateParts(lead.fecha_cita);
 const appointmentTimeControl = createMxTimeControl(aptParts.time);
 const appointmentTime = appointmentTimeControl.input;
 const aptGrid = element("div", "followup-grid");
 aptGrid.append(appointmentDateControl.root, appointmentTimeControl.root);
 const aptField = popoverField("Fecha y hora de la cita", aptGrid);
 aptField.style.display = "none";
 pop.body.appendChild(aptField);

 const confirmBox = element("div", "confirm-box");
 const confirmMode = element("select", "form-control");
 [
 ["24h", "24 horas antes (recomendado)"],
 ["morning", "El mismo día a las 9:00 a.m."],
 ["custom", "Elegir fecha y hora"]
 ].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 confirmMode.appendChild(option);
 });
 confirmBox.appendChild(popoverField("Cuándo confirmar la cita", confirmMode));

 const confirmChannel = element("select", "form-control");
 ["WhatsApp / Mensaje", "Llamada"].forEach(function(name) {
 const option = element("option", "", name);
 option.value = name;
 confirmChannel.appendChild(option);
 });
 confirmBox.appendChild(popoverField("Cómo la vas a confirmar", confirmChannel));

 const customConfirmDateControl = createMxDateControl("");
 const customConfirmDate = customConfirmDateControl.input;
 const customConfirmTimeControl = createMxTimeControl("");
 const customConfirmTime = customConfirmTimeControl.input;
 const customConfirmGrid = element("div", "followup-grid");
 customConfirmGrid.append(customConfirmDateControl.root, customConfirmTimeControl.root);
 const customConfirmField = popoverField("Fecha y hora de confirmación", customConfirmGrid);
 customConfirmField.style.display = "none";
 confirmBox.appendChild(customConfirmField);

 const confirmSummary = element("div", "confirm-summary",
 "Se guardará como Próximo seguimiento. Confirmar la cita no cambia la etapa ni envía otro evento CAPI.");
 confirmBox.appendChild(confirmSummary);
 confirmBox.style.display = "none";
 pop.body.appendChild(confirmBox);

 const syncConfirmMode = function() {
 customConfirmField.style.display = confirmMode.value === "custom" ? "grid" : "none";
 };
 confirmMode.addEventListener("change", syncConfirmMode);
 syncConfirmMode();

 const stageFollowupBox = element("div", "confirm-box");
 const stageFollowupParts = parseLeadDateParts(lead.proximo_seguimiento);
 const stageFollowupDateControl = createMxDateControl(lead.proximo_seguimiento);
 const stageFollowupDate = stageFollowupDateControl.input;
 const stageFollowupTimeControl = createMxTimeControl(stageFollowupParts.time);
 const stageFollowupTime = stageFollowupTimeControl.input;
 const stageFollowupGrid = element("div", "followup-grid");
 stageFollowupGrid.append(stageFollowupDateControl.root, stageFollowupTimeControl.root);
 stageFollowupBox.appendChild(popoverField("Próximo seguimiento · fecha y hora", stageFollowupGrid));
 stageFollowupBox.appendChild(element("div", "confirm-summary",
 "Obligatorio al cambiar a esta etapa. Después puede editarlo desde la ficha del lead."));
 stageFollowupBox.style.display = "none";
 pop.body.appendChild(stageFollowupBox);

 const valueInput = element("input", "form-control");
 valueInput.type = "number";
 valueInput.min = "1";
 valueInput.step = "1";
 valueInput.value = lead.valor_operacion || "";
 const valueField = popoverField("Valor de operación", valueInput);
 valueField.style.display = "none";
 pop.body.appendChild(valueField);

 const sync = function() {
 const stage = normalized(select.value);
 const needsGenericFollowup = stage !== "no responde" && stage !== "descartado" && stage !== "cita agendada";
 discard.sync(stage === "descartado");
 aptField.style.display = stage === "cita agendada" ? "grid" : "none";
 confirmBox.style.display = stage === "cita agendada" ? "grid" : "none";
 stageFollowupBox.style.display = needsGenericFollowup ? "grid" : "none";
 valueField.style.display = stage === "compra" ? "grid" : "none";
 };
 select.addEventListener("change", sync);
 sync();

 popoverActions(pop, async function() {
 const changes = {etapa: select.value};
 const stage = normalized(select.value);
 if (stage === "descartado") {
 if (!discard.select.value) throw new Error("Seleccione un motivo de descarte.");
 changes.motivo_descarte = discard.select.value;
 if (selectedOptionCode(discard.select) === "NUMERO_ERRONEO") {
 if (!discard.confirm.checked) throw new Error("Revise y confirme el teléfono original.");
 changes.confirmar_numero_erroneo = true;
 }
 }
 if (stage === "no responde" || stage === "descartado") {
 // Estas etapas no deben conservar tareas futuras.
 changes.proximo_seguimiento = "";
 changes.seguimiento_actividad = "";
 changes.seguimiento_nota = "";
 } else if (stage !== "cita agendada") {
 const stageFollowupDateValue = parseMxDateInput(stageFollowupDate.value);
 if (!stageFollowupDateValue) throw new Error("Capture la fecha del próximo seguimiento. Puede escribir 8 dígitos, por ejemplo 27092026.");
 stageFollowupDate.value = mxDateDisplayFromIso(stageFollowupDateValue);
 const stageFollowupTimeValue = parseMxTimeInput(stageFollowupTime.value);
 if (!stageFollowupTimeValue) throw new Error("Capture la hora del próximo seguimiento. Puede escribir 1800 para 6:00 PM o usar el reloj.");
 stageFollowupTime.value = mxTimeDisplayFrom24(stageFollowupTimeValue);
 changes.proximo_seguimiento = apiLocalDateTimeValue(stageFollowupDateValue, stageFollowupTimeValue);
 }
 if (stage === "cita agendada") {
 const appointmentDateValue = parseMxDateInput(appointmentDate.value);
 if (!appointmentDateValue) throw new Error("Capture una fecha válida en formato DD/MM/AAAA. También puede escribir 8 dígitos, por ejemplo 02102026.");
 appointmentDate.value = mxDateDisplayFromIso(appointmentDateValue);
 const appointmentTimeValue = parseMxTimeInput(appointmentTime.value);
 if (!appointmentTimeValue) throw new Error("Capture una hora válida. Puede escribir 1800 para 6:00 PM o usar el reloj.");
 appointmentTime.value = mxTimeDisplayFrom24(appointmentTimeValue);
 const appointmentApiValue = apiLocalDateTimeValue(appointmentDateValue, appointmentTimeValue);
 if (!appointmentApiValue) throw new Error("No se pudo preparar la fecha y hora de la cita.");
 changes.fecha_cita = appointmentApiValue;

 const reminder = confirmationDateTime(
 confirmMode.value,
 appointmentDateValue,
 appointmentTimeValue,
 customConfirmDate.value,
 customConfirmTime.value
 );

 if (!reminder) {
 throw new Error("La confirmación debe tener una fecha y hora válidas anteriores a la cita.");
 }

 changes.proximo_seguimiento = reminder;
 changes.seguimiento_actividad = confirmChannel.value;
 changes.seguimiento_nota =
 "Confirmar cita del " +
 mxDateDisplayFromIso(appointmentDateValue) +
 " a las " +
 mxTimeDisplayFrom24(appointmentTimeValue) +
 ".";
 }
 if (stage === "compra") {
 if (!(Number(valueInput.value) > 0)) throw new Error("Capture el valor de operación.");
 changes.valor_operacion = Number(valueInput.value);
 }
 await saveLeadPatch(lead, crmLeadId, fromView, changes);
 });
 }

 function openPriorityPopover(lead, options, crmLeadId, fromView) {
 const pop = openPopover("Cambiar prioridad");
 const select = element("select", "form-control");
 const automatic = element("option", "", "Automática");
 automatic.value = "";
 select.appendChild(automatic);
 (options.prioridades || []).forEach(function(option) {
 const item = element("option", "", option.nombre);
 item.value = option.nombre;
 if (option.nombre === lead.prioridad) item.selected = true;
 select.appendChild(item);
 });
 if (!lead.prioridad) automatic.selected = true;
 pop.body.appendChild(popoverField("Prioridad", select));
 pop.body.appendChild(element("div", "popover-help", "Automática se recalcula con el tiempo. Una prioridad manual permanece hasta que vuelva a seleccionar Automática."));
 popoverActions(pop, async function() {
 await saveLeadPatch(lead, crmLeadId, fromView, {prioridad: select.value});
 });
 }

 function openFollowupPopover(lead, options, crmLeadId, fromView) {
 const pop = openPopover("Programar seguimiento");
 const parts = parseLeadDateParts(lead.proximo_seguimiento);
 const dateControl = createMxDateControl(lead.proximo_seguimiento);
 const date = dateControl.input;
 const timeControl = createMxTimeControl(parts.time);
 const time = timeControl.input;
 const grid = element("div", "followup-grid");
 grid.append(dateControl.root, timeControl.root);
 pop.body.appendChild(popoverField("Fecha y hora", grid));

 const activity = element("select", "form-control");
 const blank = element("option", "", "Seleccione una actividad");
 blank.value = "";
 activity.appendChild(blank);
 (options.actividades_seguimiento || []).forEach(function(option) {
 const item = element("option", "", option.nombre);
 item.value = option.nombre;
 item.dataset.codigo = option.codigo || "";
 item.dataset.etapa = option.etapa_relacionada || "";
 if (option.nombre === lead.seguimiento_actividad) item.selected = true;
 activity.appendChild(item);
 });
 pop.body.appendChild(popoverField("Qué se va a hacer", activity));

 const note = element("textarea", "form-control form-textarea");
 note.placeholder = "Ej. Mandarle precios y preguntarle si quiere visitar el proyecto.";
 note.value = lead.seguimiento_nota || "";
 pop.body.appendChild(popoverField("Nota / antecedente", note));

 const stageBox = element("div", "stage-link-box");
 const stageText = element("div", "", "");
 const stageLabel = element("label", "confirm-line");
 const stageCheck = element("input");
 stageCheck.type = "checkbox";
 stageLabel.append(stageCheck, document.createTextNode(" Sí, cambiar también la etapa"));
 stageBox.append(stageText, stageLabel);
 pop.body.appendChild(stageBox);

 const valueInput = element("input", "form-control");
 valueInput.type = "number";
 valueInput.min = "1";
 valueInput.step = "1";
 valueInput.value = lead.valor_operacion || "";
 const valueField = popoverField("Valor de operación", valueInput);
 valueField.classList.add("value-money");
 pop.body.appendChild(valueField);

 const syncStage = function() {
 const selected = activity.options[activity.selectedIndex];
 const linked = selected ? String(selected.dataset.etapa || "") : "";
 stageBox.classList.toggle("visible", !!linked);
 stageText.textContent = linked ? "Esta actividad corresponde a la etapa “" + linked + "”. ¿Quiere cambiar también la etapa del lead?" : "";
 if (!linked) stageCheck.checked = false;
 const purchase = linked === "Compra" && stageCheck.checked;
 valueField.classList.toggle("visible", purchase);
 };
 activity.addEventListener("change", syncStage);
 stageCheck.addEventListener("change", syncStage);
 syncStage();

 popoverActions(pop, async function() {
 const followupDateValue = parseMxDateInput(date.value);
 if (!followupDateValue) throw new Error("Capture una fecha válida en formato DD/MM/AAAA. También puede escribir 8 dígitos, por ejemplo 02102026.");
 date.value = mxDateDisplayFromIso(followupDateValue);
 if (!activity.value) throw new Error("Seleccione qué se va a hacer.");
 const selected = activity.options[activity.selectedIndex];
 const code = selected ? String(selected.dataset.codigo || "") : "";
 const linked = selected ? String(selected.dataset.etapa || "") : "";
 if (code === "OTRO" && !note.value.trim()) throw new Error("Para Otro, indique qué se va a hacer.");

 const followupTimeValue = time.value ? parseMxTimeInput(time.value) : "";
 if (time.value && !followupTimeValue) throw new Error("Capture una hora válida. Puede escribir 1800 para 6:00 PM o usar el reloj.");
 if (followupTimeValue) time.value = mxTimeDisplayFrom24(followupTimeValue);
 const followup = followupTimeValue
 ? apiLocalDateTimeValue(followupDateValue, followupTimeValue)
 : apiLocalDateValue(followupDateValue);
 const changes = {
 proximo_seguimiento: followup,
 seguimiento_actividad: activity.value,
 seguimiento_nota: note.value.trim()
 };

 if (linked && stageCheck.checked) {
 changes.etapa = linked;
 if (linked === "Cita agendada") {
 if (!followupTimeValue) throw new Error("Una cita requiere hora.");
 const appointmentApiValue = apiLocalDateTimeValue(followupDateValue, followupTimeValue);
 if (!appointmentApiValue) throw new Error("No se pudo preparar la fecha y hora de la cita.");
 changes.fecha_cita = appointmentApiValue;
 }
 if (linked === "Compra") {
 if (!(Number(valueInput.value) > 0)) throw new Error("Capture el valor de operación.");
 changes.valor_operacion = Number(valueInput.value);
 }
 }

 await saveLeadPatch(lead, crmLeadId, fromView, changes);
 }, "Programar");
 }

 function openNamePopover(lead, crmLeadId, fromView) {
 const pop = openPopover("Editar nombre");
 const input = element("input", "form-control");
 input.type = "text";
 input.value = lead.nombre || "";
 pop.body.appendChild(popoverField("Nombre", input));
 popoverActions(pop, async function() {
 const value = input.value.trim();
 if (!value) throw new Error("El nombre no puede quedar vacío.");
 await saveLeadPatch(lead, crmLeadId, fromView, {nombre: value});
 });
 setTimeout(() => input.focus(), 20);
 }

 function openNotePopover(lead, crmLeadId, fromView) {
 const pop = openPopover("Agregar nota");
 const textarea = element("textarea", "form-control form-textarea");
 textarea.placeholder = "Escriba el antecedente que quiere conservar en el historial.";
 pop.body.appendChild(popoverField("Nota", textarea));
 popoverActions(pop, async function() {
 const nota = textarea.value.trim();
 if (!nota) throw new Error("Escriba una nota.");
 await api("/api/leads/" + encodeURIComponent(crmLeadId) + "/notes", {
 method: "POST",
 headers: {"Content-Type": "application/json"},
 body: JSON.stringify({nota})
 });
 await renderLeadDetail(crmLeadId, fromView);
 }, "Agregar");
 setTimeout(() => textarea.focus(), 20);
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

 if (!data || typeof data !== "object" || !data.lead) {
 throw new Error("El servidor no devolvió el detalle del lead.");
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
 " Volver"
 );

 back.type =
 "button";

 back.addEventListener(
 "click",
 function() {
 navigate(
 fromView ||
 "leads"
 );
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
 lead.prioridad_efectiva ? (lead.prioridad_efectiva + " · " + (lead.prioridad_modo || "")) : "",
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

 addEditableInfoRow(
 contact,
 "Nombre",
 lead.nombre || "Sin nombre",
 "",
 function() {
 openNamePopover(lead, crmLeadId, fromView);
 }
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
 "Operación",
 false
 );


 pipeline.appendChild(
 makeOperationEditor(
 lead,
 data.opciones_operativas || {},
 crmLeadId,
 fromView
 )
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
 "Cita",
 formatDateValue(
 lead.fecha_cita,
 true
 )
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
 "Campaña",
 lead.campana_nombre ||
 lead.proyecto
 );

 addInfoRow(
 acquisition,
 "Anuncio",
 lead.anuncio_nombre ||
 lead.formato
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

 const noteButton =
 element(
 "button",
 "card-action-button",
 "Agregar nota"
 );

 noteButton.type = "button";
 noteButton.addEventListener(
 "click",
 function() {
 openNotePopover(lead, crmLeadId, fromView);
 }
 );

 historyCard.appendChild(noteButton);

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

 const changeLine =
 event.valor_anterior || event.valor_nuevo
 ? [event.valor_anterior || "—", event.valor_nuevo || "—"].join("  ")
 : "";

 const detail =
 [
 changeLine,
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
 reportClientError(error, {
 accion: "lead.detail",
 endpoint: "/api/leads/" + encodeURIComponent(crmLeadId),
 crm_lead_id: crmLeadId
 });

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


 function formatCampaignMoney(value) {
 if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
 return "s/d";
 }

 return new Intl.NumberFormat(
 "es-MX",
 {
 style: "currency",
 currency: "MXN",
 maximumFractionDigits: 0
 }
 ).format(Number(value));
 }


 function formatCampaignNumber(value) {
 if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
 return "s/d";
 }

 return new Intl.NumberFormat(
 "es-MX",
 {
 maximumFractionDigits: 0
 }
 ).format(Number(value));
 }


 function formatCampaignPercent(value) {
 if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
 return "s/d";
 }

 return new Intl.NumberFormat(
 "es-MX",
 {
 style: "percent",
 minimumFractionDigits: 1,
 maximumFractionDigits: 2
 }
 ).format(Number(value));
 }


 function formatCampaignDateTime(value) {
 if (!value) return "s/d";
 return formatDateValue(value, true) || String(value);
 }


 function campaignStatusBadge(status) {
 const normalizedStatus = normalized(status);
 const badge = element(
 "span",
 "campaign-status" + (normalizedStatus === "activa" ? "" : " inactive"),
 status || "Sin estado"
 );
 return badge;
 }


 function campaignKpi(label, value, note) {
 const card = element("section", "campaign-kpi");
 card.appendChild(element("div", "campaign-kpi-label", label));
 card.appendChild(element("div", "campaign-kpi-value", value));
 if (note) {
 card.appendChild(element("div", "campaign-kpi-note", note));
 }
 return card;
 }


 function campaignMini(label, value) {
 const wrap = element("div", "");
 wrap.appendChild(element("div", "campaign-mini-label", label));
 wrap.appendChild(element("div", "campaign-mini-value", value));
 return wrap;
 }


 function campaignPreviousNote(previous, key, formatter) {
 if (!previous || previous[key] === null || previous[key] === undefined) {
 return "Sin corte anterior comparable";
 }
 return "Corte anterior: " + formatter(previous[key]);
 }


 function buildCampaignSectionHeader(title, subtitle, trailing) {
 const head = element("div", "campaign-section-head");
 const text = element("div", "");
 text.appendChild(element("h3", "campaign-section-title", title));
 if (subtitle) {
 text.appendChild(element("div", "campaign-section-sub", subtitle));
 }
 head.appendChild(text);
 if (trailing) head.appendChild(trailing);
 return head;
 }


 function buildCampaignTable(source) {
 const wrap = element("div", "campaign-table-wrap");
 const table = element("table", "campaign-table");
 const thead = document.createElement("thead");
 const headRow = document.createElement("tr");
 [
 "Corte",
 "Gasto",
 "Leads",
 "CPL",
 "CTR enlace",
 "CPC enlace",
 "Conv. clic → lead"
 ].forEach(function(label) {
 const th = document.createElement("th");
 th.textContent = label;
 headRow.appendChild(th);
 });
 thead.appendChild(headRow);
 table.appendChild(thead);

 const tbody = document.createElement("tbody");
 (source.trend || []).slice().reverse().forEach(function(point) {
 const tr = document.createElement("tr");
 const values = [
 (point.corte_h !== null && point.corte_h !== undefined ? point.corte_h + " h" : "s/d"),
 formatCampaignMoney(point.gasto),
 formatCampaignNumber(point.leads),
 formatCampaignMoney(point.cpl),
 formatCampaignPercent(point.ctr_enlace),
 formatCampaignMoney(point.cpc_enlace),
 formatCampaignPercent(point.conversion_clic_lead)
 ];
 values.forEach(function(value, index) {
 const td = document.createElement("td");
 td.textContent = value;
 if (index === 0 && point.fecha_corte) {
 td.title = formatCampaignDateTime(point.fecha_corte);
 }
 tr.appendChild(td);
 });
 tbody.appendChild(tr);
 });
 table.appendChild(tbody);
 wrap.appendChild(table);
 return wrap;
 }


 function campaignTypeLabel(value) {
 const type = normalized(value);
 if (type === "instant_form") return "Instant Form";
 if (type === "landing") return "Landing";
 if (type === "mixed") return "Mixto";
 return value || "";
 }


 function campaignMetricCells(metrics) {
 const m = metrics || {};
 return [
 campaignMini("Gasto", formatCampaignMoney(m.gasto)),
 campaignMini("Leads", formatCampaignNumber(m.leads)),
 campaignMini("CPL", formatCampaignMoney(m.cpl)),
 campaignMini("CTR", formatCampaignPercent(m.ctr_enlace)),
 campaignMini("CPC", formatCampaignMoney(m.cpc_enlace)),
 campaignMini("Conversión", formatCampaignPercent(m.conversion_clic_lead))
 ];
 }


 function campaignAdsetMetricCells(metrics) {
 const m = metrics || {};
 return [
 campaignMini("Gasto", formatCampaignMoney(m.gasto)),
 campaignMini("Leads", formatCampaignNumber(m.leads)),
 campaignMini("CPL", formatCampaignMoney(m.cpl)),
 campaignMini("CTR", formatCampaignPercent(m.ctr_enlace)),
 campaignMini("CPC", formatCampaignMoney(m.cpc_enlace)),
 campaignMini("CPM", formatCampaignMoney(m.cpm)),
 campaignMini("Conversión", formatCampaignPercent(m.conversion_clic_lead))
 ];
 }


 function campaignSecondaryMetrics(metrics) {
 const m = metrics || {};
 return "Impresiones " + formatCampaignNumber(m.impresiones) +
 " · Alcance " + formatCampaignNumber(m.alcance) +
 " · Clics enlace " + formatCampaignNumber(m.clics_enlace);
 }


 function buildCampaignHierarchy(campaign, onSelectionChange) {
 const hierarchy = campaign.hierarchy || {};
 const adsets = Array.isArray(hierarchy.adsets) ? hierarchy.adsets : [];
 const wrap = element("div", "campaign-hierarchy");

 if (!adsets.length) {
 wrap.appendChild(element("div", "empty-state", "No hay desglose por conjunto/anuncio para este corte oficial."));
 return wrap;
 }

 adsets.forEach(function(adset, index) {
 const details = document.createElement("details");
 details.className = "campaign-adset";

 const projectKey = String(campaign.proyecto || "");
 const adsetKey = String(adset.key || adset.nombre || index);
 const openMap = state.openCampaignAdsetByProject || (state.openCampaignAdsetByProject = {});
 details.open = openMap[projectKey] === adsetKey;

 details.addEventListener("toggle", function() {
 let selectionChanged = false;

 if (details.open) {
 if (openMap[projectKey] !== adsetKey) selectionChanged = true;
 openMap[projectKey] = adsetKey;

 Array.from(wrap.querySelectorAll("details.campaign-adset")).forEach(function(other) {
 if (other !== details && other.open) other.open = false;
 });
 } else if (openMap[projectKey] === adsetKey) {
 delete openMap[projectKey];
 selectionChanged = true;
 }

 if (selectionChanged && typeof onSelectionChange === "function") {
 onSelectionChange();
 }
 });

 const summary = document.createElement("summary");
 const grid = element("div", "campaign-adset-summary");
 const title = element("div", "");
 const titleLine = element("div", "campaign-entity-name");
 titleLine.appendChild(element("span", "campaign-adset-arrow", "›"));
 titleLine.appendChild(document.createTextNode(adset.nombre || "Conjunto sin nombre"));
 title.appendChild(titleLine);
 title.appendChild(
 element(
 "div",
 "campaign-entity-meta",
 [adset.formato, campaignTypeLabel(adset.tipo_conversion), ((adset.ads || []).length + " anuncio" + ((adset.ads || []).length === 1 ? "" : "s"))]
 .filter(Boolean)
 .join(" · ")
 )
 );
 grid.appendChild(title);
 campaignAdsetMetricCells(adset.metrics).forEach(function(cell) { grid.appendChild(cell); });
 grid.appendChild(element("div", "campaign-hierarchy-secondary", campaignSecondaryMetrics(adset.metrics)));
 summary.appendChild(grid);
 details.appendChild(summary);

 const adList = element("div", "campaign-ad-list");
 const ads = Array.isArray(adset.ads) ? adset.ads : [];
 if (!ads.length) {
 adList.appendChild(element("div", "campaign-source-note", "No hay anuncios registrados para este conjunto en el mismo corte."));
 } else {
 ads.forEach(function(ad) {
 const card = element("div", "campaign-ad-card");
 const name = element("div", "");
 name.appendChild(element("div", "campaign-entity-name", ad.nombre || "Anuncio sin nombre"));
 name.appendChild(
 element(
 "div",
 "campaign-entity-meta",
 [ad.formato, campaignTypeLabel(ad.tipo_conversion)].filter(Boolean).join(" · ")
 )
 );
 card.appendChild(name);
 campaignMetricCells(ad.metrics).forEach(function(cell) { card.appendChild(cell); });
 card.appendChild(element("div", "campaign-hierarchy-secondary", campaignSecondaryMetrics(ad.metrics)));
 adList.appendChild(card);
 });
 }
 details.appendChild(adList);
 wrap.appendChild(details);
 });

 return wrap;
 }


 function getSelectedCampaignAdset(campaign) {
 const projectKey = String(campaign && campaign.proyecto || "");
 const openMap = state.openCampaignAdsetByProject || {};
 const selectedKey = openMap[projectKey];
 const adsets = campaign && campaign.hierarchy && Array.isArray(campaign.hierarchy.adsets)
 ? campaign.hierarchy.adsets
 : [];

 if (!selectedKey) return null;

 return adsets.find(function(adset, index) {
 const key = String(adset.key || adset.nombre || index);
 return key === selectedKey;
 }) || null;
 }


 function renderCampaignTrendSection(campaign, section) {
 if (!section) return;

 const selectedAdset = getSelectedCampaignAdset(campaign);
 const source = selectedAdset || campaign;
 const points = Array.isArray(source.trend) ? source.trend : [];
 const title = selectedAdset
 ? "Evolución por corte · " + (selectedAdset.nombre || "Conjunto")
 : "Evolución por corte";
 const subtitle = selectedAdset
 ? "Últimos " + Math.min(points.length, 12) + " cortes oficiales guardados de este conjunto."
 : "Últimos " + Math.min(points.length, 12) + " cortes oficiales guardados de la campaña.";

 section.replaceChildren();
 section.appendChild(
 buildCampaignSectionHeader(
 title,
 subtitle,
 null
 )
 );
 section.appendChild(buildCampaignTable(source));
 }


 function buildCampaignWarnings(campaign) {
 const warnings = [];
 if (!campaign.metricas_activa) warnings.push("Métricas desactivadas en Control Campañas (columna F). Los datos pueden dejar de actualizarse.");
 if (!campaign.crm_sync_activo) warnings.push("Sincronización CRM desactivada en Control Campañas (columna G). Los nuevos leads pueden no entrar al CRM.");
 if (!campaign.capi_activa) warnings.push("CAPI desactivada en Control Campañas (columna H). No se enviarán señales comerciales nuevas a Meta.");
 if (!warnings.length) return null;

 const stack = element("div", "campaign-warning-stack");
 warnings.forEach(function(text) {
 stack.appendChild(element("div", "campaign-warning", "⚠ " + text));
 });
 return stack;
 }


 async function renderCampanas(force, silent) {
 const content = clearContent();

 if (!silent) {
 content.className = "loading";
 content.textContent = "Cargando campañas...";
 }

 try {
 const dashboard = await loadCampaigns(!!force);
 const campaigns = Array.isArray(dashboard.campaigns) ? dashboard.campaigns : [];

 content.className = "";
 content.replaceChildren();

 content.appendChild(
 createHero(
 "Marketing",
 "Campañas",
 "Campañas activas y su jerarquía real: campaña → conjunto → anuncios. Solo lectura."
 )
 );

 if (!campaigns.length) {
 content.appendChild(
 element(
 "div",
 "empty-state",
 "No hay campañas con estado ACTIVA en Control Campañas."
 )
 );
 return;
 }

 const dashboardWrap = element("div", "campaign-dashboard");
 const totals = campaigns.reduce(function(acc, campaign) {
 const current = campaign.current || {};
 if (Number.isFinite(Number(current.gasto))) acc.spend += Number(current.gasto);
 if (Number.isFinite(Number(current.leads))) acc.leads += Number(current.leads);
 return acc;
 }, {spend: 0, leads: 0});

 const blendedCpl = totals.leads > 0 ? totals.spend / totals.leads : null;
 const latestUpdate = campaigns
 .map(function(c) { return c.current && c.current.fecha_consulta ? c.current.fecha_consulta : ""; })
 .filter(Boolean)
 .sort()
 .slice(-1)[0] || dashboard.generated_at || "";

 const summaryGrid = element("div", "campaign-summary-grid");
 summaryGrid.appendChild(campaignKpi("Campañas activas", String(campaigns.length), "Leídas de Control Campañas · estado = ACTIVA"));
 summaryGrid.appendChild(campaignKpi("Gasto acumulado", formatCampaignMoney(totals.spend), "Suma del último corte oficial de cada campaña activa"));
 summaryGrid.appendChild(campaignKpi("Leads acumulados", formatCampaignNumber(totals.leads), "Último corte oficial disponible"));
 summaryGrid.appendChild(campaignKpi("CPL combinado", formatCampaignMoney(blendedCpl), "Gasto total ÷ leads totales"));
 dashboardWrap.appendChild(summaryGrid);

 const listSection = element("section", "campaign-section");
 listSection.appendChild(
 buildCampaignSectionHeader(
 "Campañas activas",
 "La lista cambia automáticamente cuando Control Campañas cambia de estado.",
 element("div", "campaign-source-note", "Actualizado: " + formatCampaignDateTime(latestUpdate))
 )
 );

 const list = element("div", "campaign-list");
 if (!state.selectedCampaignProject || !campaigns.some(function(c) { return c.proyecto === state.selectedCampaignProject; })) {
 state.selectedCampaignProject = campaigns[0].proyecto;
 }

 campaigns.forEach(function(campaign) {
 const current = campaign.current || {};
 const button = element("button", "campaign-card" + (campaign.proyecto === state.selectedCampaignProject ? " active" : ""));
 button.type = "button";

 const top = element("div", "campaign-card-top");
 const titleWrap = element("div", "");
 titleWrap.appendChild(element("div", "campaign-card-title", campaign.proyecto));
 titleWrap.appendChild(
 element(
 "div",
 "campaign-card-meta",
 "Corte " + (current.corte_h !== null && current.corte_h !== undefined ? current.corte_h + " h" : "s/d") +
 (current.fecha_consulta ? " · " + formatCampaignDateTime(current.fecha_consulta) : "")
 )
 );
 top.appendChild(titleWrap);
 top.appendChild(campaignStatusBadge(campaign.estado));
 button.appendChild(top);

 const metrics = element("div", "campaign-card-metrics");
 metrics.appendChild(campaignMini("Gasto", formatCampaignMoney(current.gasto)));
 metrics.appendChild(campaignMini("Leads", formatCampaignNumber(current.leads)));
 metrics.appendChild(campaignMini("CPL", formatCampaignMoney(current.cpl)));
 metrics.appendChild(campaignMini("Conversión", formatCampaignPercent(current.conversion_clic_lead)));
 button.appendChild(metrics);

 button.addEventListener("click", function() {
 state.selectedCampaignProject = campaign.proyecto;
 renderCampanas(false, true);
 });

 list.appendChild(button);
 });
 listSection.appendChild(list);
 dashboardWrap.appendChild(listSection);

 const selected = campaigns.find(function(c) { return c.proyecto === state.selectedCampaignProject; }) || campaigns[0];
 const current = selected.current || {};
 const previous = selected.previous || null;

 const resultSection = element("section", "campaign-section");
 resultSection.appendChild(
 buildCampaignSectionHeader(
 selected.proyecto,
 "Último corte oficial: " + (current.corte_h !== null && current.corte_h !== undefined ? current.corte_h + " h" : "s/d") +
 (current.fecha_consulta ? " · consultado " + formatCampaignDateTime(current.fecha_consulta) : ""),
 campaignStatusBadge(selected.estado)
 )
 );

 const warnings = buildCampaignWarnings(selected);
 if (warnings) resultSection.appendChild(warnings);

 const detailKpis = element("div", "campaign-detail-kpis");
 [
 ["Gasto", formatCampaignMoney(current.gasto), campaignPreviousNote(previous, "gasto", formatCampaignMoney)],
 ["Impresiones", formatCampaignNumber(current.impresiones), campaignPreviousNote(previous, "impresiones", formatCampaignNumber)],
 ["Alcance", formatCampaignNumber(current.alcance), campaignPreviousNote(previous, "alcance", formatCampaignNumber)],
 ["Clics enlace", formatCampaignNumber(current.clics_enlace), campaignPreviousNote(previous, "clics_enlace", formatCampaignNumber)],
 ["CTR enlace", formatCampaignPercent(current.ctr_enlace), campaignPreviousNote(previous, "ctr_enlace", formatCampaignPercent)],
 ["CPC enlace", formatCampaignMoney(current.cpc_enlace), campaignPreviousNote(previous, "cpc_enlace", formatCampaignMoney)],
 ["Leads", formatCampaignNumber(current.leads), campaignPreviousNote(previous, "leads", formatCampaignNumber)],
 ["CPL", formatCampaignMoney(current.cpl), campaignPreviousNote(previous, "cpl", formatCampaignMoney)],
 ["Conv. clic → lead", formatCampaignPercent(current.conversion_clic_lead), campaignPreviousNote(previous, "conversion_clic_lead", formatCampaignPercent)]
 ].forEach(function(item) {
 const card = element("div", "campaign-detail-kpi");
 card.appendChild(element("div", "campaign-mini-label", item[0]));
 card.appendChild(element("div", "campaign-detail-value", item[1]));
 card.appendChild(element("div", "campaign-delta", item[2]));
 detailKpis.appendChild(card);
 });
 resultSection.appendChild(detailKpis);
 dashboardWrap.appendChild(resultSection);

 let trendSection = null;

 const hierarchySection = element("section", "campaign-section");
 hierarchySection.appendChild(
 buildCampaignSectionHeader(
 "Conjuntos y anuncios",
 "Todos los niveles usan exactamente el mismo corte oficial de la campaña. Abre cada conjunto para ver sus anuncios.",
 null
 )
 );
 hierarchySection.appendChild(
 buildCampaignHierarchy(selected, function() {
 if (trendSection) renderCampaignTrendSection(selected, trendSection);
 })
 );
 hierarchySection.appendChild(
 element(
 "div",
 "campaign-readonly-note",
 "Solo lectura. Los estados y métricas vienen de Comparativo resultados de campañas; esta pantalla no pausa anuncios ni modifica Meta."
 )
 );
 dashboardWrap.appendChild(hierarchySection);

 trendSection = element("section", "campaign-section");
 renderCampaignTrendSection(selected, trendSection);
 dashboardWrap.appendChild(trendSection);

 const configSection = element("section", "campaign-section");
 configSection.appendChild(
 buildCampaignSectionHeader(
 "Configuración operativa",
 "Estado técnico informativo. No son controles.",
 null
 )
 );

 const configGrid = element("div", "campaign-config-grid");
 [
 ["Arranque", formatCampaignDateTime(selected.fecha_hora_arranque)],
 ["Corte oficial", selected.intervalo_corte_h !== null && selected.intervalo_corte_h !== undefined ? "Cada " + selected.intervalo_corte_h + " h" : "s/d"],
 ["Lectura live", selected.intervalo_live_min !== null && selected.intervalo_live_min !== undefined ? "Cada " + selected.intervalo_live_min + " min" : "s/d"],
 ["Métricas", selected.metricas_activa ? "Activas" : "Inactivas"],
 ["CRM sync", selected.crm_sync_activo ? "Activo" : "Inactivo"],
 ["CAPI", selected.capi_activa ? "Activa" : "Inactiva"]
 ].forEach(function(item) {
 const box = element("div", "campaign-config-item");
 box.appendChild(element("div", "campaign-mini-label", item[0]));
 box.appendChild(element("div", "campaign-config-value", item[1]));
 configGrid.appendChild(box);
 });
 configSection.appendChild(configGrid);
 configSection.appendChild(
 element(
 "div",
 "campaign-source-note",
 "Fuente: " + (dashboard.source_label || "Comparativo resultados de campañas") + ". Campañas visibles: Control Campañas con estado ACTIVA."
 )
 );
 dashboardWrap.appendChild(configSection);

 content.appendChild(dashboardWrap);

 } catch (error) {
 content.className = "";
 content.replaceChildren(
 element(
 "div",
 "empty-state",
 "No se pudieron cargar las campañas."
 )
 );
 showError(error.message);
 reportClientError(error, {
 accion: "campaigns.dashboard",
 endpoint: "/api/campaigns"
 });
 }
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


 const AUTO_REFRESH_MS = 60 * 1000;
 let autoRefreshBusy = false;
 let lastAutoRefreshAt = 0;

 function userIsEditing() {
 const active = document.activeElement;
 if (!active) return false;
 const tag = String(active.tagName || "").toUpperCase();
 return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !!document.querySelector(".popover-backdrop");
 }

 async function autoRefreshVisibleView(forceNow) {
 if (autoRefreshBusy || document.hidden || userIsEditing()) return;
 const now = Date.now();
 if (!forceNow && now - lastAutoRefreshAt < AUTO_REFRESH_MS - 1000) return;

 const route = parseRoute();
 if (route.type !== "view" || (route.view !== "hoy" && route.view !== "leads" && route.view !== "campanas")) return;

 autoRefreshBusy = true;
 try {
 if (route.view === "hoy") {
 await renderHoy(true, true);
 } else if (route.view === "leads") {
 await renderLeads(true, true);
 } else {
 await renderCampanas(true, true);
 }
 lastAutoRefreshAt = Date.now();
 } catch (error) {
 const endpoint = route.view === "hoy" ? "/api/hoy" : (route.view === "leads" ? "/api/leads" : "/api/campaigns");
 reportClientError(error, {accion: "auto.refresh", endpoint: endpoint});
 } finally {
 autoRefreshBusy = false;
 }
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
 } else if (
 route.view === "campanas"
 ) {
 await renderCampanas(true);
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


 // Refresco operativo: no recarga la página; vuelve a consultar únicamente la vista visible.
 setInterval(function() {
 autoRefreshVisibleView(false);
 }, AUTO_REFRESH_MS);

 document.addEventListener("visibilitychange", function() {
 if (!document.hidden) autoRefreshVisibleView(true);
 });

 window.addEventListener("focus", function() {
 if (Date.now() - lastAutoRefreshAt > 5000) autoRefreshVisibleView(true);
 });

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