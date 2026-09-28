/**

 * ============================================================

 * OV REAL ESTATE CRM — CLOUDFLARE WORKER

 * Version: 0.14.0-message-variables-admin

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



const APP_VERSION = "0.14.0-message-variables-admin";



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
 * API BOOTSTRAP — carga inicial consolidada
 */
 if (
 url.pathname === "/api/bootstrap" &&
 method === "GET"
 ) {
 const session = await requireSession(request, env);
 const upstream = await callAppsScript(env, session.email, {
 action: "app.bootstrap"
 });
 const bootstrapData = upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;
 if (!bootstrapData || typeof bootstrapData !== "object") {
 throw publicError(502, "El API no devolvió el arranque del CRM.");
 }
 return jsonResponse({ok: true, data: bootstrapData});
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
 * API CAPI STATUS — lectura ligera para sincronización visual
 */
 if (
 url.pathname.startsWith("/api/leads/") &&
 url.pathname.endsWith("/capi-status") &&
 method === "GET"
 ) {
 const session = await requireSession(request, env);
 const rawId = url.pathname.substring(
 "/api/leads/".length,
 url.pathname.length - "/capi-status".length
 );
 const crmLeadId = decodeURIComponent(rawId).trim();
 if (!crmLeadId) throw publicError(400, "Falta crm_lead_id.");

 const expectedStage = String(url.searchParams.get("stage") || "").trim();
 if (!expectedStage) throw publicError(400, "Falta la etapa esperada.");
 const sinceMs = Number(url.searchParams.get("since") || 0);

 const upstream = await callAppsScript(env, session.email, {
 action: "leads.capi_status",
 crm_lead_id: crmLeadId,
 expected_stage: expectedStage,
 since_ms: Number.isFinite(sinceMs) ? sinceMs : 0
 });

 const statusData = upstream && upstream.data !== undefined
 ? upstream.data
 : upstream;

 if (!statusData || typeof statusData !== "object") {
 throw publicError(502, "El API no devolvió el estado CAPI del lead.");
 }

 return jsonResponse({ok: true, data: statusData});
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
 body?.changes || {},

 message_context:
 body?.message_context || null
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
 * API TEMPLATES — administración en Más > Plantillas
 */
 if (url.pathname === "/api/templates" && method === "GET") {
 const session = await requireSession(request, env);
 const upstream = await callAppsScript(env, session.email, {
 action: "templates.list",
 include_inactive: url.searchParams.get("include_inactive") === "1" ? "true" : "false"
 });
 const data = upstream && upstream.data !== undefined ? upstream.data : upstream;
 if (!data || typeof data !== "object" || !Array.isArray(data.templates)) {
 throw publicError(502, "El API no devolvió las plantillas.");
 }
 return jsonResponse({ok: true, data: data});
 }

 if (url.pathname === "/api/templates" && method === "POST") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "templates.create",
 template: body?.template || {}
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 if (url.pathname.startsWith("/api/templates/") && method === "PATCH") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 const templateId = decodeURIComponent(url.pathname.substring("/api/templates/".length)).trim();
 if (!templateId) throw publicError(400, "Falta template_id.");
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "templates.update",
 template_id: templateId,
 expected_version: Number(body?.expected_version || 0),
 template: body?.template || {}
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 /**
 * API CATALOGS — administración segura en Más > Catálogos
 */
 if (url.pathname === "/api/catalogs" && method === "GET") {
 const session = await requireSession(request, env);
 const upstream = await callAppsScript(env, session.email, {
 action: "catalogs.list"
 });
 const data = upstream && upstream.data !== undefined ? upstream.data : upstream;
 if (!data || typeof data !== "object" || !Array.isArray(data.catalogs)) {
 throw publicError(502, "El API no devolvió los catálogos.");
 }
 return jsonResponse({ok: true, data: data});
 }

 if (url.pathname === "/api/catalogs" && method === "POST") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "catalogs.create",
 catalogo: String(body?.catalogo || ""),
 option: body?.option || {}
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 if (url.pathname === "/api/catalogs/reorder" && method === "POST") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "catalogs.reorder",
 catalogo: String(body?.catalogo || ""),
 option_ids: Array.isArray(body?.option_ids) ? body.option_ids : []
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 if (url.pathname.startsWith("/api/catalogs/") && method === "PATCH") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 const optionId = decodeURIComponent(url.pathname.substring("/api/catalogs/".length)).trim();
 if (!optionId) throw publicError(400, "Falta option_id.");
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "catalogs.update",
 option_id: optionId,
 option: body?.option || {}
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 /**
 * API MESSAGE VARIABLES — administración y variables personalizadas
 */
 if (url.pathname === "/api/message-variables" && method === "GET") {
 const session = await requireSession(request, env);
 const upstream = await callAppsScript(env, session.email, {
 action: "message_variables.list"
 });
 const data = upstream && upstream.data !== undefined ? upstream.data : upstream;
 if (!data || typeof data !== "object" || !Array.isArray(data.variables) || !Array.isArray(data.sources)) {
 throw publicError(502, "El API no devolvió las variables de mensajes.");
 }
 return jsonResponse({ok: true, data: data});
 }

 if (url.pathname === "/api/message-variables" && method === "POST") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "message_variables.create",
 kind: String(body?.kind || "CUSTOM"),
 source_id: String(body?.source_id || ""),
 variable: body?.variable || {}
 });
 return jsonResponse({ok: true, data: upstream.data});
 }

 if (url.pathname.startsWith("/api/message-variables/") && method === "PATCH") {
 requireSameOrigin(request);
 const session = await requireSession(request, env);
 const variableId = decodeURIComponent(url.pathname.substring("/api/message-variables/".length)).trim();
 if (!variableId) throw publicError(400, "Falta variable_id.");
 let body;
 try { body = await request.json(); }
 catch { throw publicError(400, "Solicitud inválida."); }
 const upstream = await callAppsScript(env, session.email, {
 action: "message_variables.update",
 variable_id: variableId,
 variable: body?.variable || {}
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

 width: min(92vw, 430px);

 padding: 36px 30px 32px;

 background: linear-gradient(180deg, #171717 0%, #121212 100%);

 border: 1px solid #2d2d2d;

 border-radius: 22px;

 box-shadow: 0 24px 70px rgba(0,0,0,.34);

 text-align: center;

 }



 .login-mark {

 width: 56px;

 height: 56px;

 margin: 0 auto 18px;

 border-radius: 17px;

 display: grid;

 place-items: center;

 background: #fff;

 color: #111;

 font-size: 18px;

 font-weight: 800;

 letter-spacing: -.04em;

 }



 .brand {

 font-size: 28px;

 font-weight: 760;

 letter-spacing: -0.7px;

 margin-bottom: 7px;

 }



 .subtitle {

 color: #b0b0b0;

 font-size: 15px;

 line-height: 1.5;

 margin-bottom: 8px;

 }

 .login-help {

 color: #777;

 font-size: 12px;

 line-height: 1.5;

 margin-bottom: 26px;

 }



 #googleButton {

 min-height: 44px;

 display: flex;

 justify-content: center;

 align-items: center;

 width: 100%;

 overflow: hidden;

 }

 @media (max-width: 480px) {

 .card {

 width: calc(100vw - 28px);

 padding: 32px 20px 28px;

 }

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

 <div class="login-mark">OV</div>

 <div class="brand">

 OV Real Estate

 </div>



 <div class="subtitle">

 CRM · Acceso privado

 </div>

 <div class="login-help">

 Inicia sesión con una cuenta autorizada para continuar.

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





 const googleButtonWidth = Math.max(240, Math.min(340, window.innerWidth - 84));

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

 googleButtonWidth

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
 transition: transform .18s ease, background .18s ease, box-shadow .18s ease;
 }

 .nav-button.has-update .nav-dot,
 .mobile-nav button.has-update .nav-dot {
 background: #e11d48;
 opacity: 1;
 box-shadow: 0 0 0 4px rgba(225,29,72,.14);
 transform: scale(1.08);
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

 .leads-options-row {
 display: flex;
 align-items: center;
 justify-content: space-between;
 gap: 12px;
 margin: -4px 0 14px;
 flex-wrap: wrap;
 }

 .leads-hide-discarded {
 display: inline-flex;
 align-items: center;
 gap: 9px;
 min-height: 36px;
 padding: 0 12px;
 border: 1px solid var(--line);
 border-radius: 999px;
 background: #fff;
 color: #444;
 font-size: 12px;
 font-weight: 700;
 cursor: pointer;
 user-select: none;
 }

 .leads-hide-discarded input {
 width: 16px;
 height: 16px;
 margin: 0;
 accent-color: #111;
 }

 .leads-hidden-count {
 color: var(--muted);
 font-size: 12px;
 font-weight: 600;
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

 .lead-ops {
 display: grid;
 gap: 3px;
 margin-top: 8px;
 min-width: 0;
 }

 .lead-ops-line {
 display: flex;
 align-items: baseline;
 gap: 7px;
 min-width: 0;
 color: #5f5f5b;
 font-size: 12px;
 line-height: 1.35;
 }

 .lead-ops-label {
 flex: 0 0 auto;
 color: #777772;
 font-weight: 760;
 }

 .lead-ops-text {
 min-width: 0;
 overflow: hidden;
 text-overflow: ellipsis;
 white-space: nowrap;
 }

 .lead-ops-line.next .lead-ops-text {
 color: #333;
 font-weight: 650;
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


 .history-capi-live {
 border-style: dashed;
 }

 .history-capi-live.pending {
 background: #fffaf0;
 border-color: #e7c979;
 }

 .history-capi-live.sent {
 background: #f2fbf5;
 border-color: #8bc59a;
 }

 .history-capi-live.error,
 .history-capi-live.timeout {
 background: #fff4f3;
 border-color: #e5a09a;
 }

 .history-capi-live .history-action::before {
 content: "● ";
 }

 .history-capi-live.pending .history-action::before {
 color: #c58a00;
 }

 .history-capi-live.sent .history-action::before {
 color: #168a3d;
 }

 .history-capi-live.error .history-action::before,
 .history-capi-live.timeout .history-action::before {
 color: #c7332b;
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

 .commercial-pair {
 display: grid;
 grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
 gap: 10px;
 }

 .commercial-original {
 border: 1px solid var(--line);
 background: #fafaf8;
 border-radius: 11px;
 padding: 10px 12px;
 color: var(--muted);
 font-size: 12px;
 line-height: 1.45;
 }

 .commercial-preview {
 font-size: 13px;
 font-weight: 720;
 color: #222;
 }

 @media (max-width: 520px) {
 .commercial-pair { grid-template-columns: 1fr; }
 }

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

 .whatsapp-composer {
 gap: 12px;
 border-color: #d9e8df;
 background: #f8fcf9;
 }

 .whatsapp-actions {
 display: flex;
 align-items: center;
 gap: 10px;
 flex-wrap: wrap;
 }

 .whatsapp-sent-confirm {
 margin-top: 2px;
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

 .more-card-button {
 width: 100%;
 text-align: left;
 cursor: pointer;
 transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
 }

 .more-card-button:hover {
 border-color: #b8b8b1;
 transform: translateY(-1px);
 box-shadow: 0 8px 22px rgba(0,0,0,.05);
 }

 .more-card-button .more-card-action {
 margin-top: 14px;
 font-size: 12px;
 font-weight: 760;
 color: #111;
 }

 .more-card-disabled {
 background: #fafaf8;
 }

 .more-card-disabled .more-card-action {
 color: var(--muted);
 font-weight: 650;
 }

 .templates-page {
 display: grid;
 gap: 16px;
 }

 .templates-toolbar {
 display: flex;
 justify-content: space-between;
 align-items: center;
 gap: 12px;
 flex-wrap: wrap;
 }

 .templates-back {
 border: 0;
 background: transparent;
 padding: 0;
 font: inherit;
 font-size: 12px;
 font-weight: 760;
 color: #555;
 cursor: pointer;
 }

 .templates-summary {
 display: grid;
 grid-template-columns: repeat(3, minmax(0, 1fr));
 gap: 10px;
 }

 .templates-summary-card {
 border: 1px solid var(--line);
 border-radius: 14px;
 background: #fff;
 padding: 14px;
 }

 .templates-summary-card strong {
 display: block;
 font-size: 23px;
 line-height: 1;
 margin-bottom: 6px;
 }

 .templates-summary-card span {
 color: var(--muted);
 font-size: 11px;
 font-weight: 650;
 }

 .templates-filters {
 display: grid;
 grid-template-columns: repeat(3, minmax(0, 1fr));
 gap: 10px;
 border: 1px solid var(--line);
 border-radius: 14px;
 padding: 12px;
 background: #fff;
 }

 .templates-list {
 display: grid;
 gap: 10px;
 }

 .template-card {
 border: 1px solid var(--line);
 border-radius: 15px;
 background: #fff;
 padding: 15px;
 display: grid;
 gap: 10px;
 }

 .template-card.inactive {
 opacity: .62;
 background: #fafaf8;
 }

 .template-card-head {
 display: flex;
 justify-content: space-between;
 align-items: flex-start;
 gap: 12px;
 }

 .template-card-title {
 font-size: 15px;
 font-weight: 790;
 margin-bottom: 5px;
 }

 .template-badges {
 display: flex;
 gap: 6px;
 flex-wrap: wrap;
 }

 .template-badge {
 display: inline-flex;
 align-items: center;
 min-height: 23px;
 padding: 0 8px;
 border-radius: 999px;
 background: #f1f1ee;
 color: #555;
 font-size: 10px;
 font-weight: 740;
 }

 .template-badge.default {
 background: #111;
 color: #fff;
 }

 .template-badge.project {
 background: #eef3ff;
 color: #294d98;
 }

 .template-message {
 white-space: pre-wrap;
 color: #444;
 font-size: 12px;
 line-height: 1.55;
 }

 .template-meta {
 color: var(--muted);
 font-size: 10px;
 line-height: 1.4;
 }

 .template-editor-panel {
 width: min(700px, 100%);
 }

 .template-editor-grid {
 display: grid;
 grid-template-columns: repeat(2, minmax(0, 1fr));
 gap: 10px;
 }

 .template-editor-message {
 min-height: 170px;
 }

 .template-token-section {
 display: grid;
 gap: 8px;
 }

 .template-token-list {
 display: flex;
 flex-wrap: wrap;
 gap: 6px;
 }

 .template-token {
 border: 1px solid #d9d9d3;
 background: #f8f8f5;
 border-radius: 999px;
 padding: 6px 9px;
 font-size: 11px;
 font-weight: 700;
 cursor: pointer;
 }

 .template-token:hover {
 border-color: #aaa;
 }

 .template-preview {
 border: 1px solid #deded8;
 background: #fafaf8;
 border-radius: 12px;
 padding: 12px;
 white-space: pre-wrap;
 font-size: 12px;
 line-height: 1.55;
 min-height: 56px;
 }

 .template-checks {
 display: grid;
 gap: 8px;
 }

 .template-inline-check {
 display: flex;
 gap: 8px;
 align-items: flex-start;
 font-size: 12px;
 line-height: 1.4;
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
 min-width: 0;
 max-width: 100%;
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
 position: relative;
 width: 100%;
 text-align: left;
 border: 1px solid var(--line);
 border-radius: 18px;
 padding: 18px;
 background: #fff;
 color: inherit;
 cursor: pointer;
 transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease, background .15s ease;
 overflow: hidden;
 }

 .campaign-card:hover {
 border-color: #b8b8b1;
 transform: translateY(-2px);
 box-shadow: 0 10px 28px rgba(0,0,0,.05);
 }

 .campaign-card.active {
 border-color: #111;
 box-shadow: 0 0 0 1px #111 inset, 0 10px 26px rgba(0,0,0,.05);
 background: #fcfcfb;
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

 .campaign-card-action {
 display: inline-flex;
 align-items: center;
 gap: 6px;
 margin-top: 14px;
 min-height: 28px;
 padding: 0 9px;
 border-radius: 999px;
 background: #f1f1ee;
 color: #444;
 font-size: 11px;
 font-weight: 760;
 }

 .campaign-card.active .campaign-card-action {
 background: #111;
 color: #fff;
 }

 .campaign-tree {
 display: grid;
 gap: 7px;
 margin-top: 14px;
 padding: 11px 12px;
 border-radius: 13px;
 background: #f7f7f4;
 border: 1px solid #ecebe6;
 }

 .campaign-tree-row {
 display: grid;
 grid-template-columns: 18px minmax(0, 1fr);
 gap: 7px;
 align-items: start;
 color: #454545;
 font-size: 11px;
 line-height: 1.35;
 }

 .campaign-tree-row.ad {
 padding-left: 18px;
 color: #707070;
 }

 .campaign-tree-symbol {
 color: #9a9a94;
 font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
 min-width: 0;
 max-width: 100%;
 overflow: hidden;
 padding: 18px;
 border: 1px solid var(--line);
 border-radius: 17px;
 background: #fff;
 }

 .campaign-selection-banner {
 display: flex;
 align-items: center;
 justify-content: space-between;
 gap: 14px;
 padding: 13px 16px;
 border-radius: 15px;
 background: #111;
 color: #fff;
 }

 .campaign-selection-banner strong {
 font-size: 14px;
 }

 .campaign-selection-banner span {
 color: #bdbdbd;
 font-size: 11px;
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

 .campaign-level-note {
 margin-top: 12px;
 padding: 10px 12px;
 border-radius: 11px;
 background: #f6f6f3;
 color: #666;
 font-size: 11px;
 line-height: 1.45;
 }

 .campaign-table-shell {
 width: 100%;
 min-width: 0;
 max-width: 100%;
 margin-top: 14px;
 }

 .campaign-table-wrap {
 width: 100%;
 min-width: 0;
 max-width: 100%;
 overflow-x: auto;
 overflow-y: hidden;
 -webkit-overflow-scrolling: touch;
 overscroll-behavior-x: contain;
 border: 1px solid #e8e7e2;
 border-radius: 13px;
 }

 .campaign-scroll-control {
 display: grid;
 grid-template-columns: auto minmax(140px, 1fr) auto;
 align-items: center;
 gap: 10px;
 margin-top: 9px;
 padding: 8px 10px;
 border-radius: 11px;
 background: #f6f6f3;
 color: #666;
 font-size: 10px;
 font-weight: 700;
 }

 .campaign-scroll-range {
 width: 100%;
 min-width: 0;
 accent-color: #111;
 cursor: ew-resize;
 }

 .followup-sequence-box {
 display: flex;
 align-items: center;
 justify-content: space-between;
 gap: 10px;
 padding: 11px 12px;
 border: 1px solid #e5e4df;
 border-radius: 12px;
 background: #f8f8f6;
 }

 .followup-sequence-label {
 color: #666;
 font-size: 11px;
 font-weight: 700;
 }

 .followup-sequence-value {
 font-size: 13px;
 font-weight: 800;
 color: #111;
 }

 .campaign-table {
 width: 100%;
 min-width: 1540px;
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
 .campaign-table td:first-child,
 .campaign-table th:nth-child(2),
 .campaign-table td:nth-child(2) {
 text-align: left;
 }

 .campaign-table th:first-child,
 .campaign-table td:first-child {
 position: sticky;
 left: 0;
 background: #fff;
 z-index: 2;
 }

 .campaign-table th {
 color: var(--muted);
 font-size: 10px;
 font-weight: 780;
 letter-spacing: .02em;
 text-transform: uppercase;
 background: #fafaf8;
 }

 .campaign-table th:first-child {
 background: #fafaf8;
 z-index: 3;
 }

 .campaign-table tr:first-child td {
 background-color: #fcfcf9;
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

 .campaign-config-item.ok {
 border-color: #cfe7d6;
 background: #f4fbf6;
 }

 .campaign-config-item.bad {
 border-color: #f0c4c1;
 background: #fff4f3;
 }

 .campaign-config-value {
 margin-top: 4px;
 font-size: 13px;
 font-weight: 760;
 }

 .campaign-config-item.ok .campaign-config-value {
 color: #176b3a;
 }

 .campaign-config-item.bad .campaign-config-value {
 color: #a12820;
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
 border: 1px solid #efc5c1;
 border-radius: 12px;
 background: #fff4f3;
 color: #9b241c;
 font-size: 12px;
 line-height: 1.4;
 }

 .campaign-hierarchy {
 display: grid;
 gap: 14px;
 margin-top: 14px;
 }

 .campaign-adset-panel {
 --adset-accent: #4f46e5;
 border: 1px solid #e5e4df;
 border-left: 5px solid var(--adset-accent);
 border-radius: 15px;
 background: #fff;
 overflow: hidden;
 }

 .campaign-adset-panel.accent-1 { --adset-accent: #0f766e; }
 .campaign-adset-panel.accent-2 { --adset-accent: #b45309; }
 .campaign-adset-panel.accent-3 { --adset-accent: #7c3aed; }

 .campaign-adset-head {
 padding: 15px 16px 13px;
 background: #fbfbf9;
 border-bottom: 1px solid #eeede8;
 }

 .campaign-adset-title-row {
 display: flex;
 justify-content: space-between;
 gap: 12px;
 align-items: flex-start;
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

 .campaign-metric-grid {
 display: grid;
 grid-template-columns: repeat(6, minmax(0, 1fr));
 gap: 8px;
 margin-top: 13px;
 }

 .campaign-metric-box {
 padding: 9px 10px;
 border-radius: 10px;
 background: #fff;
 border: 1px solid #ecebe7;
 }

 .campaign-ad-list-static {
 display: grid;
 gap: 9px;
 padding: 12px;
 background: #f8f8f5;
 }

 .campaign-ad-card {
 padding: 12px 13px;
 border: 1px solid #e8e7e2;
 border-radius: 12px;
 background: #fff;
 }

 .campaign-ad-card .campaign-metric-grid {
 margin-top: 11px;
 }

 .campaign-trend-controls {
 display: grid;
 gap: 10px;
 margin-top: 14px;
 }

 .campaign-trend-tabs,
 .campaign-trend-subtabs {
 display: flex;
 gap: 7px;
 flex-wrap: wrap;
 }

 .campaign-trend-button {
 min-height: 34px;
 border: 1px solid #deddd8;
 border-radius: 999px;
 padding: 0 11px;
 background: #fff;
 color: #555;
 font-size: 11px;
 font-weight: 730;
 cursor: pointer;
 }

 .campaign-trend-button:hover {
 border-color: #aaa;
 }

 .campaign-trend-button.active {
 background: #111;
 color: #fff;
 border-color: #111;
 }

 .campaign-trend-subtabs .campaign-trend-button.active {
 background: #f0f0ed;
 color: #111;
 border-color: #999;
 }

 .campaign-trend-context {
 padding: 11px 13px;
 border-radius: 12px;
 background: #f6f6f3;
 color: #555;
 font-size: 12px;
 line-height: 1.4;
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

 .campaign-metric-grid {
 grid-template-columns: repeat(4, minmax(0, 1fr));
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

 .campaign-card-metrics {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-metric-grid {
 grid-template-columns: repeat(2, minmax(0, 1fr));
 }

 .campaign-adset-title-row,
 .campaign-selection-banner {
 align-items: flex-start;
 flex-direction: column;
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

 .templates-summary,
 .templates-filters,
 .template-editor-grid {
 grid-template-columns: 1fr;
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


 /* ===== Catálogos ===== */
 .catalogs-page {
 display: grid;
 gap: 16px;
 }

 .catalog-metrics {
 display: grid;
 grid-template-columns: repeat(4, minmax(0, 1fr));
 gap: 10px;
 }

 .catalog-metric-card {
 min-width: 0;
 padding: 16px;
 border: 1px solid var(--line);
 border-radius: 16px;
 background: #fff;
 }

 .catalog-metric-card strong {
 display: block;
 font-size: 24px;
 line-height: 1;
 margin-bottom: 7px;
 letter-spacing: -.02em;
 }

 .catalog-metric-card span {
 display: block;
 color: var(--muted);
 font-size: 11px;
 font-weight: 700;
 }

 .catalog-metric-card.ok {
 border-color: #cfe4d7;
 background: #fbfefc;
 }

 .catalog-metric-card.warning {
 border-color: #ead9b4;
 background: #fffdf8;
 }

 .catalog-health {
 display: flex;
 align-items: center;
 gap: 12px;
 border-radius: 15px;
 padding: 13px 15px;
 border: 1px solid var(--line);
 background: #fff;
 }

 .catalog-health.ok {
 border-color: #cfe4d7;
 background: #f8fcf9;
 }

 .catalog-health.warning {
 border-color: #ead9b4;
 background: #fffaf0;
 }

 .catalog-health-icon {
 width: 30px;
 height: 30px;
 border-radius: 50%;
 display: grid;
 place-items: center;
 background: #111;
 color: #fff;
 font-weight: 850;
 flex: 0 0 auto;
 }

 .catalog-health strong,
 .catalog-health span {
 display: block;
 }

 .catalog-health strong {
 font-size: 13px;
 margin-bottom: 2px;
 }

 .catalog-health span {
 font-size: 11px;
 color: var(--muted);
 line-height: 1.4;
 }

 .catalog-group-tabs {
 display: flex;
 gap: 8px;
 flex-wrap: wrap;
 }

 .catalog-group-tab {
 border: 1px solid var(--line);
 border-radius: 999px;
 background: #fff;
 color: #555;
 padding: 9px 14px;
 font: inherit;
 font-size: 12px;
 font-weight: 760;
 cursor: pointer;
 }

 .catalog-group-tab.active {
 background: #111;
 color: #fff;
 border-color: #111;
 }

 .catalog-group-caption {
 margin-top: -8px;
 color: var(--muted);
 font-size: 11px;
 }

 .catalog-workspace {
 display: grid;
 grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
 gap: 14px;
 align-items: start;
 }

 .catalog-nav-panel,
 .catalog-detail-panel {
 border: 1px solid var(--line);
 border-radius: 18px;
 background: #fff;
 }

 .catalog-nav-panel {
 padding: 12px;
 position: sticky;
 top: 86px;
 }

 .catalog-search {
 margin-bottom: 10px;
 }

 .catalog-nav-list {
 display: grid;
 gap: 7px;
 }

 .catalog-nav-item {
 width: 100%;
 border: 1px solid transparent;
 border-radius: 13px;
 background: transparent;
 text-align: left;
 padding: 12px;
 font: inherit;
 cursor: pointer;
 transition: background .15s ease, border-color .15s ease;
 }

 .catalog-nav-item:hover {
 background: #f7f7f5;
 }

 .catalog-nav-item.active {
 background: #f3f3f0;
 border-color: #d7d7d1;
 }

 .catalog-nav-title-row {
 display: flex;
 justify-content: space-between;
 gap: 8px;
 align-items: center;
 }

 .catalog-nav-title-row strong {
 font-size: 13px;
 }

 .catalog-nav-count {
 min-width: 26px;
 height: 22px;
 padding: 0 7px;
 display: inline-grid;
 place-items: center;
 border-radius: 999px;
 background: #ecece8;
 color: #444;
 font-size: 10px;
 font-weight: 800;
 }

 .catalog-nav-use {
 margin-top: 4px;
 color: var(--muted);
 font-size: 10px;
 line-height: 1.35;
 }

 .catalog-nav-meta {
 display: flex;
 gap: 7px;
 flex-wrap: wrap;
 margin-top: 7px;
 font-size: 9px;
 font-weight: 760;
 color: #777;
 }

 .catalog-nav-meta .editable { color: #237246; }
 .catalog-nav-meta .protected { color: #745d28; }

 .catalog-detail-panel {
 padding: 18px;
 min-width: 0;
 }

 .catalog-detail-head {
 display: flex;
 justify-content: space-between;
 gap: 18px;
 align-items: flex-start;
 margin-bottom: 14px;
 }

 .catalog-title-line {
 display: flex;
 align-items: center;
 gap: 8px;
 flex-wrap: wrap;
 }

 .catalog-detail-title {
 margin: 0;
 font-size: 20px;
 letter-spacing: -.02em;
 }

 .catalog-group-badge,
 .catalog-mini-badge {
 display: inline-flex;
 align-items: center;
 border-radius: 999px;
 border: 1px solid var(--line);
 background: #f7f7f5;
 padding: 4px 7px;
 font-size: 9px;
 font-weight: 800;
 color: #666;
 }

 .catalog-group-badge.operational { color: #216e45; background: #f4fbf6; border-color: #cfe4d7; }
 .catalog-group-badge.system { color: #66501f; background: #fffaf0; border-color: #ead9b4; }
 .catalog-group-badge.legacy { color: #666; background: #f4f4f2; }

 .catalog-detail-description {
 margin: 8px 0 0;
 color: #555;
 font-size: 12px;
 line-height: 1.5;
 max-width: 720px;
 }

 .catalog-context-line {
 display: flex;
 flex-wrap: wrap;
 gap: 8px 14px;
 margin-top: 9px;
 color: var(--muted);
 font-size: 10px;
 font-weight: 650;
 }

 .catalog-option-toolbar {
 display: grid;
 grid-template-columns: minmax(0, 1fr) 160px;
 gap: 9px;
 padding: 10px;
 border-radius: 14px;
 background: #f7f7f5;
 margin-bottom: 12px;
 }

 .catalog-option-list {
 display: grid;
 gap: 8px;
 }

 .catalog-option-row {
 display: grid;
 grid-template-columns: 34px minmax(0, 1fr) auto;
 gap: 12px;
 align-items: center;
 border: 1px solid var(--line);
 border-radius: 14px;
 padding: 12px;
 background: #fff;
 }

 .catalog-option-row.inactive {
 background: #fafaf8;
 opacity: .7;
 }

 .catalog-option-row.locked {
 background: #fcfcfa;
 }

 .catalog-option-order {
 width: 30px;
 height: 30px;
 display: grid;
 place-items: center;
 border-radius: 9px;
 background: #f1f1ee;
 color: #666;
 font-size: 10px;
 font-weight: 800;
 }

 .catalog-option-main {
 min-width: 0;
 }

 .catalog-option-name-line {
 display: flex;
 align-items: center;
 flex-wrap: wrap;
 gap: 6px;
 min-width: 0;
 }

 .catalog-option-name {
 font-size: 13px;
 }

 .catalog-mini-badge.protected { color: #6d5620; background: #fffaf0; border-color: #ead9b4; }
 .catalog-mini-badge.inactive { color: #777; }
 .catalog-mini-badge.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 650; color: #888; }

 .catalog-option-note {
 margin-top: 5px;
 color: #595959;
 font-size: 10px;
 line-height: 1.4;
 display: -webkit-box;
 -webkit-line-clamp: 2;
 -webkit-box-orient: vertical;
 overflow: hidden;
 }

 .catalog-option-usage {
 display: flex;
 flex-wrap: wrap;
 gap: 6px 12px;
 margin-top: 6px;
 color: var(--muted);
 font-size: 9px;
 }

 .catalog-option-actions {
 display: flex;
 align-items: center;
 justify-content: flex-end;
 gap: 6px;
 flex-wrap: wrap;
 }

 .catalog-icon-button {
 width: 32px;
 height: 32px;
 border: 1px solid var(--line);
 border-radius: 9px;
 background: #fff;
 color: #444;
 font: inherit;
 font-weight: 800;
 cursor: pointer;
 }

 .catalog-icon-button:disabled {
 opacity: .3;
 cursor: default;
 }

 .catalog-toggle {
 border: 1px solid var(--line);
 border-radius: 999px;
 min-width: 68px;
 padding: 7px 10px;
 font: inherit;
 font-size: 9px;
 font-weight: 800;
 cursor: pointer;
 }

 .catalog-toggle.on {
 background: #eff8f2;
 border-color: #c6dfcf;
 color: #216e45;
 }

 .catalog-toggle.off {
 background: #f4f4f2;
 color: #777;
 }

 .catalog-edit-button {
 padding: 7px 10px;
 min-height: 32px;
 }

 .catalog-foot-note {
 margin-top: 12px;
 border-top: 1px solid var(--line);
 padding-top: 12px;
 color: var(--muted);
 font-size: 10px;
 line-height: 1.5;
 }

 .catalog-empty-mini {
 color: var(--muted);
 font-size: 11px;
 padding: 14px 10px;
 }

 .catalog-system-code {
 border: 1px solid var(--line);
 border-radius: 12px;
 padding: 10px 12px;
 background: #f8f8f6;
 display: flex;
 justify-content: space-between;
 gap: 10px;
 align-items: center;
 }

 .catalog-code-label {
 color: var(--muted);
 font-size: 10px;
 font-weight: 700;
 }

 .catalog-code-value {
 font-size: 10px;
 color: #555;
 }

 .catalog-lock-note {
 border: 1px solid #ead9b4;
 background: #fffaf0;
 color: #6c5727;
 padding: 10px 12px;
 border-radius: 12px;
 font-size: 10px;
 line-height: 1.45;
 }

 .catalog-note-input {
 min-height: 86px;
 }

 @media (max-width: 980px) {
 .catalog-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .catalog-workspace { grid-template-columns: 1fr; }
 .catalog-nav-panel { position: static; }
 .catalog-nav-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 }

 @media (max-width: 640px) {
 .catalog-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .catalog-nav-list { grid-template-columns: 1fr; }
 .catalog-detail-panel { padding: 14px; }
 .catalog-detail-head { display: grid; }
 .catalog-detail-head .save-button { width: 100%; }
 .catalog-option-toolbar { grid-template-columns: 1fr; }
 .catalog-option-row { grid-template-columns: 30px minmax(0, 1fr); align-items: start; }
 .catalog-option-actions { grid-column: 2; justify-content: flex-start; margin-top: 2px; }
 .catalog-mini-badge.code { display: none; }
 .catalog-health { align-items: flex-start; }
 }

 /* ===== Variables de mensajes ===== */
 .variables-page { display: grid; gap: 16px; }
 .variables-explainer {
 display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center;
 border: 1px solid #cfe4d7; background: #f8fcf9; border-radius: 16px; padding: 14px 16px;
 }
 .variables-explainer strong { display: block; font-size: 13px; margin-bottom: 3px; }
 .variables-explainer span { display: block; color: var(--muted); font-size: 11px; line-height: 1.45; max-width: 760px; }
 .variables-explainer .save-button { white-space: nowrap; }
 .variables-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
 .variables-controls {
 display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center;
 border: 1px solid var(--line); border-radius: 15px; background: #fff; padding: 10px;
 }
 .variables-technical-toggle {
 display: inline-flex; align-items: center; gap: 8px; padding: 0 8px; color: #666; font-size: 10px; font-weight: 700; white-space: nowrap;
 }
 .variables-section { display: grid; gap: 9px; }
 .variables-section-head { display: flex; justify-content: space-between; gap: 12px; align-items: end; padding: 2px 2px 0; }
 .variables-section-head h3 { margin: 0; font-size: 14px; }
 .variables-section-head span { color: var(--muted); font-size: 10px; }
 .variable-list { display: grid; gap: 8px; }
 .variable-row {
 display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center;
 border: 1px solid var(--line); border-radius: 15px; background: #fff; padding: 12px 14px;
 }
 .variable-row.technical { background: #fbfaf7; border-color: #e8dfca; }
 .variable-row.hidden-variable { background: #fafaf8; }
 .variable-main { min-width: 0; }
 .variable-title-line { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
 .variable-name { font-size: 13px; font-weight: 800; }
 .variable-token-chip {
 display: inline-flex; align-items: center; border-radius: 8px; background: #f1f1ee; border: 1px solid #e1e1dc;
 padding: 4px 7px; color: #333; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 750;
 }
 .variable-source-chip {
 display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid var(--line); padding: 4px 7px;
 color: #666; background: #fff; font-size: 9px; font-weight: 800;
 }
 .variable-source-chip.custom { color: #216e45; border-color: #cfe4d7; background: #f4fbf6; }
 .variable-source-chip.technical { color: #6d5620; border-color: #ead9b4; background: #fffaf0; }
 .variable-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 6px; color: var(--muted); font-size: 9px; line-height: 1.4; }
 .variable-example { margin-top: 5px; color: #555; font-size: 10px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 .variable-actions { display: flex; gap: 7px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
 .variable-visibility { min-width: 96px; }
 .variable-unused-note { color: #8a8a84; }
 .variables-empty { border: 1px dashed #d6d6d0; border-radius: 15px; padding: 22px; color: var(--muted); text-align: center; font-size: 11px; }
 .custom-variable-card { border-left: 3px solid #52a36f; }
 .custom-options-preview { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
 .custom-option-chip { border-radius: 999px; background: #f3f7f4; border: 1px solid #d9e8de; padding: 4px 7px; font-size: 9px; color: #496352; }
 .custom-option-chip.default { background: #eaf6ee; color: #216e45; border-color: #c5dfce; font-weight: 800; }
 .custom-variable-editor .form-textarea { min-height: 78px; }
 .custom-options-editor { display: grid; gap: 7px; }
 .custom-option-edit-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; align-items: center; }
 .custom-option-default { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: #666; white-space: nowrap; }
 .custom-option-remove { width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font: inherit; cursor: pointer; }
 .custom-add-option { justify-self: start; }
 .custom-variable-token-preview {
 border: 1px solid var(--line); background: #f7f7f5; border-radius: 12px; padding: 10px 12px;
 display: flex; justify-content: space-between; align-items: center; gap: 10px;
 }
 .custom-variable-token-preview code { font-size: 11px; font-weight: 800; }
 .custom-variable-token-preview span { color: var(--muted); font-size: 9px; }
 .custom-resolver-box {
 display: none; gap: 9px; border: 1px solid #d8e5dc; background: #fbfefc; border-radius: 13px; padding: 11px;
 }
 .custom-resolver-box.visible { display: grid; }
 .custom-resolver-title { font-size: 11px; font-weight: 800; color: #32533d; }
 .custom-resolver-help { color: #68806f; font-size: 9px; line-height: 1.4; }
 .custom-resolver-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
 .custom-resolver-field { display: grid; gap: 4px; }
 .custom-resolver-field label { font-size: 9px; font-weight: 750; color: #657268; }

 @media (max-width: 720px) {
 .variables-explainer { grid-template-columns: 1fr; }
 .variables-explainer .save-button { width: 100%; }
 .variables-controls { grid-template-columns: 1fr; }
 .variable-row { grid-template-columns: 1fr; }
 .variable-actions { justify-content: flex-start; }
 .custom-resolver-fields { grid-template-columns: 1fr; }
 .custom-option-edit-row { grid-template-columns: minmax(0, 1fr) auto; }
 .custom-option-default { grid-column: 1 / -1; }
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
 templatesAdmin: null,
 messageTemplates: null,
 catalogsAdmin: null,
 catalogsGroup: "operational",
 catalogsSelectedKey: "forma_pago",
 catalogsSearch: "",
 catalogsOptionSearch: "",
 catalogsOptionStatus: "all",
 variablesAdmin: null,
 variablesGroup: "crm",
 variablesSearch: "",
 variablesShowTechnical: false,
 templatesFilterType: "",
 templatesFilterProject: "",
 templatesFilterStatus: "all",
 selectedCampaignProject: "",
 campaignTrendSelectionByProject: {},
 currentView: "hoy",
 hoyHasUpdate: false,
 seenHoyNewLeadIds: [],
 hoySearch: "",
 leadsSearch: "",
 leadsStage: "",
 leadsProject: "",
 leadsHideDiscarded: true,
 loadingDetailId: "",
 lastHoyLoad: 0,
 lastLeadsLoad: 0,
 lastCampaignLoad: 0,
 capiMonitorSeq: 0,
 bootstrapLoaded: false
 };

 let leadsRefreshBusy = false;
 let campaignsRefreshBusy = false;
 let coreRefreshBusy = false;

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

 const inflightGetRequests = new Map();

 async function api(path, options = {}) {
 const method = String(options.method || "GET").toUpperCase();
 if (method !== "GET") return apiRequestCore(path, options);

 // Si dos partes de la UI piden exactamente la misma lectura al mismo tiempo
 // (por ejemplo precarga de Campañas + clic del usuario), comparten una sola
 // petición en lugar de abrir dos ejecuciones de Apps Script.
 if (inflightGetRequests.has(path)) return inflightGetRequests.get(path);

 const promise = apiRequestCore(path, options)
 .finally(function() { inflightGetRequests.delete(path); });
 inflightGetRequests.set(path, promise);
 return promise;
 }

 async function apiRequestCore(path, options = {}) {
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

 // ISO timestamps with Z or an explicit UTC offset represent an absolute
 // instant. Render those in the CRM business timezone instead of displaying
 // the source offset literally.
 const hasExplicitTimezone =
 /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(text);

 if (hasExplicitTimezone) {
 const instant = new Date(text);

 if (!Number.isNaN(instant.getTime())) {
 return new Intl.DateTimeFormat(
 "es-MX",
 includeTime
 ? {
 timeZone: "America/Monterrey",
 day: "2-digit",
 month: "2-digit",
 year: "numeric",
 hour: "numeric",
 minute: "2-digit"
 }
 : {
 timeZone: "America/Monterrey",
 day: "2-digit",
 month: "2-digit",
 year: "numeric"
 }
 ).format(instant);
 }
 }

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
 ? {timeZone: "America/Monterrey", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit"}
 : {timeZone: "America/Monterrey", day: "2-digit", month: "2-digit", year: "numeric"}
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

 if (hash === "#mas/plantillas") {
 return {type: "templates"};
 }

 if (hash === "#mas/catalogos") {
 return {type: "catalogs"};
 }

 if (hash === "#mas/variables") {
 return {type: "variables"};
 }

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

 if (route.type === "templates") {
 setActiveNav("mas");
 state.currentView = "mas";
 document.getElementById("topbarTitle").textContent = "Plantillas";
 await renderTemplatesAdmin();
 restoreScroll("#mas/plantillas");
 return;
 }

 if (route.type === "catalogs") {
 setActiveNav("mas");
 state.currentView = "mas";
 document.getElementById("topbarTitle").textContent = "Catálogos";
 await renderCatalogsAdmin();
 restoreScroll("#mas/catalogos");
 return;
 }

 if (route.type === "variables") {
 setActiveNav("mas");
 state.currentView = "mas";
 document.getElementById("topbarTitle").textContent = "Variables mensajes";
 await renderMessageVariablesAdmin();
 restoreScroll("#mas/variables");
 return;
 }

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


 function applyMeToSidebar() {
 const user = state.me && state.me.usuario ? state.me.usuario : {};
 document.getElementById("sidebarUser").textContent =
 user.nombre || user.correo || "Usuario";
 document.getElementById("sidebarRole").textContent =
 [user.correo, user.rol].filter(Boolean).join(" · ");
 }

 async function loadMe(force) {
 if (state.me && !force) {
 applyMeToSidebar();
 return state.me;
 }
 state.me = await api("/api/me");
 applyMeToSidebar();
 return state.me;
 }

 async function loadBootstrap() {
 const data = await api("/api/bootstrap");
 if (!data || typeof data !== "object") {
 throw new Error("El servidor no devolvió el arranque del CRM.");
 }

 const now = Date.now();
 if (data.me && typeof data.me === "object") state.me = data.me;
 if (data.hoy && typeof data.hoy === "object") {
 state.hoy = data.hoy;
 state.lastHoyLoad = now;
 state.seenHoyNewLeadIds = getHoyNewLeadIds(data.hoy);
 }
 if (data.leads && typeof data.leads === "object" && Array.isArray(data.leads.leads)) {
 state.leads = data.leads;
 if (!Number.isFinite(Number(state.leads.total))) state.leads.total = state.leads.leads.length;
 state.lastLeadsLoad = now;
 }
 if (data.campaigns && typeof data.campaigns === "object" && Array.isArray(data.campaigns.campaigns)) {
 state.campaigns = data.campaigns;
 state.lastCampaignLoad = now;
 }
 if (data.message_templates && typeof data.message_templates === "object" && Array.isArray(data.message_templates.templates)) {
 state.messageTemplates = hideLegacyTemplateTypes(data.message_templates);
 }
 state.bootstrapLoaded = true;
 applyMeToSidebar();
 return data;
 }


 function patchCachedLeadFromDetail(lead) {
 if (!lead || !lead.crm_lead_id || !state.leads || !Array.isArray(state.leads.leads)) return;
 const index = state.leads.leads.findIndex(function(item) {
 return String(item && item.crm_lead_id || "") === String(lead.crm_lead_id);
 });
 if (index < 0) return;

 const current = state.leads.leads[index];
 [
 "nombre", "telefono", "telefono_original", "pais_telefono", "correo",
 "proyecto", "fuente", "formato", "etapa", "prioridad", "prioridad_efectiva",
 "prioridad_modo", "prioridad_motivo", "proximo_seguimiento", "fecha_cita",
 "seguimiento_actividad", "seguimiento_nota", "valor_operacion", "motivo_descarte",
 "presupuesto", "presupuesto_min_mdp", "presupuesto_max_mdp",
 "plazo", "plazo_texto_original", "plazo_min_meses", "plazo_max_meses",
 "recamaras", "flex", "forma_pago", "forma_pago_otro",
 "usuario_asignado", "campaign_id", "ad_id", "campana_nombre", "anuncio_nombre",
 "operational_version"
 ].forEach(function(key) {
 if (Object.prototype.hasOwnProperty.call(lead, key)) current[key] = lead[key];
 });
 }

 async function refreshCoreInBackground() {
 if (coreRefreshBusy) return;
 coreRefreshBusy = true;
 try {
 const data = await api("/api/bootstrap");
 if (!data || typeof data !== "object") return;
 const now = Date.now();
 if (data.me && typeof data.me === "object") {
 state.me = data.me;
 applyMeToSidebar();
 }
 if (data.hoy && typeof data.hoy === "object") {
 state.hoy = data.hoy;
 state.lastHoyLoad = now;
 }
 if (data.leads && typeof data.leads === "object" && Array.isArray(data.leads.leads)) {
 state.leads = data.leads;
 if (!Number.isFinite(Number(state.leads.total))) state.leads.total = state.leads.leads.length;
 state.lastLeadsLoad = now;
 }
 if (data.message_templates && typeof data.message_templates === "object" && Array.isArray(data.message_templates.templates)) {
 state.messageTemplates = hideLegacyTemplateTypes(data.message_templates);
 }

 const route = parseRoute();
 if (route.type === "view" && route.view === "hoy") {
 await renderHoy(false, true);
 } else if (route.type === "view" && route.view === "leads") {
 await renderLeads(false, true);
 }
 } finally {
 coreRefreshBusy = false;
 }
 }

 async function refreshLeadsInBackground() {
 if (leadsRefreshBusy) return;
 leadsRefreshBusy = true;
 try {
 const fresh = await api("/api/leads?limit=500");
 if (!fresh || typeof fresh !== "object" || !Array.isArray(fresh.leads)) return;
 if (!Number.isFinite(Number(fresh.total))) fresh.total = fresh.leads.length;
 state.leads = fresh;
 state.lastLeadsLoad = Date.now();
 const route = parseRoute();
 if (route.type === "view" && route.view === "leads") {
 await renderLeads(false, true);
 }
 } catch (error) {
 reportClientError(error, {accion: "leads.background.refresh", endpoint: "/api/leads"});
 } finally {
 leadsRefreshBusy = false;
 }
 }

 async function refreshCampaignsInBackground() {
 if (campaignsRefreshBusy) return;
 campaignsRefreshBusy = true;
 try {
 const fresh = await api("/api/campaigns");
 if (!fresh || typeof fresh !== "object" || !Array.isArray(fresh.campaigns)) return;
 state.campaigns = fresh;
 state.lastCampaignLoad = Date.now();
 const route = parseRoute();
 if (route.type === "view" && route.view === "campanas") {
 await renderCampanas(false, true);
 }
 } catch (error) {
 reportClientError(error, {accion: "campaigns.background.refresh", endpoint: "/api/campaigns"});
 } finally {
 campaignsRefreshBusy = false;
 }
 }

 async function loadHoy(force) {
 const now = Date.now();
 if (state.hoy && !force) {
 if (!state.lastHoyLoad || now - state.lastHoyLoad >= 45 * 1000) {
 pollHoyInBackground(true);
 }
 return state.hoy;
 }
 state.hoy = await api("/api/hoy");
 if (!state.hoy || typeof state.hoy !== "object") {
 throw new Error("El servidor no devolvió una agenda válida.");
 }
 state.lastHoyLoad = Date.now();
 return state.hoy;
 }

 async function loadLeads(force) {
 const now = Date.now();
 if (state.leads && !force) {
 if (!state.lastLeadsLoad || now - state.lastLeadsLoad >= 120 * 1000) {
 refreshLeadsInBackground();
 }
 return state.leads;
 }
 state.leads = await api("/api/leads?limit=500");
 if (!state.leads || typeof state.leads !== "object" || !Array.isArray(state.leads.leads)) {
 throw new Error("El servidor no devolvió una lista de leads válida.");
 }
 if (!Number.isFinite(Number(state.leads.total))) state.leads.total = state.leads.leads.length;
 state.lastLeadsLoad = Date.now();
 return state.leads;
 }

 async function loadCampaigns(force) {
 const now = Date.now();
 if (state.campaigns && !force) {
 if (!state.lastCampaignLoad || now - state.lastCampaignLoad >= 120 * 1000) {
 refreshCampaignsInBackground();
 }
 return state.campaigns;
 }
 state.campaigns = await api("/api/campaigns");
 if (!state.campaigns || typeof state.campaigns !== "object" || !Array.isArray(state.campaigns.campaigns)) {
 throw new Error("El servidor no devolvió métricas de campañas válidas.");
 }
 state.lastCampaignLoad = Date.now();
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


 function shortOperationalDateTime(value) {
 let formatted = formatDateValue(value, true);
 if (!formatted) return '';
 formatted = String(formatted).replace(', ', ' · ');
 const slashParts = formatted.split(' · ');
 const datePart = slashParts[0] || '';
 const datePieces = datePart.split('/');
 const shortDate = datePieces.length === 3
 ? datePieces[0] + '/' + datePieces[1]
 : datePart;
 return slashParts[1] ? shortDate + ' · ' + slashParts[1] : shortDate;
 }


 function compactSnippet(value, maxLength) {
 const text = String(value || '')
 .replaceAll(String.fromCharCode(10), ' ')
 .replaceAll(String.fromCharCode(13), ' ')
 .replaceAll(String.fromCharCode(9), ' ')
 .split(' ')
 .filter(Boolean)
 .join(' ')
 .trim();
 const limit = Number(maxLength || 92);
 if (!text || text.length <= limit) return text;
 return text.substring(0, Math.max(1, limit - 1)).trimEnd() + '…';
 }


 function leadNextSummary(lead) {
 if (lead.proximo_seguimiento) {
 const when = shortOperationalDateTime(lead.proximo_seguimiento);
 const activity = String(lead.seguimiento_actividad || '').trim();
 return [when, activity].filter(Boolean).join(' · ');
 }
 if (lead.fecha_cita) {
 const when = shortOperationalDateTime(lead.fecha_cita);
 return when ? 'Cita · ' + when : '';
 }
 return 'Sin seguimiento';
 }


 function leadLastSummary(lead) {
 const tipo = String(lead.ultimo_resumen_tipo || '').trim();
 let text = String(lead.ultimo_resumen_texto || '').trim();
 if (!text) text = String(lead.notas_legacy || '').trim();
 if (!text) return '';
 return (tipo ? tipo + ' · ' : '') + compactSnippet(text, 110);
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

 const ops = element("div", "lead-ops");
 const nextLine = element("div", "lead-ops-line next");
 nextLine.append(
 element("span", "lead-ops-label", "Próx."),
 element("span", "lead-ops-text", leadNextSummary(lead))
 );
 ops.appendChild(nextLine);

 const lastSummary = leadLastSummary(lead);
 if (lastSummary) {
 const lastLine = element("div", "lead-ops-line");
 lastLine.append(
 element("span", "lead-ops-label", "Último"),
 element("span", "lead-ops-text", lastSummary)
 );
 ops.appendChild(lastLine);
 }
 left.appendChild(ops);

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
 const hadCachedData = !!state.hoy;

 if (!silent && !hadCachedData) {
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
 markCurrentHoyAsSeen();

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
 const hadCachedData = !!state.leads;

 if (!silent && !hadCachedData) {
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

 const discardedTotal = list.leads.filter(function(lead) {
 return String(lead.etapa || "").trim() === "Descartado";
 }).length;
 const visibleBaseTotal = state.leadsHideDiscarded
 ? Math.max(0, list.leads.length - discardedTotal)
 : list.leads.length;

 const leadsHero = createHero(
 "Base comercial",
 "Leads",
 state.leadsHideDiscarded
 ? visibleBaseTotal + " leads activos" + (discardedTotal ? " · " + discardedTotal + " descartados ocultos" : "")
 : list.leads.length + " leads"
 );
 const leadsHeroSubtitle = leadsHero.querySelector(".page-subtitle");
 content.appendChild(leadsHero);

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

 const optionsRow = element("div", "leads-options-row");
 const hideDiscardedLabel = element("label", "leads-hide-discarded");
 const hideDiscardedCheck = document.createElement("input");
 hideDiscardedCheck.type = "checkbox";
 hideDiscardedCheck.checked = !!state.leadsHideDiscarded;
 const hideDiscardedText = document.createTextNode(" No mostrar descartados");
 hideDiscardedLabel.append(hideDiscardedCheck, hideDiscardedText);
 const hiddenCountText = element(
 "div",
 "leads-hidden-count",
 discardedTotal
 ? discardedTotal + (discardedTotal === 1 ? " descartado" : " descartados")
 : "Sin descartados"
 );
 optionsRow.append(hideDiscardedLabel, hiddenCountText);
 content.appendChild(optionsRow);

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

 if (leadsHeroSubtitle) {
 leadsHeroSubtitle.textContent = state.leadsHideDiscarded
 ? visibleBaseTotal + " leads activos" + (discardedTotal ? " · " + discardedTotal + " descartados ocultos" : "")
 : list.leads.length + " leads";
 }

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
 state.leadsHideDiscarded &&
 String(lead.etapa || "").trim() === "Descartado"
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
 function() {
 if (stageSelect.value === "Descartado" && hideDiscardedCheck.checked) {
 hideDiscardedCheck.checked = false;
 state.leadsHideDiscarded = false;
 }
 draw();
 }
 );

 hideDiscardedCheck.addEventListener(
 "change",
 function() {
 state.leadsHideDiscarded = !!hideDiscardedCheck.checked;
 if (state.leadsHideDiscarded && stageSelect.value === "Descartado") {
 stageSelect.value = "";
 state.leadsStage = "";
 }
 draw();
 }
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


 function wireDateTabToTime(dateInput, timeInput) {
 if (!dateInput || !timeInput) return;
 dateInput.addEventListener("keydown", function(event) {
 if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
 event.preventDefault();
 normalizeMxDateField(dateInput);
 timeInput.focus();
 if (typeof timeInput.select === "function") timeInput.select();
 });
 }


 function createMxDateControl(value) {
 const root = element("div", "mx-date-control");
 const input = element("input", "form-control mx-date-text");
 configureMxDateInput(input, value);

 const pickerWrap = element("div", "mx-date-picker-wrap");
 pickerWrap.setAttribute("aria-label", "Abrir calendario");
 const picker = element("input", "mx-date-picker");
 picker.type = "date";
 // El calendario sigue disponible con clic, pero no interrumpe la navegación por Tab.
 // Así, al salir del campo de fecha, el foco pasa directamente al campo de hora.
 picker.tabIndex = -1;
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


 function monterreyTodayIso() {
 const parts = new Intl.DateTimeFormat("en-US", {
 timeZone: "America/Monterrey",
 year: "numeric",
 month: "2-digit",
 day: "2-digit"
 }).formatToParts(new Date());
 let year = "";
 let month = "";
 let day = "";
 parts.forEach(function(part) {
 if (part.type === "year") year = part.value;
 if (part.type === "month") month = part.value;
 if (part.type === "day") day = part.value;
 });
 return year && month && day ? year + "-" + month + "-" + day : "";
 }


 function addCalendarDaysIso(isoDate, days) {
 const pieces = String(isoDate || "").split("-");
 if (pieces.length !== 3) return "";
 const year = Number(pieces[0]);
 const month = Number(pieces[1]);
 const day = Number(pieces[2]);
 if (!year || !month || !day) return "";
 const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12, 0, 0));
 return String(date.getUTCFullYear()).padStart(4, "0") + "-" +
 String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
 String(date.getUTCDate()).padStart(2, "0");
 }


 function automaticFollowupDefault(existingValue) {
 const today = monterreyTodayIso();
 const existing = parseLeadDateParts(existingValue);

 // Si ya existe un seguimiento FUTURO, se respeta.
 // Si está vacío, vencido o es para hoy, proponemos mañana a las 09:00.
 if (today && existing.date && existing.date > today) {
 const futureTime = existing.time || "09:00";
 return {
 value: existing.date + "T" + futureTime,
 time: futureTime
 };
 }

 const tomorrow = addCalendarDaysIso(today, 1);
 return {
 value: tomorrow ? tomorrow + "T09:00" : existingValue || "",
 time: tomorrow ? "09:00" : (existing.time || "09:00")
 };
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


 function contactOrdinalLabel(number) {
 const n = Math.max(1, Number(number) || 1);
 const labels = {
 1: "Primer contacto",
 2: "Segundo contacto",
 3: "Tercer contacto",
 4: "Cuarto contacto",
 5: "Quinto contacto",
 6: "Sexto contacto",
 7: "Séptimo contacto",
 8: "Octavo contacto",
 9: "Noveno contacto",
 10: "Décimo contacto"
 };
 return labels[n] || ("Contacto #" + n);
 }

 function historyLocalMillis(value) {
 const text = String(value || "").trim();
 if (!text) return NaN;
 let match = text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?/);
 if (match) {
 return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6] || 0)).getTime();
 }
 match = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?/);
 if (match) {
 return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)).getTime();
 }
 const parsed = Date.parse(text);
 return Number.isFinite(parsed) ? parsed : NaN;
 }

 function isContactadoTransition(event) {
 return normalized(event && event.tipo_evento) === "cambio_campo" &&
 normalized(event && event.campo) === "etapa" &&
 normalized(event && event.valor_nuevo) === "contactado";
 }

 function isConfirmedMessageEvent(event) {
 return normalized(event && event.tipo_evento) === "mensaje" &&
 normalized(event && event.canal) === "whatsapp" &&
 normalized(event && event.resultado) === "confirmado_usuario";
 }

 function contactAttemptCount(historial, lead) {
 const events = Array.isArray(historial) ? historial : [];
 const transitions = events.filter(isContactadoTransition).map(function(event, index) {
 return {index: index, time: historyLocalMillis(event && event.fecha_hora), matched: false};
 });
 const messages = events.filter(isConfirmedMessageEvent);
 let count = transitions.length;

 // Un WhatsApp confirmado en la misma operación que Nuevo → Contactado no es
 // un contacto adicional: es la evidencia del mismo primer contacto.
 messages.forEach(function(event) {
 const messageTime = historyLocalMillis(event && event.fecha_hora);
 let best = -1;
 let bestDistance = Infinity;
 if (Number.isFinite(messageTime)) {
 transitions.forEach(function(item, index) {
 if (item.matched || !Number.isFinite(item.time)) return;
 const distance = Math.abs(item.time - messageTime);
 if (distance <= 2 * 60 * 1000 && distance < bestDistance) {
 best = index;
 bestDistance = distance;
 }
 });
 }
 if (best >= 0) {
 transitions[best].matched = true;
 } else {
 count++;
 }
 });

 // Compatibilidad con historiales antiguos que ya estaban avanzados antes de
 // que registráramos MENSAJE en Historial CRM.
 if (count === 0) {
 const stage = normalized(lead && lead.etapa);
 if (["contactado", "calificado", "cita agendada", "compra", "no responde"].indexOf(stage) !== -1) {
 count = 1;
 }
 }
 return count;
 }

 function contactTemplateTypeForOrdinal(number) {
 const n = Math.max(1, Number(number) || 1);
 if (n === 1) return "PRIMER_CONTACTO";
 if (n === 2) return "SEGUNDO_CONTACTO";
 if (n === 3) return "TERCER_CONTACTO";
 return "CUARTO_MAS";
 }

 function isAppointmentConfirmationFollowup(lead) {
 return normalized(lead && lead.seguimiento_nota).indexOf("confirmar cita") === 0;
 }

 function followupDescriptor(historial, lead, options) {
 const opts = options || {};
 if (isAppointmentConfirmationFollowup(lead) && !opts.pendingContact) {
 return {label: "Confirmación de cita", ordinal: 0, templateTypes: ["CONFIRMACION_CITA"]};
 }
 const completed = contactAttemptCount(historial, lead);
 const ordinal = Math.max(1, completed + 1 + (opts.pendingContact ? 1 : 0));
 const types = [contactTemplateTypeForOrdinal(ordinal)];
 if (normalized(lead && lead.etapa) === "no responde") types.push("NO_RESPONDE", "RECONTACTO");
 return {
 label: contactOrdinalLabel(ordinal),
 ordinal: ordinal,
 templateTypes: Array.from(new Set(types))
 };
 }

 function followupSequenceBox(historial, lead, options) {
 const descriptor = followupDescriptor(historial, lead, options);
 const box = element("div", "followup-sequence-box");
 box.appendChild(element("div", "followup-sequence-label", "Tipo de seguimiento"));
 const value = element("div", "followup-sequence-value", descriptor.label);
 box.appendChild(value);
 box._sequenceValue = value;
 return box;
 }

 function updateFollowupSequenceBox(box, historial, lead, options) {
 if (!box) return;
 const descriptor = followupDescriptor(historial, lead, options);
 const value = box._sequenceValue || box.querySelector(".followup-sequence-value");
 if (value) value.textContent = descriptor.label;
 }


 function makeOperationEditor(lead, options, crmLeadId, fromView, historial) {
 const wrap = element("div", "operation-summary");

 addEditableInfoRow(
 wrap,
 "Etapa",
 lead.etapa || "Sin etapa",
 "",
 function() { openStagePopover(lead, options, crmLeadId, fromView, historial); }
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
 const currentFollowupType = lead.proximo_seguimiento
 ? followupDescriptor(historial, lead).label
 : "";
 const followupSub = [currentFollowupType, lead.seguimiento_actividad, lead.seguimiento_nota].filter(Boolean).join(" · ");
 addEditableInfoRow(
 wrap,
 "Próximo seguimiento",
 followupText,
 followupSub,
 function() { openFollowupPopover(lead, options, crmLeadId, fromView, historial); }
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

 function addActionInfoRow(card, label, value, actionLabel, onAction) {
 if (
 value === "" ||
 value === null ||
 value === undefined ||
 value === false
 ) {
 return;
 }

 const row = element("div", "editable-info-row");
 row.appendChild(element("div", "info-label", label));

 const valueWrap = element("div", "editable-value-wrap");
 valueWrap.appendChild(element("div", "info-value", value === true ? "Sí" : value));
 row.appendChild(valueWrap);

 const action = element("button", "edit-link", actionLabel || "Abrir");
 action.type = "button";
 action.setAttribute("aria-label", (actionLabel || "Abrir") + " " + label);
 action.addEventListener("click", onAction);
 row.appendChild(action);
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

 async function saveLeadPatch(lead, crmLeadId, fromView, changes, messageContext) {
 const expectedStage = changes && changes.etapa && normalized(changes.etapa) !== normalized(lead.etapa)
 ? String(changes.etapa)
 : "";
 const hasMetaLeadId = !!(lead && lead.adquisicion_meta && lead.adquisicion_meta.lead_id);
 const capiStages = ["Contactado", "No responde", "Calificado", "Cita agendada", "Compra", "Descartado"];
 const shouldMonitorCapi = expectedStage && hasMetaLeadId && capiStages.indexOf(expectedStage) !== -1;
 const capiSinceMs = shouldMonitorCapi ? Date.now() : 0;

 let updateResult;
 try {
 updateResult = await api("/api/leads/" + encodeURIComponent(crmLeadId), {
 method: "PATCH",
 headers: {"Content-Type": "application/json"},
 body: JSON.stringify({expected_version: lead.operational_version, changes, message_context: messageContext || null})
 });
 } catch (error) {
 // Si una escritura anterior ya se aplicó pero la ficha/modal conservó una
 // versión vieja, la API protege correctamente con LEAD_CHANGED. En vez de
 // mostrar un falso error, releemos la ficha y comprobamos si los cambios que
 // el usuario pidió YA están guardados. Solo en ese caso lo tratamos como éxito.
 const isStale = String(error && error.message || "").indexOf("Este lead cambió desde que abrió la ficha") !== -1;
 if (!isStale) throw error;

 const freshDetail = await api("/api/leads/" + encodeURIComponent(crmLeadId));
 const freshLead = freshDetail && freshDetail.lead ? freshDetail.lead : null;
 if (!freshLead || !leadAlreadyReflectsPatch(freshLead, changes)) throw error;

 patchCachedLeadFromDetail(freshLead);
 await renderLeadDetail(crmLeadId, fromView, freshDetail);
 state.lastHoyLoad = 0;
 state.lastLeadsLoad = 0;
 setTimeout(function() {
 refreshCoreInBackground().catch(function(refreshError) {
 reportClientError(refreshError, {accion: "core.postwrite.recovery.refresh", endpoint: "/api/bootstrap"});
 });
 }, 80);

 if (shouldMonitorCapi) {
 startCapiStatusMonitor(crmLeadId, expectedStage, Math.max(0, capiSinceMs - 120000));
 }
 return freshDetail;
 }
 // Conservamos los datos ya cargados para que volver a Hoy/Leads sea inmediato.
 // Solo los marcamos como vencidos y los refrescamos silenciosamente después.
 state.lastHoyLoad = 0;
 state.lastLeadsLoad = 0;

 const returnedDetail = updateResult && updateResult.detail ? updateResult.detail : null;
 patchCachedLeadFromDetail(returnedDetail && returnedDetail.lead);
 await renderLeadDetail(crmLeadId, fromView, returnedDetail);

 // Un solo bootstrap actualiza Hoy + Leads con UNA ejecución de Apps Script.
 setTimeout(function() {
 refreshCoreInBackground().catch(function(error) {
 reportClientError(error, {accion: "core.postwrite.refresh", endpoint: "/api/bootstrap"});
 });
 }, 80);

 if (shouldMonitorCapi) {
 startCapiStatusMonitor(crmLeadId, expectedStage, capiSinceMs);
 }
 }

 function leadPatchDateKey(value) {
 const parts = parseLeadDateParts(value);
 if (!parts || !parts.date) return "";
 return parts.date + "T" + (parts.time || "");
 }

 function leadPatchComparable(value) {
 if (value === null || value === undefined) return "";
 if (typeof value === "boolean") return value ? "1" : "0";
 return String(value).trim();
 }

 function leadAlreadyReflectsPatch(freshLead, changes) {
 if (!freshLead || !changes || typeof changes !== "object") return false;
 const ignored = {confirmar_numero_erroneo: true};
 const dateFields = {proximo_seguimiento: true, fecha_cita: true};
 const booleanFields = {flex: true};
 const numericFields = {
 valor_operacion: true,
 presupuesto_min_mdp: true,
 presupuesto_max_mdp: true,
 plazo_min_meses: true,
 plazo_max_meses: true
 };
 const aliases = {plazo_texto_manual: "plazo"};
 const keys = Object.keys(changes).filter(function(key) { return !ignored[key]; });
 if (!keys.length) return false;

 return keys.every(function(key) {
 const actualKey = aliases[key] || key;
 const expected = changes[key];
 const actual = freshLead[actualKey];

 if (dateFields[key]) {
 return leadPatchDateKey(expected) === leadPatchDateKey(actual);
 }
 if (booleanFields[key]) {
 return Boolean(expected) === Boolean(actual);
 }
 if (numericFields[key]) {
 const a = Number(expected);
 const b = Number(actual);
 if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
 return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
 }
 if (key === "etapa" || key === "prioridad" || key === "motivo_descarte" || key === "forma_pago") {
 return normalized(expected) === normalized(actual);
 }
 return leadPatchComparable(expected) === leadPatchComparable(actual);
 });
 }

 function firstNameForMessage(value) {
 const text = String(value || "").trim();
 if (!text) return "";
 const firstSpace = text.indexOf(" ");
 return firstSpace >= 0 ? text.slice(0, firstSpace) : text;
 }

 function compactMdpNumber(value) {
 const number = Number(value);
 if (!Number.isFinite(number)) return "";
 return number.toLocaleString("es-MX", {minimumFractionDigits: number % 1 ? 1 : 0, maximumFractionDigits: 2});
 }

 function messageBudgetValue(lead) {
 const direct = String(lead && lead.presupuesto || "").trim();
 if (direct) return direct;
 const min = lead && lead.presupuesto_min_mdp;
 const max = lead && lead.presupuesto_max_mdp;
 if (Number.isFinite(Number(min)) && Number.isFinite(Number(max))) {
 if (Number(min) === Number(max)) return "$" + compactMdpNumber(min) + " MDP";
 return "$" + compactMdpNumber(min) + "–" + compactMdpNumber(max) + " MDP";
 }
 if (Number.isFinite(Number(min))) return "Desde $" + compactMdpNumber(min) + " MDP";
 if (Number.isFinite(Number(max))) return "Hasta $" + compactMdpNumber(max) + " MDP";
 return "";
 }

 function messageBedroomsValue(lead) {
 const base = String(lead && lead.recamaras || "").trim();
 if (!base) return lead && lead.flex ? "Flex" : "";
 if (lead && lead.flex && normalized(base).indexOf("flex") === -1) return base + " + Flex";
 return base;
 }

 function messageTermValue(lead) {
 const direct = String(lead && lead.plazo || "").trim();
 if (direct) return direct;
 const min = lead && lead.plazo_min_meses;
 const max = lead && lead.plazo_max_meses;
 if (Number.isFinite(Number(min)) && Number.isFinite(Number(max))) {
 if (Number(min) === Number(max)) return String(min) + " meses";
 return String(min) + "–" + String(max) + " meses";
 }
 return "";
 }

 function messageVariableMap(lead) {
 const me = state.me || {};
 const user = me.usuario || {};
 const fullName = String(lead && lead.nombre || "").trim();
 const firstName = firstNameForMessage(fullName);
 const dynamic = lead && lead.message_variable_values && typeof lead.message_variable_values === "object"
 ? lead.message_variable_values
 : {};
 const values = Object.assign({}, dynamic);
 values["{nombre}"] = firstName;
 values["{nombre_completo}"] = fullName;
 values["{proyecto}"] = String(lead && lead.proyecto || "");
 values["{presupuesto}"] = messageBudgetValue(lead || {});
 values["{recamaras}"] = messageBedroomsValue(lead || {});
 values["{plazo}"] = messageTermValue(lead || {});
 values["{forma_pago}"] = String(lead && (normalized(lead.forma_pago) === "otro" ? (lead.forma_pago_otro || lead.forma_pago) : (lead.forma_pago || lead.forma_pago_otro)) || "");
 values["{fecha_cita}"] = lead && lead.fecha_cita ? formatDateValue(lead.fecha_cita, true) : "";
 values["{inmobiliaria}"] = String(me.inmobiliaria || "OV Real Estate");
 values["{asesor}"] = firstNameForMessage(user.nombre || user.correo || "");
 return values;
 }

 function renderMessageTemplateForLead(message, lead, customValues) {
 let text = String(message || "");
 const values = Object.assign({}, messageVariableMap(lead || {}), customValues || {});
 Object.keys(values).forEach(function(token) {
 text = text.split(token).join(values[token] == null ? "" : String(values[token]));
 });
 return text;
 }

 function whatsappPhoneDigits(lead) {
 let raw = String(lead && (lead.telefono_normalizado || lead.telefono || lead.telefono_original) || "").trim();
 raw = raw.replace(/^p:/i, "");
 let digits = raw.replace(/\D/g, "");
 if (digits.indexOf("00") === 0) digits = digits.substring(2);
 return digits;
 }

 function openWhatsAppMac(lead, message) {
 const phone = whatsappPhoneDigits(lead);
 if (!phone) throw new Error("Este lead no tiene un teléfono válido para WhatsApp.");
 let target = "whatsapp://send?phone=" + encodeURIComponent(phone);
 const text = String(message || "");
 if (text) target += "&text=" + encodeURIComponent(text);
 const link = document.createElement("a");
 link.href = target;
 link.style.display = "none";
 document.body.appendChild(link);
 link.click();
 setTimeout(function() { link.remove(); }, 1000);
 }

 function hideLegacyTemplateTypes(data) {
 if (!data || typeof data !== "object") return data;
 if (Array.isArray(data.tipos)) {
 data.tipos = data.tipos.filter(function(item) {
 return String(item && item.codigo || "").toUpperCase() !== "PRIMER_SEGUIMIENTO";
 });
 }
 return data;
 }

 async function loadMessageTemplates() {
 if (state.messageTemplates && Array.isArray(state.messageTemplates.templates)) {
 return state.messageTemplates;
 }

 // Normalmente llega precargado en /api/bootstrap. Este fallback existe para
 // sesiones antiguas o recargas parciales; nunca debe dejar el modal colgado.
 const timeout = new Promise(function(_, reject) {
 setTimeout(function() {
 reject(new Error("Las plantillas tardaron demasiado en cargar. Cierre y vuelva a abrir este cuadro."));
 }, 12000);
 });
 const data = hideLegacyTemplateTypes(await Promise.race([
 api("/api/templates"),
 timeout
 ]));
 state.messageTemplates = data;
 return data;
 }

 function templateTypesForFollowup(lead, historial) {
 return followupDescriptor(historial, lead).templateTypes;
 }

 function templateTypesForContact(lead, historial) {
 const ordinal = Math.max(1, contactAttemptCount(historial, lead) + 1);
 const types = [];
 if (normalized(lead && lead.etapa) === "no responde") types.push("RECONTACTO");
 types.push(contactTemplateTypeForOrdinal(ordinal));
 return Array.from(new Set(types));
 }

 function eligibleMessageTemplates(data, lead, requestedTypes) {
 const types = Array.isArray(requestedTypes) ? requestedTypes.filter(Boolean) : [];
 const project = normalized(lead && lead.proyecto);
 return (data && Array.isArray(data.templates) ? data.templates : [])
 .filter(function(template) {
 if (!template || !template.activo) return false;
 if (String(template.tipo_mensaje || "").toUpperCase() === "PRIMER_SEGUIMIENTO") return false;
 const scope = String(template.alcance || "GLOBAL").toUpperCase();
 if (scope === "PROYECTO" && normalized(template.proyecto) !== project) return false;
 return true;
 })
 .sort(function(a, b) {
 const at = String(a.tipo_mensaje || "").toUpperCase();
 const bt = String(b.tipo_mensaje || "").toUpperCase();
 const ai = types.indexOf(at);
 const bi = types.indexOf(bt);
 const ar = ai >= 0 ? ai : (at === "GENERAL" ? types.length : types.length + 1);
 const br = bi >= 0 ? bi : (bt === "GENERAL" ? types.length : types.length + 1);
 if (ar !== br) return ar - br;
 const ap = a.alcance === "PROYECTO" ? 0 : 1;
 const bp = b.alcance === "PROYECTO" ? 0 : 1;
 if (ap !== bp) return ap - bp;
 if (!!a.predeterminada !== !!b.predeterminada) return a.predeterminada ? -1 : 1;
 return Number(a.orden || 0) - Number(b.orden || 0);
 });
 }

 function templateCustomVariables(data, template) {
 const message = String(template && template.mensaje || "");
 const all = data && Array.isArray(data.all_variables)
 ? data.all_variables
 : (data && Array.isArray(data.variables) ? data.variables : []);
 return all.filter(function(variable) {
 return variable && String(variable.tipo_fuente || "").toUpperCase() === "CUSTOM" && variable.activa !== false && variable.token && message.indexOf(variable.token) !== -1;
 });
 }

 function createWhatsAppComposer(lead, config) {
 const opts = config || {};
 const root = element("div", "confirm-box whatsapp-composer");
 root.style.display = "none";
 root.appendChild(element("div", "form-label", opts.title || "WhatsApp / Mensaje"));

 const mode = element("select", "form-control");
 [["TEMPLATE", "Usar plantilla"], ["CUSTOM", "Mensaje personalizado"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 mode.appendChild(option);
 });
 root.appendChild(popoverField("Cómo quieres preparar el mensaje", mode));

 const templateSelect = element("select", "form-control");
 const templateField = popoverField("Plantilla", templateSelect);
 root.appendChild(templateField);

 const customResolver = element("div", "custom-resolver-box");
 customResolver.appendChild(element("div", "custom-resolver-title", "Completar variables"));
 customResolver.appendChild(element("div", "custom-resolver-help", "Estas variables no vienen del lead. Complétalas antes de editar o abrir el mensaje."));
 const customResolverFields = element("div", "custom-resolver-fields");
 customResolver.appendChild(customResolverFields);
 root.appendChild(customResolver);

 const message = element("textarea", "form-control form-textarea");
 message.placeholder = "Puedes editar el texto aquí. Si prefieres escribir directamente en WhatsApp, déjalo en blanco.";
 const messageField = popoverField("Mensaje", message);
 root.appendChild(messageField);

 const helper = element("div", "popover-help", "La plantilla solo prepara el texto. Puedes modificarlo antes de abrir WhatsApp.");
 root.appendChild(helper);

 const row = element("div", "whatsapp-actions");
 const open = element("button", "secondary-button", "Abrir WhatsApp");
 open.type = "button";
 const status = element("div", "save-status");
 row.append(open);
 root.append(row, status);

 const sentLabel = element("label", "confirm-line whatsapp-sent-confirm");
 const sent = element("input");
 sent.type = "checkbox";
 sentLabel.append(sent, document.createTextNode(" Confirmo que envié el mensaje"));
 root.appendChild(sentLabel);

 let data = null;
 let loaded = false;
 let loading = null;
 let currentTypes = Array.isArray(opts.types) ? opts.types.slice() : [];
 let currentCustomVariables = [];
 let customValues = {};

 function selectedTemplate() {
 if (!data) return null;
 const id = String(templateSelect.value || "");
 return (data.templates || []).find(function(item) { return item.template_id === id; }) || null;
 }

 function unresolvedCustomVariables() {
 return currentCustomVariables.filter(function(variable) {
 return !String(customValues[variable.token] || "").trim();
 });
 }

 function regenerateTemplateMessage() {
 const template = selectedTemplate();
 if (!template) return;
 message.value = renderMessageTemplateForLead(template.mensaje, lead, customValues);
 const unresolved = unresolvedCustomVariables();
 message.disabled = unresolved.length > 0;
 if (unresolved.length) {
 helper.textContent = "Completa " + unresolved.map(function(v) { return v.nombre || v.token; }).join(", ") + " para generar el mensaje.";
 } else {
 helper.textContent = "Puedes editar el texto generado sin modificar la plantilla original.";
 }
 }

 function rebuildCustomResolver() {
 const template = selectedTemplate();
 currentCustomVariables = templateCustomVariables(data, template);
 customValues = {};
 customResolverFields.replaceChildren();
 customResolver.classList.toggle("visible", currentCustomVariables.length > 0);

 currentCustomVariables.forEach(function(variable) {
 const field = element("div", "custom-resolver-field");
 field.appendChild(element("label", "", variable.nombre || variable.token));
 let control;
 if (String(variable.formato || "").toLowerCase() === "lista") {
 control = element("select", "form-control");
 const blank = element("option", "", "Seleccionar…");
 blank.value = "";
 control.appendChild(blank);
 const options = Array.isArray(variable.opciones) ? variable.opciones.filter(function(o) { return o && o.activo !== false; }) : [];
 options.forEach(function(item) {
 const option = element("option", "", item.etiqueta || item.valor);
 option.value = item.valor;
 if (item.predeterminado) option.selected = true;
 control.appendChild(option);
 });
 if (control.value) customValues[variable.token] = control.value;
 control.addEventListener("change", function() {
 customValues[variable.token] = control.value;
 regenerateTemplateMessage();
 });
 } else {
 control = element("input", "form-control");
 control.type = "text";
 control.placeholder = variable.ejemplo ? "Ej. " + variable.ejemplo : "Escribe un valor";
 control.addEventListener("input", function() {
 customValues[variable.token] = control.value.trim();
 regenerateTemplateMessage();
 });
 }
 field.appendChild(control);
 customResolverFields.appendChild(field);
 });
 regenerateTemplateMessage();
 }

 function fillFromSelectedTemplate() {
 const template = selectedTemplate();
 if (!template) {
 currentCustomVariables = [];
 customValues = {};
 customResolver.classList.remove("visible");
 customResolverFields.replaceChildren();
 message.value = "";
 message.disabled = false;
 return;
 }
 rebuildCustomResolver();
 }

 function rebuildTemplateSelect() {
 const list = eligibleMessageTemplates(data, lead, currentTypes);
 templateSelect.replaceChildren();
 const blank = element("option", "", list.length ? "Seleccione una plantilla" : "No hay plantillas para este contexto");
 blank.value = "";
 templateSelect.appendChild(blank);
 list.forEach(function(template) {
 const typeInfo = (data.tipos || []).find(function(item) { return item.codigo === template.tipo_mensaje; });
 const typeLabel = typeInfo ? typeInfo.nombre : template.tipo_mensaje;
 const label = template.nombre + " · " + typeLabel + (template.alcance === "PROYECTO" ? " · " + template.proyecto : " · Global");
 const option = element("option", "", label);
 option.value = template.template_id;
 templateSelect.appendChild(option);
 });
 const preferred = list.find(function(item) {
 return item.predeterminada && currentTypes.indexOf(String(item.tipo_mensaje || "").toUpperCase()) !== -1;
 }) || list.find(function(item) {
 return currentTypes.indexOf(String(item.tipo_mensaje || "").toUpperCase()) !== -1;
 }) || list.find(function(item) { return item.predeterminada; }) || list[0];
 if (preferred) {
 templateSelect.value = preferred.template_id;
 fillFromSelectedTemplate();
 } else {
 mode.value = "CUSTOM";
 message.value = "";
 syncMode();
 }
 }

 async function ensureLoaded() {
 if (loaded) return data;
 if (loading) return loading;
 status.className = "save-status";
 status.textContent = "Cargando plantillas…";
 loading = loadMessageTemplates().then(function(result) {
 data = result || {templates: []};
 loaded = true;
 rebuildTemplateSelect();
 status.textContent = "";
 return data;
 }).catch(function(error) {
 status.className = "save-status error";
 status.textContent = error.message || "No se pudieron cargar las plantillas.";
 throw error;
 }).finally(function() { loading = null; });
 return loading;
 }

 function syncMode() {
 const usingTemplate = mode.value === "TEMPLATE";
 templateField.style.display = usingTemplate ? "grid" : "none";
 customResolver.classList.toggle("visible", usingTemplate && currentCustomVariables.length > 0);
 if (!usingTemplate) {
 currentCustomVariables = [];
 customValues = {};
 message.disabled = false;
 if (opts.clearCustomOnSwitch !== false) message.value = "";
 helper.textContent = "Escribe aquí algo personal o deja el campo en blanco para redactarlo directamente en WhatsApp.";
 } else if (selectedTemplate()) {
 rebuildCustomResolver();
 }
 }

 mode.addEventListener("change", function() {
 syncMode();
 if (mode.value === "TEMPLATE") ensureLoaded().catch(function() {});
 });
 templateSelect.addEventListener("change", fillFromSelectedTemplate);

 open.addEventListener("click", async function() {
 status.className = "save-status";
 status.textContent = "";
 try {
 if (mode.value === "TEMPLATE") {
 await ensureLoaded();
 if (!templateSelect.value) throw new Error("Seleccione una plantilla o cambie a Mensaje personalizado.");
 const unresolved = unresolvedCustomVariables();
 if (unresolved.length) throw new Error("Complete la variable " + (unresolved[0].nombre || unresolved[0].token) + " antes de abrir WhatsApp.");
 }
 openWhatsAppMac(lead, message.value);
 status.textContent = "WhatsApp abierto. Regresa al CRM después de enviar y confirma el envío.";
 } catch (error) {
 status.className = "save-status error";
 status.textContent = error.message || "No se pudo abrir WhatsApp.";
 }
 });

 syncMode();

 return {
 root: root,
 show: function(show, types) {
 if (Array.isArray(types)) currentTypes = types.slice();
 root.style.display = show ? "grid" : "none";
 if (show && mode.value === "TEMPLATE") ensureLoaded().then(rebuildTemplateSelect).catch(function() {});
 if (!show) sent.checked = false;
 },
 ensureLoaded: ensureLoaded,
 validateSent: function() {
 if (mode.value === "TEMPLATE" && !templateSelect.value) {
 throw new Error("Seleccione una plantilla o cambie a Mensaje personalizado.");
 }
 const unresolved = unresolvedCustomVariables();
 if (mode.value === "TEMPLATE" && unresolved.length) {
 throw new Error("Complete la variable " + (unresolved[0].nombre || unresolved[0].token) + ".");
 }
 if (!sent.checked) throw new Error("Confirme que envió el mensaje por WhatsApp antes de guardar Contactado.");
 },
 messageContext: function() {
 if (!sent.checked) return null;
 const template = mode.value === "TEMPLATE" ? selectedTemplate() : null;
 const templateId = mode.value === "TEMPLATE" ? String(templateSelect.value || "") : "";
 return {
 confirmed_sent: true,
 channel: "WHATSAPP",
 mode: mode.value === "TEMPLATE" ? "TEMPLATE" : "CUSTOM",
 template_id: templateId,
 template_version: template ? Number(template.version || 1) : "",
 template_name: template ? template.nombre : "",
 message: String(message.value || "")
 };
 },
 sent: sent,
 mode: mode,
 message: message,
 templateSelect: templateSelect
 };
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

 function openStagePopover(lead, options, crmLeadId, fromView, historial) {
 const pop = openPopover("Cambiar etapa");
 const select = element("select", "form-control");
 fillSelectOptions(select, options.etapas, lead.etapa, false, "");
 pop.body.appendChild(popoverField("Etapa", select));

 const contactBox = element("div", "confirm-box");
 const contactChannel = element("select", "form-control");
 [["", "Seleccione cómo se realizó el contacto"], ["WhatsApp / Mensaje", "WhatsApp / Mensaje"], ["Llamada", "Llamada"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 contactChannel.appendChild(option);
 });
 contactBox.appendChild(popoverField("Cómo se realizó el contacto", contactChannel));
 contactBox.appendChild(element("div", "popover-help", "Si fue WhatsApp / Mensaje, podrás usar una plantilla o escribir algo personal antes de guardar Contactado."));
 contactBox.style.display = "none";
 pop.body.appendChild(contactBox);
 const contactComposer = createWhatsAppComposer(lead, {title: "Mensaje de contacto"});
 pop.body.appendChild(contactComposer.root);

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
 wireDateTabToTime(customConfirmDate, customConfirmTime);
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
 const stageFollowupOptIn = element("label", "confirm-line");
 const stageFollowupCheck = element("input");
 stageFollowupCheck.type = "checkbox";
 stageFollowupCheck.checked = normalized(lead.etapa) !== "no responde" || !!lead.proximo_seguimiento;
 stageFollowupOptIn.append(stageFollowupCheck, document.createTextNode("Programar otro seguimiento"));
 stageFollowupOptIn.style.display = "none";
 stageFollowupBox.appendChild(stageFollowupOptIn);

 const stageFollowupDetails = element("div");
 const stageFollowupSequence = followupSequenceBox(historial, lead);
 stageFollowupDetails.appendChild(stageFollowupSequence);
 const stageFollowupDefault = automaticFollowupDefault(lead.proximo_seguimiento);
 const stageFollowupParts = parseLeadDateParts(stageFollowupDefault.value);
 const stageFollowupDateControl = createMxDateControl(stageFollowupDefault.value);
 const stageFollowupDate = stageFollowupDateControl.input;
 const stageFollowupTimeControl = createMxTimeControl(stageFollowupDefault.time || stageFollowupParts.time);
 const stageFollowupTime = stageFollowupTimeControl.input;
 wireDateTabToTime(stageFollowupDate, stageFollowupTime);
 const stageFollowupGrid = element("div", "followup-grid");
 stageFollowupGrid.append(stageFollowupDateControl.root, stageFollowupTimeControl.root);
 stageFollowupDetails.appendChild(popoverField("Próximo seguimiento · fecha y hora", stageFollowupGrid));

 const stageFollowupNote = element("textarea", "form-control");
 stageFollowupNote.rows = 3;
 stageFollowupNote.placeholder = "Ej. Si no responde mañana, descartar. / Preguntarle si revisó la información enviada.";
 const stageFollowupNoteField = popoverField("Nota / antecedente", stageFollowupNote);
 stageFollowupNoteField.style.display = "none";
 stageFollowupDetails.appendChild(stageFollowupNoteField);

 stageFollowupBox.appendChild(stageFollowupDetails);

 const stageFollowupSummary = element("div", "confirm-summary",
 "Obligatorio al cambiar a esta etapa. Después puede editarlo desde la ficha del lead.");
 stageFollowupBox.appendChild(stageFollowupSummary);
 stageFollowupBox.style.display = "none";
 pop.body.appendChild(stageFollowupBox);

 const syncStageFollowupOptIn = function() {
 const isNoResponse = normalized(select.value) === "no responde";
 stageFollowupOptIn.style.display = isNoResponse ? "flex" : "none";
 stageFollowupDetails.style.display = !isNoResponse || stageFollowupCheck.checked ? "block" : "none";
 stageFollowupNoteField.style.display = isNoResponse && stageFollowupCheck.checked ? "grid" : "none";
 stageFollowupSummary.textContent = isNoResponse
 ? (stageFollowupCheck.checked
 ? "Opcional. Se programará otro intento de contacto; por defecto se propone mañana a las 9:00 a.m."
 : "No se programará otro seguimiento. Puedes hacerlo después desde la ficha del lead.")
 : "Obligatorio al cambiar a esta etapa. Después puede editarlo desde la ficha del lead.";
 };
 stageFollowupCheck.addEventListener("change", syncStageFollowupOptIn);

 const valueInput = element("input", "form-control");
 valueInput.type = "number";
 valueInput.min = "1";
 valueInput.step = "1";
 valueInput.value = lead.valor_operacion || "";
 const valueField = popoverField("Valor de operación", valueInput);
 valueField.style.display = "none";
 pop.body.appendChild(valueField);

 const syncContactChannel = function() {
 const isContactado = normalized(select.value) === "contactado";
 const isWhatsApp = normalized(contactChannel.value).indexOf("whatsapp") !== -1;
 contactComposer.show(isContactado && isWhatsApp, templateTypesForContact(lead, historial));
 };
 contactChannel.addEventListener("change", syncContactChannel);

 const sync = function() {
 const stage = normalized(select.value);
 const needsGenericFollowup = stage !== "descartado" && stage !== "cita agendada";
 updateFollowupSequenceBox(stageFollowupSequence, historial, lead, {pendingContact: stage === "contactado"});
 discard.sync(stage === "descartado");
 contactBox.style.display = stage === "contactado" ? "grid" : "none";
 if (stage !== "contactado") contactChannel.value = "";
 syncContactChannel();
 aptField.style.display = stage === "cita agendada" ? "grid" : "none";
 confirmBox.style.display = stage === "cita agendada" ? "grid" : "none";
 stageFollowupBox.style.display = needsGenericFollowup ? "grid" : "none";
 syncStageFollowupOptIn();
 valueField.style.display = stage === "compra" ? "grid" : "none";
 };
 select.addEventListener("change", sync);
 sync();

 popoverActions(pop, async function() {
 const changes = {etapa: select.value};
 const stage = normalized(select.value);
 let messageContext = null;
 if (stage === "contactado") {
 if (!contactChannel.value) throw new Error("Seleccione si el contacto se realizó por WhatsApp / Mensaje o Llamada.");
 if (normalized(contactChannel.value).indexOf("whatsapp") !== -1) {
 contactComposer.validateSent();
 messageContext = contactComposer.messageContext();
 }
 }
 if (stage === "descartado") {
 if (!discard.select.value) throw new Error("Seleccione un motivo de descarte.");
 changes.motivo_descarte = discard.select.value;
 if (selectedOptionCode(discard.select) === "NUMERO_ERRONEO") {
 if (!discard.confirm.checked) throw new Error("Revise y confirme el teléfono original.");
 changes.confirmar_numero_erroneo = true;
 }
 }
 if (stage === "descartado") {
 // Descartado sí es terminal: elimina cualquier tarea futura.
 changes.proximo_seguimiento = "";
 changes.seguimiento_actividad = "";
 changes.seguimiento_nota = "";
 } else if (stage === "no responde" && !stageFollowupCheck.checked) {
 // No responde puede quedarse sin tarea si el usuario decide no intentar de nuevo todavía.
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
 if (stage === "no responde") {
 changes.seguimiento_nota = String(stageFollowupNote.value || "").trim();
 }
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
 await saveLeadPatch(lead, crmLeadId, fromView, changes, messageContext);
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

 function openFollowupPopover(lead, options, crmLeadId, fromView, historial) {
 const pop = openPopover("Programar seguimiento");
 pop.body.appendChild(followupSequenceBox(historial, lead));
 const followupDefault = automaticFollowupDefault(lead.proximo_seguimiento);
 const parts = parseLeadDateParts(followupDefault.value);
 const dateControl = createMxDateControl(followupDefault.value);
 const date = dateControl.input;
 const timeControl = createMxTimeControl(followupDefault.time || parts.time);
 const time = timeControl.input;
 wireDateTabToTime(date, time);
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

 const followupComposer = createWhatsAppComposer(lead, {title: "Mensaje para este seguimiento"});
 pop.body.appendChild(followupComposer.root);

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
 const isWhatsApp = normalized(activity.value).indexOf("whatsapp") !== -1;
 followupComposer.show(isWhatsApp, templateTypesForFollowup(lead, historial));
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

 const messageContext = normalized(activity.value).indexOf("whatsapp") !== -1
 ? followupComposer.messageContext()
 : null;
 await saveLeadPatch(lead, crmLeadId, fromView, changes, messageContext);
 }, "Programar");
 }


 function commercialNumber(value) {
 const n = Number(value);
 return Number.isFinite(n) ? n : null;
 }

 function commercialDecimal(value) {
 const n = Number(value);
 if (!Number.isFinite(n)) return "";
 const rounded = Math.round(n * 100) / 100;
 if (Math.abs(rounded - Math.round(rounded)) < 0.000001) return rounded.toFixed(1);
 if (Math.abs(rounded * 10 - Math.round(rounded * 10)) < 0.000001) return rounded.toFixed(1);
 return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
 }

 function commercialBudgetDisplay(lead) {
 const min = commercialNumber(lead && lead.presupuesto_min_mdp);
 const max = commercialNumber(lead && lead.presupuesto_max_mdp);
 if (min !== null && max !== null) {
 if (Math.abs(min - max) < 0.000001) return commercialDecimal(min) + " MDP";
 return commercialDecimal(min) + "–" + commercialDecimal(max) + " MDP";
 }
 return String(lead && lead.presupuesto || "").trim();
 }

 function commercialTermDisplay(lead) {
 const current = String(lead && lead.plazo || "").trim();
 if (current) return current;
 const min = commercialNumber(lead && lead.plazo_min_meses);
 const max = commercialNumber(lead && lead.plazo_max_meses);
 if (min !== null && max !== null) {
 if (min === max) return String(min) + (min === 1 ? " mes" : " meses");
 return String(min) + "–" + String(max) + " meses";
 }
 return "";
 }

 function commercialBedroomsDisplay(lead) {
 const bedrooms = String(lead && lead.recamaras || "").trim();
 let text = "";
 if (bedrooms) text = bedrooms === "1" ? "1 recámara" : bedrooms + " recámaras";
 if (lead && lead.flex) text = text ? text + " + Flex" : "Flex";
 return text;
 }

 function commercialPaymentDisplay(lead) {
 const payment = String(lead && lead.forma_pago || "").trim();
 const other = String(lead && lead.forma_pago_otro || "").trim();
 if (!payment) return "";
 if (normalized(payment) === "otro" && other) return "Otro · " + other;
 return payment;
 }

 function originalAnswerSubtitle(original, current) {
 const source = String(original || "").trim();
 const shown = String(current || "").trim();
 if (!source || normalized(source) === normalized(shown)) return "";
 return "Respuesta original: " + source;
 }

 function appendOriginalAnswer(pop, label, value) {
 const text = String(value || "").trim();
 if (!text) return;
 const box = element("div", "commercial-original");
 box.appendChild(element("div", "form-label", label || "Respuesta original de campaña"));
 box.appendChild(element("div", "", text));
 pop.body.appendChild(box);
 }

 function makeNumberInput(value, options) {
 const opts = options || {};
 const input = element("input", "form-control");
 input.type = "number";
 input.inputMode = "decimal";
 if (opts.min !== undefined) input.min = String(opts.min);
 if (opts.step !== undefined) input.step = String(opts.step);
 if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) {
 input.value = String(value);
 }
 return input;
 }

 function openBedroomsPopover(lead, crmLeadId, fromView) {
 const pop = openPopover("Editar recámaras");
 const select = element("select", "form-control");
 [["", "Sin definir"], ["1", "1 recámara"], ["2", "2 recámaras"], ["3", "3 recámaras"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 select.appendChild(option);
 });
 select.value = ["1", "2", "3"].indexOf(String(lead.recamaras || "")) !== -1 ? String(lead.recamaras) : "";

 const flexLabel = element("label", "confirm-line");
 const flex = element("input");
 flex.type = "checkbox";
 flex.checked = !!lead.flex;
 flexLabel.append(flex, document.createTextNode(" Flex"));

 const preview = element("div", "commercial-preview");
 const updatePreview = function() {
 preview.textContent = commercialBedroomsDisplay({recamaras: select.value, flex: flex.checked}) || "Sin definir";
 };
 select.addEventListener("change", updatePreview);
 flex.addEventListener("change", updatePreview);

 pop.body.append(
 popoverField("Recámaras", select),
 popoverField("Complemento", flexLabel),
 popoverField("Así se mostrará", preview)
 );
 updatePreview();

 popoverActions(pop, async function() {
 await saveLeadPatch(lead, crmLeadId, fromView, {
 recamaras: select.value,
 flex: flex.checked
 });
 });
 }

 function openBudgetPopover(lead, crmLeadId, fromView) {
 const pop = openPopover("Editar presupuesto");
 const currentMin = commercialNumber(lead.presupuesto_min_mdp);
 const currentMax = commercialNumber(lead.presupuesto_max_mdp);
 const exactCurrent = currentMin !== null && currentMax !== null && Math.abs(currentMin - currentMax) < 0.000001;

 const mode = element("select", "form-control");
 [["EXACTO", "Monto exacto"], ["RANGO", "Rango"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 mode.appendChild(option);
 });
 mode.value = exactCurrent ? "EXACTO" : "RANGO";

 const exact = makeNumberInput(exactCurrent ? currentMin : "", {min: 0.01, step: 0.1});
 exact.placeholder = "Ej. 5.5";
 const min = makeNumberInput(!exactCurrent ? currentMin : "", {min: 0.01, step: 0.1});
 const max = makeNumberInput(!exactCurrent ? currentMax : "", {min: 0.01, step: 0.1});
 min.placeholder = "Desde";
 max.placeholder = "Hasta";

 const exactField = popoverField("Monto (MDP)", exact);
 const pair = element("div", "commercial-pair");
 pair.append(popoverField("Desde (MDP)", min), popoverField("Hasta (MDP)", max));
 const rangeField = element("div", "");
 rangeField.appendChild(pair);

 const sync = function() {
 exactField.style.display = mode.value === "EXACTO" ? "grid" : "none";
 rangeField.style.display = mode.value === "RANGO" ? "block" : "none";
 };
 mode.addEventListener("change", sync);
 pop.body.append(popoverField("Tipo de presupuesto", mode), exactField, rangeField);
 appendOriginalAnswer(pop, "Respuesta original de campaña", lead.presupuesto_texto_original);
 sync();

 popoverActions(pop, async function() {
 let minValue;
 let maxValue;
 if (mode.value === "EXACTO") {
 const value = Number(exact.value);
 if (!(value > 0)) throw new Error("Capture un monto válido.");
 minValue = value;
 maxValue = value;
 } else {
 minValue = Number(min.value);
 maxValue = Number(max.value);
 if (!(minValue > 0) || !(maxValue > 0)) throw new Error("Capture Desde y Hasta.");
 if (maxValue < minValue) throw new Error("Hasta no puede ser menor que Desde.");
 }
 await saveLeadPatch(lead, crmLeadId, fromView, {
 presupuesto_min_mdp: minValue,
 presupuesto_max_mdp: maxValue
 });
 });
 }

 function openTermPopover(lead, crmLeadId, fromView) {
 const pop = openPopover("Editar plazo");
 const currentMin = commercialNumber(lead.plazo_min_meses);
 const currentMax = commercialNumber(lead.plazo_max_meses);
 const hasRange = currentMin !== null && currentMax !== null;

 const mode = element("select", "form-control");
 [["RANGO", "Rango en meses"], ["TEXTO", "Texto libre / no aplica rango"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 mode.appendChild(option);
 });
 mode.value = hasRange ? "RANGO" : "TEXTO";

 const min = makeNumberInput(hasRange ? currentMin : "", {min: 0, step: 1});
 const max = makeNumberInput(hasRange ? currentMax : "", {min: 0, step: 1});
 min.placeholder = "Desde";
 max.placeholder = "Hasta";
 const pair = element("div", "commercial-pair");
 pair.append(popoverField("Desde (meses)", min), popoverField("Hasta (meses)", max));
 const rangeField = element("div", "");
 rangeField.appendChild(pair);

 const freeText = element("input", "form-control");
 freeText.type = "text";
 freeText.placeholder = "Ej. Solo estoy explorando opciones";
 if (!hasRange) freeText.value = String(lead.plazo || lead.plazo_texto_original || "");
 const textField = popoverField("Plazo", freeText);

 const sync = function() {
 rangeField.style.display = mode.value === "RANGO" ? "block" : "none";
 textField.style.display = mode.value === "TEXTO" ? "grid" : "none";
 };
 mode.addEventListener("change", sync);
 pop.body.append(popoverField("Cómo quieres capturarlo", mode), rangeField, textField);
 appendOriginalAnswer(pop, "Respuesta original de campaña", lead.plazo_texto_original);
 sync();

 popoverActions(pop, async function() {
 if (mode.value === "RANGO") {
 const minValue = Number(min.value);
 const maxValue = Number(max.value);
 if (!Number.isInteger(minValue) || !Number.isInteger(maxValue) || minValue < 0 || maxValue < 0) {
 throw new Error("Capture meses enteros válidos.");
 }
 if (maxValue < minValue) throw new Error("Hasta no puede ser menor que Desde.");
 await saveLeadPatch(lead, crmLeadId, fromView, {
 plazo_min_meses: minValue,
 plazo_max_meses: maxValue,
 plazo_texto_manual: ""
 });
 } else {
 const text = freeText.value.trim();
 if (!text) throw new Error("Escriba el plazo.");
 await saveLeadPatch(lead, crmLeadId, fromView, {
 plazo_min_meses: null,
 plazo_max_meses: null,
 plazo_texto_manual: text
 });
 }
 });
 }

 function openPaymentPopover(lead, options, crmLeadId, fromView) {
 const pop = openPopover("Editar forma de pago");
 const select = element("select", "form-control");
 const blank = element("option", "", "Sin definir");
 blank.value = "";
 select.appendChild(blank);
 (options.formas_pago || []).forEach(function(item) {
 const option = element("option", "", item.nombre);
 option.value = item.nombre;
 select.appendChild(option);
 });
 select.value = lead.forma_pago || "";

 const other = element("input", "form-control");
 other.type = "text";
 other.placeholder = "Especifique la forma de pago";
 other.value = lead.forma_pago_otro || "";
 const otherField = popoverField("Otro", other);
 const sync = function() {
 otherField.style.display = normalized(select.value) === "otro" ? "grid" : "none";
 };
 select.addEventListener("change", sync);
 pop.body.append(popoverField("Forma de pago", select), otherField);
 sync();

 popoverActions(pop, async function() {
 const payment = select.value;
 const custom = normalized(payment) === "otro" ? other.value.trim() : "";
 if (normalized(payment) === "otro" && !custom) throw new Error("Especifique la forma de pago.");
 await saveLeadPatch(lead, crmLeadId, fromView, {
 forma_pago: payment,
 forma_pago_otro: custom
 });
 });
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
 const result = await api("/api/leads/" + encodeURIComponent(crmLeadId) + "/notes", {
 method: "POST",
 headers: {"Content-Type": "application/json"},
 body: JSON.stringify({nota})
 });
 const returnedDetail = result && result.detail ? result.detail : null;
 await renderLeadDetail(crmLeadId, fromView, returnedDetail);
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


 function capiLiveItem(expectedStage) {
 const list = document.getElementById("leadHistoryList");
 if (!list) return null;

 const existing = document.getElementById("capiLiveStatus");
 if (existing) existing.remove();

 const item = element("div", "history-item history-capi-live pending");
 item.id = "capiLiveStatus";
 item.dataset.expectedStage = expectedStage || "";

 const top = element("div", "history-top");
 top.appendChild(element("div", "history-action", "CAPI pendiente de confirmación…"));
 top.appendChild(element("div", "history-date", ""));
 item.appendChild(top);
 item.appendChild(
 element(
 "div",
 "history-detail",
 (expectedStage || "Cambio de etapa") + " · esperando confirmación del Runner / Meta"
 )
 );

 list.prepend(item);
 return item;
 }

 function setCapiLiveState(item, kind, title, detail, dateText) {
 if (!item || !item.isConnected) return;
 item.className = "history-item history-capi-live " + kind;
 const action = item.querySelector(".history-action");
 const detailEl = item.querySelector(".history-detail");
 const dateEl = item.querySelector(".history-date");
 if (action) action.textContent = title || "CAPI";
 if (detailEl) detailEl.textContent = detail || "";
 if (dateEl) dateEl.textContent = dateText || "";
 }

 async function startCapiStatusMonitor(crmLeadId, expectedStage, sinceMs) {
 const seq = ++state.capiMonitorSeq;
 const item = capiLiveItem(expectedStage);
 if (!item) return;

 const startedAt = Date.now();
 const timeoutMs = 95 * 1000;
 let lastError = "";

 while (Date.now() - startedAt < timeoutMs) {
 await sleep(5000);

 if (seq !== state.capiMonitorSeq) return;
 const route = parseRoute();
 if (route.type !== "lead" || route.id !== crmLeadId) return;

 try {
 const status = await api(
 "/api/leads/" + encodeURIComponent(crmLeadId) +
 "/capi-status?stage=" + encodeURIComponent(expectedStage) +
 "&since=" + encodeURIComponent(String(sinceMs || 0))
 );

 if (!status || typeof status !== "object") continue;

 if (status.state === "stale" || status.state === "not_applicable") {
 item.remove();
 return;
 }

 if (status.state === "already_sent") {
 setCapiLiveState(
 item,
 "sent",
 "CAPI ya confirmado previamente",
 [
 status.event_name || expectedStage,
 "Meta",
 status.http_code ? "HTTP " + status.http_code : "",
 "No se reenvió por deduplicación"
 ].filter(Boolean).join(" · "),
 formatDateValue(status.sent_at, true)
 );
 return;
 }

 if (status.state === "sent") {
 const eventId = String(status.event_id || "");
 const duplicate = eventId
 ? document.querySelector('[data-capi-event-id="' + CSS.escape(eventId) + '"]')
 : null;

 if (duplicate) {
 item.remove();
 duplicate.scrollIntoView({block: "nearest"});
 return;
 }

 setCapiLiveState(
 item,
 "sent",
 "CAPI confirmado",
 [
 status.event_name || expectedStage,
 "Meta",
 status.http_code ? "HTTP " + status.http_code : ""
 ].filter(Boolean).join(" · "),
 formatDateValue(status.sent_at, true)
 );
 return;
 }

 if (status.state === "error") {
 setCapiLiveState(
 item,
 "error",
 "CAPI con error",
 [
 status.event_name || expectedStage,
 status.http_code ? "HTTP " + status.http_code : "",
 status.last_error || "Revisar Eventos CAPI"
 ].filter(Boolean).join(" · "),
 formatDateValue(status.sent_at, true)
 );
 return;
 }
 } catch (error) {
 lastError = String(error && error.message ? error.message : error || "");
 }
 }

 if (seq !== state.capiMonitorSeq || !item.isConnected) return;
 setCapiLiveState(
 item,
 "timeout",
 "CAPI pendiente — revisar",
 lastError || (expectedStage + " · aún no aparece confirmación después de 95 segundos"),
 ""
 );
 }


 async function renderLeadDetail(
 crmLeadId,
 fromView,
 prefetchedData
 ) {
 const content =
 clearContent();

 if (!prefetchedData) {
 content.className = "loading";
 content.textContent = "Cargando lead...";
 }

 state.loadingDetailId =
 crmLeadId;

 try {
 const data = prefetchedData ||
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

 addActionInfoRow(
 contact,
 "Teléfono",
 lead.telefono,
 "WhatsApp",
 function() {
 try {
 openWhatsAppMac(lead, "");
 showError("");
 } catch (error) {
 showError(error && error.message ? error.message : "No se pudo abrir WhatsApp.");
 }
 }
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

 const termDisplay = commercialTermDisplay(lead);
 addEditableInfoRow(
 commercial,
 "Plazo",
 termDisplay || "Sin definir",
 originalAnswerSubtitle(lead.plazo_texto_original, termDisplay),
 function() { openTermPopover(lead, crmLeadId, fromView); }
 );

 const budgetDisplay = commercialBudgetDisplay(lead);
 addEditableInfoRow(
 commercial,
 "Presupuesto",
 budgetDisplay || "Sin definir",
 originalAnswerSubtitle(lead.presupuesto_texto_original, budgetDisplay),
 function() { openBudgetPopover(lead, crmLeadId, fromView); }
 );

 addEditableInfoRow(
 commercial,
 "Recámaras",
 commercialBedroomsDisplay(lead) || "Sin definir",
 "",
 function() { openBedroomsPopover(lead, crmLeadId, fromView); }
 );

 addEditableInfoRow(
 commercial,
 "Forma de pago",
 commercialPaymentDisplay(lead) || "Sin definir",
 "",
 function() { openPaymentPopover(lead, data.opciones_operativas || {}, crmLeadId, fromView); }
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
 fromView,
 historial
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
 historyList.id = "leadHistoryList";

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


 if (normalized(event.tipo_evento) === "capi") {
 const fieldText = String(event.campo || "");
 const matchEventId = fieldText.match(/^event_id:(.+)$/i);
 if (matchEventId && matchEventId[1]) {
 item.dataset.capiEventId = matchEventId[1].trim();
 }
 }

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


 function formatCampaignNumber(value, maxDecimals) {
 if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
 return "s/d";
 }

 const decimals = Number.isFinite(Number(maxDecimals)) ? Number(maxDecimals) : 0;
 return new Intl.NumberFormat(
 "es-MX",
 {
 minimumFractionDigits: decimals > 0 ? 1 : 0,
 maximumFractionDigits: decimals
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


 function campaignSafeRatio(numerator, denominator) {
 const n = Number(numerator);
 const d = Number(denominator);
 if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
 return n / d;
 }


 function campaignAggregateFromAdsets(campaign, corteH, campaignLevelMetrics) {
 const adsets = campaign && campaign.hierarchy && Array.isArray(campaign.hierarchy.adsets)
 ? campaign.hierarchy.adsets
 : [];
 const base = campaignLevelMetrics || {};

 if (!adsets.length) return base;

 const rows = adsets.map(function(adset) {
 if (corteH === null || corteH === undefined) return adset.metrics || {};
 if (adset.metrics && Number(adset.metrics.corte_h) === Number(corteH)) return adset.metrics;
 const trend = Array.isArray(adset.trend) ? adset.trend : [];
 return trend.find(function(point) { return Number(point.corte_h) === Number(corteH); }) || null;
 }).filter(Boolean);

 if (!rows.length) return base;

 function sumNullable(key) {
 let total = 0;
 let hasValue = false;
 rows.forEach(function(row) {
 const value = row ? row[key] : null;
 if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) {
 total += Number(value);
 hasValue = true;
 }
 });
 return hasValue ? total : null;
 }

 const gasto = sumNullable("gasto");
 const impresiones = sumNullable("impresiones");
 const clics = sumNullable("clics_enlace");
 const clicsUnicos = sumNullable("clics_unicos_enlace");
 const leads = sumNullable("leads");
 const lpv = sumNullable("landing_page_views");
 const alcanceCampana = base.alcance !== null && base.alcance !== undefined ? base.alcance : null;

 return {
 corte_h: corteH !== null && corteH !== undefined ? corteH : base.corte_h,
 fecha_corte: base.fecha_corte || "",
 fecha_consulta: base.fecha_consulta || "",
 gasto: gasto !== null ? gasto : base.gasto,
 impresiones: impresiones !== null ? impresiones : base.impresiones,
 alcance: alcanceCampana,
 frecuencia: campaignSafeRatio(impresiones !== null ? impresiones : base.impresiones, alcanceCampana),
 clics_enlace: clics !== null ? clics : base.clics_enlace,
 clics_unicos_enlace: clicsUnicos !== null ? clicsUnicos : base.clics_unicos_enlace,
 ctr_enlace: campaignSafeRatio(clics !== null ? clics : base.clics_enlace, impresiones !== null ? impresiones : base.impresiones),
 cpc_enlace: campaignSafeRatio(gasto !== null ? gasto : base.gasto, clics !== null ? clics : base.clics_enlace),
 cpm: campaignSafeRatio((gasto !== null ? gasto : base.gasto) === null || (gasto !== null ? gasto : base.gasto) === undefined ? null : Number(gasto !== null ? gasto : base.gasto) * 1000, impresiones !== null ? impresiones : base.impresiones),
 leads: leads !== null ? leads : base.leads,
 cpl: (leads !== null ? leads : base.leads) > 0 ? campaignSafeRatio(gasto !== null ? gasto : base.gasto, leads !== null ? leads : base.leads) : null,
 conversion_clic_lead: campaignSafeRatio(leads !== null ? leads : base.leads, clics !== null ? clics : base.clics_enlace),
 landing_page_views: lpv !== null ? lpv : base.landing_page_views,
 conversion_clic_landing: campaignSafeRatio(lpv !== null ? lpv : base.landing_page_views, clics !== null ? clics : base.clics_enlace),
 conversion_landing_lead: campaignSafeRatio(leads !== null ? leads : base.leads, lpv !== null ? lpv : base.landing_page_views)
 };
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
 const shell = element("div", "campaign-table-shell");
 const wrap = element("div", "campaign-table-wrap");
 const table = element("table", "campaign-table");
 const thead = document.createElement("thead");
 const headRow = document.createElement("tr");
 [
 "Corte",
 "Fecha",
 "Gasto",
 "Impresiones",
 "Alcance",
 "Frecuencia",
 "CPM",
 "Clics enlace",
 "Clics únicos",
 "CTR enlace",
 "CPC enlace",
 "LPV",
 "Conv. clic → LPV",
 "Leads",
 "CPL",
 "Conv. clic → lead",
 "Conv. LPV → lead"
 ].forEach(function(label) {
 const th = document.createElement("th");
 th.textContent = label;
 headRow.appendChild(th);
 });
 thead.appendChild(headRow);
 table.appendChild(thead);

 const tbody = document.createElement("tbody");
 const points = Array.isArray(source && source.trend) ? source.trend : [];
 points.slice().reverse().forEach(function(point) {
 const tr = document.createElement("tr");
 const values = [
 (point.corte_h !== null && point.corte_h !== undefined ? point.corte_h + " h" : "s/d"),
 point.fecha_corte ? formatCampaignDateTime(point.fecha_corte) : "s/d",
 formatCampaignMoney(point.gasto),
 formatCampaignNumber(point.impresiones),
 formatCampaignNumber(point.alcance),
 formatCampaignNumber(point.frecuencia, 2),
 formatCampaignMoney(point.cpm),
 formatCampaignNumber(point.clics_enlace),
 formatCampaignNumber(point.clics_unicos_enlace),
 formatCampaignPercent(point.ctr_enlace),
 formatCampaignMoney(point.cpc_enlace),
 formatCampaignNumber(point.landing_page_views),
 formatCampaignPercent(point.conversion_clic_landing),
 formatCampaignNumber(point.leads),
 formatCampaignMoney(point.cpl),
 formatCampaignPercent(point.conversion_clic_lead),
 formatCampaignPercent(point.conversion_landing_lead)
 ];
 values.forEach(function(value) {
 const td = document.createElement("td");
 td.textContent = value;
 tr.appendChild(td);
 });
 tbody.appendChild(tr);
 });
 table.appendChild(tbody);
 wrap.appendChild(table);
 shell.appendChild(wrap);

 const scrollControl = element("div", "campaign-scroll-control");
 scrollControl.appendChild(element("span", "", "← Inicio"));
 const range = element("input", "campaign-scroll-range");
 range.type = "range";
 range.min = "0";
 range.max = "1000";
 range.value = "0";
 range.step = "1";
 range.setAttribute("aria-label", "Mover horizontalmente la tabla de evolución");
 scrollControl.appendChild(range);
 scrollControl.appendChild(element("span", "", "Final →"));
 shell.appendChild(scrollControl);

 let syncingFromRange = false;
 let syncingFromScroll = false;
 const maxScroll = function() {
 return Math.max(0, wrap.scrollWidth - wrap.clientWidth);
 };
 const updateRangeFromScroll = function() {
 if (syncingFromRange) return;
 const max = maxScroll();
 syncingFromScroll = true;
 range.value = max > 0 ? String(Math.round((wrap.scrollLeft / max) * 1000)) : "0";
 range.disabled = max <= 0;
 syncingFromScroll = false;
 };
 range.addEventListener("input", function() {
 if (syncingFromScroll) return;
 const max = maxScroll();
 syncingFromRange = true;
 wrap.scrollLeft = max * (Number(range.value || 0) / 1000);
 syncingFromRange = false;
 });
 wrap.addEventListener("scroll", updateRangeFromScroll, {passive: true});
 if (typeof ResizeObserver !== "undefined") {
 const observer = new ResizeObserver(updateRangeFromScroll);
 observer.observe(wrap);
 observer.observe(table);
 } else {
 window.addEventListener("resize", updateRangeFromScroll, {passive: true});
 }
 requestAnimationFrame(updateRangeFromScroll);

 return shell;
 }


 function campaignTypeLabel(value) {
 const type = normalized(value);
 if (type === "instant_form") return "Instant Form";
 if (type === "landing") return "Landing";
 if (type === "mixed") return "Mixto";
 return value || "";
 }


 function campaignMetricGrid(metrics) {
 const m = metrics || {};
 const grid = element("div", "campaign-metric-grid");
 [
 ["Gasto", formatCampaignMoney(m.gasto)],
 ["Impresiones", formatCampaignNumber(m.impresiones)],
 ["Alcance", formatCampaignNumber(m.alcance)],
 ["Frecuencia", formatCampaignNumber(m.frecuencia, 2)],
 ["Clics enlace", formatCampaignNumber(m.clics_enlace)],
 ["CTR", formatCampaignPercent(m.ctr_enlace)],
 ["CPC", formatCampaignMoney(m.cpc_enlace)],
 ["CPM", formatCampaignMoney(m.cpm)],
 ["Landing views", formatCampaignNumber(m.landing_page_views)],
 ["Leads", formatCampaignNumber(m.leads)],
 ["CPL", formatCampaignMoney(m.cpl)],
 ["Conversión", formatCampaignPercent(m.conversion_clic_lead)]
 ].forEach(function(item) {
 const box = element("div", "campaign-metric-box");
 box.appendChild(element("div", "campaign-mini-label", item[0]));
 box.appendChild(element("div", "campaign-mini-value", item[1]));
 grid.appendChild(box);
 });
 return grid;
 }


 function buildCampaignTree(campaign) {
 const tree = element("div", "campaign-tree");
 const adsets = campaign && campaign.hierarchy && Array.isArray(campaign.hierarchy.adsets)
 ? campaign.hierarchy.adsets
 : [];

 if (!adsets.length) {
 tree.appendChild(element("div", "campaign-source-note", "Sin jerarquía disponible en el corte actual."));
 return tree;
 }

 adsets.forEach(function(adset) {
 const row = element("div", "campaign-tree-row");
 row.appendChild(element("span", "campaign-tree-symbol", "├"));
 row.appendChild(element("span", "", adset.nombre || "Conjunto sin nombre"));
 tree.appendChild(row);

 const ads = Array.isArray(adset.ads) ? adset.ads : [];
 ads.forEach(function(ad, index) {
 const adRow = element("div", "campaign-tree-row ad");
 adRow.appendChild(element("span", "campaign-tree-symbol", index === ads.length - 1 ? "└" : "├"));
 adRow.appendChild(element("span", "", ad.nombre || "Anuncio sin nombre"));
 tree.appendChild(adRow);
 });
 });

 return tree;
 }


 function buildCampaignHierarchy(campaign) {
 const hierarchy = campaign.hierarchy || {};
 const adsets = Array.isArray(hierarchy.adsets) ? hierarchy.adsets : [];
 const wrap = element("div", "campaign-hierarchy");

 if (!adsets.length) {
 wrap.appendChild(element("div", "empty-state", "No hay desglose por conjunto/anuncio para este corte oficial."));
 return wrap;
 }

 adsets.forEach(function(adset, index) {
 const panel = element("div", "campaign-adset-panel accent-" + (index % 4));
 const head = element("div", "campaign-adset-head");
 const titleRow = element("div", "campaign-adset-title-row");
 const title = element("div", "");
 title.appendChild(element("div", "campaign-entity-name", adset.nombre || "Conjunto sin nombre"));
 title.appendChild(
 element(
 "div",
 "campaign-entity-meta",
 [
 "Conjunto de anuncios",
 adset.formato,
 campaignTypeLabel(adset.tipo_conversion),
 ((adset.ads || []).length + " anuncio" + ((adset.ads || []).length === 1 ? "" : "s"))
 ].filter(Boolean).join(" · ")
 )
 );
 titleRow.appendChild(title);
 titleRow.appendChild(element("div", "campaign-source-note", "Corte " + (adset.metrics && adset.metrics.corte_h !== null && adset.metrics.corte_h !== undefined ? adset.metrics.corte_h + " h" : "s/d")));
 head.appendChild(titleRow);
 head.appendChild(campaignMetricGrid(adset.metrics));
 panel.appendChild(head);

 const ads = Array.isArray(adset.ads) ? adset.ads : [];
 const adList = element("div", "campaign-ad-list-static");
 if (!ads.length) {
 adList.appendChild(element("div", "campaign-source-note", "No hay anuncios registrados para este conjunto en el mismo corte."));
 } else {
 ads.forEach(function(ad) {
 const card = element("div", "campaign-ad-card");
 card.appendChild(element("div", "campaign-entity-name", ad.nombre || "Anuncio sin nombre"));
 card.appendChild(
 element(
 "div",
 "campaign-entity-meta",
 ["Anuncio", ad.formato, campaignTypeLabel(ad.tipo_conversion)].filter(Boolean).join(" · ")
 )
 );
 card.appendChild(campaignMetricGrid(ad.metrics));
 adList.appendChild(card);
 });
 }
 panel.appendChild(adList);
 wrap.appendChild(panel);
 });

 return wrap;
 }


 function campaignTrendSelection(campaign) {
 const projectKey = String(campaign && campaign.proyecto || "");
 const selections = state.campaignTrendSelectionByProject || (state.campaignTrendSelectionByProject = {});
 let selection = selections[projectKey];

 if (!selection || !selection.level) {
 selection = {level: "campaign", adsetKey: "", adKey: ""};
 selections[projectKey] = selection;
 }

 return selection;
 }


 function campaignAdsetKey(adset, index) {
 return String(adset && (adset.key || adset.nombre) || index);
 }


 function campaignAdKey(ad, index) {
 return String(ad && (ad.key || ad.nombre) || index);
 }


 function campaignTrendRollupSource(campaign) {
 const trend = Array.isArray(campaign && campaign.trend) ? campaign.trend : [];
 return {
 trend: trend.map(function(point) {
 return campaignAggregateFromAdsets(campaign, point.corte_h, point);
 })
 };
 }


 function campaignTrendResolvedSource(campaign) {
 const selection = campaignTrendSelection(campaign);
 const adsets = campaign && campaign.hierarchy && Array.isArray(campaign.hierarchy.adsets)
 ? campaign.hierarchy.adsets
 : [];

 if (selection.level === "campaign") {
 return {
 source: campaignTrendRollupSource(campaign),
 level: "campaign",
 label: "Campaña · " + (campaign.proyecto || "Campaña"),
 adset: null,
 ad: null
 };
 }

 let selectedAdset = null;
 let selectedAdsetIndex = -1;
 adsets.some(function(adset, index) {
 if (campaignAdsetKey(adset, index) === selection.adsetKey) {
 selectedAdset = adset;
 selectedAdsetIndex = index;
 return true;
 }
 return false;
 });

 if (!selectedAdset) {
 selection.level = "campaign";
 selection.adsetKey = "";
 selection.adKey = "";
 return campaignTrendResolvedSource(campaign);
 }

 if (selection.level === "ad") {
 const ads = Array.isArray(selectedAdset.ads) ? selectedAdset.ads : [];
 let selectedAd = null;
 ads.some(function(ad, index) {
 if (campaignAdKey(ad, index) === selection.adKey) {
 selectedAd = ad;
 return true;
 }
 return false;
 });

 if (selectedAd) {
 return {
 source: selectedAd,
 level: "ad",
 label: "Anuncio · " + (selectedAd.nombre || "Anuncio"),
 adset: selectedAdset,
 ad: selectedAd,
 adsetIndex: selectedAdsetIndex
 };
 }

 selection.level = "adset";
 selection.adKey = "";
 }

 return {
 source: selectedAdset,
 level: "adset",
 label: "Conjunto · " + (selectedAdset.nombre || "Conjunto"),
 adset: selectedAdset,
 ad: null,
 adsetIndex: selectedAdsetIndex
 };
 }


 function renderCampaignTrendSection(campaign, section) {
 if (!section) return;

 const resolved = campaignTrendResolvedSource(campaign);
 const source = resolved.source || campaign;
 const points = Array.isArray(source.trend) ? source.trend : [];
 const selection = campaignTrendSelection(campaign);
 const adsets = campaign && campaign.hierarchy && Array.isArray(campaign.hierarchy.adsets)
 ? campaign.hierarchy.adsets
 : [];

 section.replaceChildren();
 section.appendChild(
 buildCampaignSectionHeader(
 "Evolución por corte",
 "Selecciona exactamente qué nivel quieres analizar. La tabla conserva hasta 12 cortes oficiales.",
 null
 )
 );

 const controls = element("div", "campaign-trend-controls");
 const tabs = element("div", "campaign-trend-tabs");
 const campaignButton = element("button", "campaign-trend-button" + (resolved.level === "campaign" ? " active" : ""), "Campaña");
 campaignButton.type = "button";
 campaignButton.addEventListener("click", function() {
 selection.level = "campaign";
 selection.adsetKey = "";
 selection.adKey = "";
 renderCampaignTrendSection(campaign, section);
 });
 tabs.appendChild(campaignButton);

 adsets.forEach(function(adset, index) {
 const key = campaignAdsetKey(adset, index);
 const active = resolved.level !== "campaign" && selection.adsetKey === key;
 const button = element("button", "campaign-trend-button" + (active ? " active" : ""), adset.nombre || ("Conjunto " + (index + 1)));
 button.type = "button";
 button.addEventListener("click", function() {
 selection.level = "adset";
 selection.adsetKey = key;
 selection.adKey = "";
 renderCampaignTrendSection(campaign, section);
 });
 tabs.appendChild(button);
 });
 controls.appendChild(tabs);

 if (resolved.adset) {
 const subtabs = element("div", "campaign-trend-subtabs");
 const totalButton = element("button", "campaign-trend-button" + (resolved.level === "adset" ? " active" : ""), "Total conjunto");
 totalButton.type = "button";
 totalButton.addEventListener("click", function() {
 selection.level = "adset";
 selection.adKey = "";
 renderCampaignTrendSection(campaign, section);
 });
 subtabs.appendChild(totalButton);

 const ads = Array.isArray(resolved.adset.ads) ? resolved.adset.ads : [];
 ads.forEach(function(ad, index) {
 const key = campaignAdKey(ad, index);
 const button = element("button", "campaign-trend-button" + (resolved.level === "ad" && selection.adKey === key ? " active" : ""), ad.nombre || ("Anuncio " + (index + 1)));
 button.type = "button";
 button.addEventListener("click", function() {
 selection.level = "ad";
 selection.adKey = key;
 renderCampaignTrendSection(campaign, section);
 });
 subtabs.appendChild(button);
 });
 controls.appendChild(subtabs);
 }

 controls.appendChild(
 element(
 "div",
 "campaign-trend-context",
 "Viendo: " + resolved.label + " · " + (points.length ? points.length + " cortes disponibles" : "sin historial disponible")
 )
 );
 section.appendChild(controls);

 if (!points.length) {
 section.appendChild(element("div", "empty-state", "No hay cortes históricos para esta selección."));
 return;
 }

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
 const content = document.getElementById("content");

 if (!silent && !state.campaigns) {
 content.className = "loading";
 content.textContent = "Cargando campañas...";
 }

 try {
 const dashboard = await loadCampaigns(!!force);
 const campaigns = Array.isArray(dashboard.campaigns) ? dashboard.campaigns : [];
 const fragment = document.createDocumentFragment();

 fragment.appendChild(
 createHero(
 "Marketing",
 "Campañas",
 "Campañas activas, estructura de conjuntos/anuncios y evolución por corte. Solo lectura."
 )
 );

 if (!campaigns.length) {
 fragment.appendChild(
 element(
 "div",
 "empty-state",
 "No hay campañas con estado ACTIVA en Control Campañas."
 )
 );
 content.className = "";
 content.replaceChildren(fragment);
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

 // 1. Datos generales: se conserva igual.
 const summaryGrid = element("div", "campaign-summary-grid");
 summaryGrid.appendChild(campaignKpi("Campañas activas", String(campaigns.length), "Leídas de Control Campañas · estado = ACTIVA"));
 summaryGrid.appendChild(campaignKpi("Gasto acumulado", formatCampaignMoney(totals.spend), "Suma del último corte oficial de cada campaña activa"));
 summaryGrid.appendChild(campaignKpi("Leads acumulados", formatCampaignNumber(totals.leads), "Último corte oficial disponible"));
 summaryGrid.appendChild(campaignKpi("CPL combinado", formatCampaignMoney(blendedCpl), "Gasto total ÷ leads totales"));
 dashboardWrap.appendChild(summaryGrid);

 // 2. Campañas activas con diagrama y affordance claro de selección.
 const listSection = element("section", "campaign-section");
 listSection.appendChild(
 buildCampaignSectionHeader(
 "Campañas activas",
 "Selecciona una campaña. Todo lo que aparece debajo cambiará a esa selección.",
 element("div", "campaign-source-note", "Actualizado: " + formatCampaignDateTime(latestUpdate))
 )
 );

 const list = element("div", "campaign-list");
 if (!state.selectedCampaignProject || !campaigns.some(function(c) { return c.proyecto === state.selectedCampaignProject; })) {
 state.selectedCampaignProject = campaigns[0].proyecto;
 }

 campaigns.forEach(function(campaign) {
 const current = campaign.current || {};
 const isActiveSelection = campaign.proyecto === state.selectedCampaignProject;
 const button = element("button", "campaign-card" + (isActiveSelection ? " active" : ""));
 button.type = "button";
 button.setAttribute("aria-pressed", isActiveSelection ? "true" : "false");

 const top = element("div", "campaign-card-top");
 const titleWrap = element("div", "");
 titleWrap.appendChild(element("div", "campaign-card-title", campaign.proyecto));
 titleWrap.appendChild(
 element(
 "div",
 "campaign-card-meta",
 "Corte oficial " + (current.corte_h !== null && current.corte_h !== undefined ? current.corte_h + " h" : "s/d") +
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
 button.appendChild(buildCampaignTree(campaign));
 button.appendChild(
 element(
 "div",
 "campaign-card-action",
 isActiveSelection ? "Seleccionada ✓" : "Ver detalle de esta campaña →"
 )
 );

 button.addEventListener("click", function() {
 if (state.selectedCampaignProject === campaign.proyecto) return;
 state.selectedCampaignProject = campaign.proyecto;
 renderCampanas(false, true);
 });

 list.appendChild(button);
 });
 listSection.appendChild(list);
 dashboardWrap.appendChild(listSection);

 const selected = campaigns.find(function(c) { return c.proyecto === state.selectedCampaignProject; }) || campaigns[0];
 const currentSource = selected.current || {};
 const previousSource = selected.previous || null;
 const current = campaignAggregateFromAdsets(selected, currentSource.corte_h, currentSource);
 const previous = previousSource ? campaignAggregateFromAdsets(selected, previousSource.corte_h, previousSource) : null;

 const selectionBanner = element("div", "campaign-selection-banner");
 const selectionText = element("div", "");
 selectionText.appendChild(element("strong", "", "Detalle de campaña seleccionada"));
 selectionText.appendChild(element("div", "", selected.proyecto));
 selectionBanner.appendChild(selectionText);
 selectionBanner.appendChild(element("span", "", "Las secciones siguientes pertenecen a esta campaña"));
 dashboardWrap.appendChild(selectionBanner);

 // 3. Nivel campaña.
 const resultSection = element("section", "campaign-section");
 resultSection.appendChild(
 buildCampaignSectionHeader(
 selected.proyecto + " · Nivel campaña",
 "Consolidado oficial de la campaña completa. Los conjuntos y anuncios se desglosan en la siguiente sección.",
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
 ["Frecuencia", formatCampaignNumber(current.frecuencia, 2), campaignPreviousNote(previous, "frecuencia", function(v) { return formatCampaignNumber(v, 2); })],
 ["CPM", formatCampaignMoney(current.cpm), campaignPreviousNote(previous, "cpm", formatCampaignMoney)],
 ["Clics enlace", formatCampaignNumber(current.clics_enlace), campaignPreviousNote(previous, "clics_enlace", formatCampaignNumber)],
 ["CTR enlace", formatCampaignPercent(current.ctr_enlace), campaignPreviousNote(previous, "ctr_enlace", formatCampaignPercent)],
 ["CPC enlace", formatCampaignMoney(current.cpc_enlace), campaignPreviousNote(previous, "cpc_enlace", formatCampaignMoney)],
 ["Landing page views", formatCampaignNumber(current.landing_page_views), campaignPreviousNote(previous, "landing_page_views", formatCampaignNumber)],
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
 resultSection.appendChild(
 element(
 "div",
 "campaign-level-note",
 "Nota técnica: gasto, impresiones, clics, landing views y leads se suman desde los conjuntos para que el desglose cuadre. Alcance se conserva a nivel campaña porque no es aditivo; frecuencia, CPM, CTR, CPC y CPL se calculan con los totales, no con promedios simples."
 )
 );
 dashboardWrap.appendChild(resultSection);

 // 4. Desglose completo, sin acordeones.
 const hierarchySection = element("section", "campaign-section");
 hierarchySection.appendChild(
 buildCampaignSectionHeader(
 "Conjuntos y anuncios",
 "Desglose del mismo corte oficial. Cada conjunto muestra su acumulado completo y debajo aparecen todos sus anuncios.",
 null
 )
 );
 hierarchySection.appendChild(buildCampaignHierarchy(selected));
 hierarchySection.appendChild(
 element(
 "div",
 "campaign-readonly-note",
 "Solo lectura. Los estados y métricas vienen de Comparativo resultados de campañas; esta pantalla no pausa anuncios ni modifica Meta."
 )
 );
 dashboardWrap.appendChild(hierarchySection);

 // 5. Evolución por corte con selector explícito.
 const trendSection = element("section", "campaign-section");
 renderCampaignTrendSection(selected, trendSection);
 dashboardWrap.appendChild(trendSection);

 // 6. Configuración operativa con semáforo visual.
 const configSection = element("section", "campaign-section");
 configSection.appendChild(
 buildCampaignSectionHeader(
 "Configuración operativa",
 "Estado técnico informativo. Verde = correcto; rojo = requiere atención.",
 null
 )
 );

 const configGrid = element("div", "campaign-config-grid");
 const configItems = [
 {label: "Arranque", value: formatCampaignDateTime(selected.fecha_hora_arranque), status: "neutral"},
 {label: "Corte oficial", value: selected.intervalo_corte_h !== null && selected.intervalo_corte_h !== undefined ? "Cada " + selected.intervalo_corte_h + " h" : "s/d", status: "neutral"},
 {label: "Lectura live", value: selected.intervalo_live_min !== null && selected.intervalo_live_min !== undefined ? "Cada " + selected.intervalo_live_min + " min" : "s/d", status: "neutral"},
 {label: "Métricas", value: selected.metricas_activa ? "● Activas" : "● Inactivas", status: selected.metricas_activa ? "ok" : "bad"},
 {label: "CRM sync", value: selected.crm_sync_activo ? "● Activo" : "● Inactivo", status: selected.crm_sync_activo ? "ok" : "bad"},
 {label: "CAPI", value: selected.capi_activa ? "● Activa" : "● Inactiva", status: selected.capi_activa ? "ok" : "bad"}
 ];
 configItems.forEach(function(item) {
 const box = element("div", "campaign-config-item" + (item.status === "ok" ? " ok" : item.status === "bad" ? " bad" : ""));
 box.appendChild(element("div", "campaign-mini-label", item.label));
 box.appendChild(element("div", "campaign-config-value", item.value));
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

 fragment.appendChild(dashboardWrap);
 content.className = "";
 content.replaceChildren(fragment);

 } catch (error) {
 if (!silent || !content.children.length) {
 content.className = "";
 content.replaceChildren(
 element(
 "div",
 "empty-state",
 "No se pudieron cargar las campañas."
 )
 );
 }
 showError(error.message);
 reportClientError(error, {
 accion: "campaigns.dashboard",
 endpoint: "/api/campaigns"
 });
 }
 }


 function renderMas() {
 const content = clearContent();
 content.appendChild(
 createHero(
 "Configuración",
 "Más",
 "Administración y herramientas del CRM."
 )
 );

 const grid = element("div", "placeholder-grid");
 const items = [
 {
 title: "Plantillas mensajes",
 text: "Crea y organiza mensajes reutilizables para contactos, seguimientos y citas.",
 action: "Administrar plantillas →",
 enabled: true,
 onClick: function() { navigate("mas/plantillas"); }
 },
 {
 title: "Catálogos",
 text: "Administra opciones operativas, orden, visibilidad y consistencia del sistema.",
 action: "Administrar catálogos →",
 enabled: true,
 onClick: function() { navigate("mas/catalogos"); }
 },
 {
 title: "Variables mensajes",
 text: "Controla qué datos puedes insertar en plantillas y crea variables propias como {municipio}.",
 action: "Administrar variables →",
 enabled: true,
 onClick: function() { navigate("mas/variables"); }
 },
 {
 title: "Mi inmobiliaria",
 text: "Configuración general de OV Real Estate.",
 action: "Próximamente",
 enabled: false
 },
 {
 title: "Usuarios",
 text: "Administradores y asesores autorizados.",
 action: "Próximamente",
 enabled: false
 },
 {
 title: "Historial global",
 text: "Consulta cronológica de eventos de todos los leads.",
 action: "Próximamente",
 enabled: false
 }
 ];

 items.forEach(function(item) {
 const card = element("section", "placeholder-card" + (item.enabled ? " more-card-button" : " more-card-disabled"));
 card.appendChild(element("h3", "", item.title));
 card.appendChild(element("p", "", item.text));
 card.appendChild(element("div", "more-card-action", item.action));
 if (item.enabled && item.onClick) {
 card.tabIndex = 0;
 card.setAttribute("role", "button");
 card.addEventListener("click", item.onClick);
 card.addEventListener("keydown", function(event) {
 if (event.key === "Enter" || event.key === " ") {
 event.preventDefault();
 item.onClick();
 }
 });
 }
 grid.appendChild(card);
 });

 content.appendChild(grid);
 }

 function templateTypeLabel(code, data) {
 const list = data && Array.isArray(data.tipos) ? data.tipos : [];
 const found = list.find(function(item) { return String(item.codigo || "") === String(code || ""); });
 return found ? found.nombre : (code || "General");
 }

 function getTemplateProjects(data) {
 const set = new Set();
 const leadRows = state.leads && Array.isArray(state.leads.leads) ? state.leads.leads : [];
 leadRows.forEach(function(lead) {
 const project = String(lead && lead.proyecto || "").trim();
 if (project) set.add(project);
 });
 const templates = data && Array.isArray(data.templates) ? data.templates : [];
 templates.forEach(function(template) {
 const project = String(template && template.proyecto || "").trim();
 if (project) set.add(project);
 });
 return Array.from(set).sort(function(a, b) { return a.localeCompare(b, "es"); });
 }

 function renderTemplatePreview(message, variables) {
 let text = String(message || "");
 (variables || []).forEach(function(variable) {
 const token = String(variable.token || "");
 if (!token) return;
 const example = String(variable.ejemplo || variable.nombre || token);
 text = text.split(token).join(example);
 });
 return text || "La vista previa aparecerá aquí.";
 }

 async function loadTemplatesAdmin(force) {
 if (state.templatesAdmin && !force) return state.templatesAdmin;
 const data = hideLegacyTemplateTypes(await api("/api/templates?include_inactive=1"));
 state.templatesAdmin = data;
 return data;
 }

 function filteredTemplatesAdmin(data) {
 const list = data && Array.isArray(data.templates) ? data.templates.slice() : [];
 return list.filter(function(template) {
 if (state.templatesFilterType && String(template.tipo_mensaje || "") !== state.templatesFilterType) return false;
 if (state.templatesFilterProject && String(template.proyecto || "") !== state.templatesFilterProject) return false;
 if (state.templatesFilterStatus === "active" && !template.activo) return false;
 if (state.templatesFilterStatus === "inactive" && template.activo) return false;
 return true;
 });
 }

 function refreshTemplatesScreenFromState() {
 if (location.hash !== "#mas/plantillas") return;
 renderTemplatesAdmin(true).catch(function(error) {
 showError(error.message);
 reportClientError(error, {accion: "templates.render", endpoint: "/api/templates"});
 });
 }

 function openTemplateEditor(template, data) {
 const isEdit = !!(template && template.template_id);
 const canEdit = !!(data && data.can_edit);
 if (!canEdit) {
 showError("Solo un administrador puede modificar plantillas.");
 return;
 }

 const source = template || {};
 const pop = openPopover(isEdit ? "Editar plantilla" : "Nueva plantilla");
 pop.panel.classList.add("template-editor-panel");

 const name = element("input", "form-control");
 name.type = "text";
 name.maxLength = 120;
 name.placeholder = "Ej. Segundo contacto · Montara";
 name.value = source.nombre || "";
 pop.body.appendChild(popoverField("Nombre", name));

 const two = element("div", "template-editor-grid");
 const type = element("select", "form-control");
 (data.tipos || []).forEach(function(option) {
 const item = element("option", "", option.nombre);
 item.value = option.codigo;
 if (option.codigo === source.tipo_mensaje) item.selected = true;
 type.appendChild(item);
 });
 if (!source.tipo_mensaje && type.options.length) type.selectedIndex = 0;

 const scope = element("select", "form-control");
 [{value: "GLOBAL", label: "Global"}, {value: "PROYECTO", label: "Por proyecto"}].forEach(function(option) {
 const item = element("option", "", option.label);
 item.value = option.value;
 if (option.value === String(source.alcance || "GLOBAL")) item.selected = true;
 scope.appendChild(item);
 });
 two.appendChild(popoverField("Tipo", type));
 two.appendChild(popoverField("Alcance", scope));
 pop.body.appendChild(two);

 const projectInput = element("input", "form-control");
 projectInput.type = "text";
 projectInput.placeholder = "Ej. Montara V1";
 projectInput.value = source.proyecto || "";
 const dataListId = "template-projects-" + String(Date.now());
 projectInput.setAttribute("list", dataListId);
 const dataList = element("datalist", "");
 dataList.id = dataListId;
 getTemplateProjects(data).forEach(function(project) {
 const option = document.createElement("option");
 option.value = project;
 dataList.appendChild(option);
 });
 const projectWrap = element("div", "");
 projectWrap.append(projectInput, dataList);
 const projectField = popoverField("Proyecto", projectWrap);
 pop.body.appendChild(projectField);

 const message = element("textarea", "form-control form-textarea template-editor-message");
 message.placeholder = "Escribe aquí el mensaje. Puedes insertar variables de abajo.";
 message.value = source.mensaje || "";
 pop.body.appendChild(popoverField("Mensaje", message));

 const tokenSection = element("div", "template-token-section");
 tokenSection.appendChild(element("div", "form-label", "Variables disponibles"));
 const tokenList = element("div", "template-token-list");
 (data.variables || []).forEach(function(variable) {
 const button = element("button", "template-token", variable.token);
 button.type = "button";
 button.title = variable.nombre + (variable.ejemplo ? " · Ejemplo: " + variable.ejemplo : "");
 button.addEventListener("click", function() {
 const start = message.selectionStart == null ? message.value.length : message.selectionStart;
 const end = message.selectionEnd == null ? start : message.selectionEnd;
 message.value = message.value.slice(0, start) + variable.token + message.value.slice(end);
 const next = start + variable.token.length;
 message.focus();
 try { message.setSelectionRange(next, next); } catch (_) {}
 updatePreview();
 });
 tokenList.appendChild(button);
 });
 tokenSection.appendChild(tokenList);
 tokenSection.appendChild(element("div", "popover-help", "Haz clic en una variable para insertarla donde está el cursor."));
 pop.body.appendChild(tokenSection);

 const preview = element("div", "template-preview");
 const previewField = popoverField("Vista previa con ejemplos", preview);
 pop.body.appendChild(previewField);

 const checks = element("div", "template-checks");
 const defaultLabel = element("label", "template-inline-check");
 const defaultCheck = element("input");
 defaultCheck.type = "checkbox";
 defaultCheck.checked = !!source.predeterminada;
 defaultLabel.append(defaultCheck, document.createTextNode(" Usar como predeterminada para este tipo y alcance"));
 checks.appendChild(defaultLabel);

 const activeLabel = element("label", "template-inline-check");
 const activeCheck = element("input");
 activeCheck.type = "checkbox";
 activeCheck.checked = source.activo === undefined ? true : !!source.activo;
 activeLabel.append(activeCheck, document.createTextNode(" Plantilla activa"));
 checks.appendChild(activeLabel);
 pop.body.appendChild(checks);

 const syncScope = function() {
 const projectScoped = scope.value === "PROYECTO";
 projectField.style.display = projectScoped ? "grid" : "none";
 if (!projectScoped) projectInput.value = "";
 };
 const updatePreview = function() {
 preview.textContent = renderTemplatePreview(message.value, data.all_variables || data.variables || []);
 };
 scope.addEventListener("change", syncScope);
 message.addEventListener("input", updatePreview);
 syncScope();
 updatePreview();

 popoverActions(pop, async function() {
 const payload = {
 nombre: name.value.trim(),
 tipo_mensaje: type.value,
 alcance: scope.value,
 proyecto: scope.value === "PROYECTO" ? projectInput.value.trim() : "",
 mensaje: message.value.trim(),
 predeterminada: defaultCheck.checked,
 activo: activeCheck.checked
 };
 if (!payload.nombre) throw new Error("Capture un nombre para la plantilla.");
 if (payload.alcance === "PROYECTO" && !payload.proyecto) throw new Error("Capture el proyecto.");
 if (!payload.mensaje) throw new Error("Capture el mensaje.");

 if (isEdit) {
 await api("/api/templates/" + encodeURIComponent(source.template_id), {
 method: "PATCH",
 body: JSON.stringify({expected_version: Number(source.version || 1), template: payload})
 });
 } else {
 await api("/api/templates", {
 method: "POST",
 body: JSON.stringify({template: payload})
 });
 }
 state.templatesAdmin = null;
 state.messageTemplates = null;
 await loadTemplatesAdmin(true);
 refreshTemplatesScreenFromState();
 }, isEdit ? "Guardar cambios" : "Crear plantilla");
 }

 async function renderTemplatesAdmin(fromStateOnly) {
 const content = clearContent();
 if (!fromStateOnly || !state.templatesAdmin) {
 content.className = "loading";
 content.textContent = "Cargando plantillas…";
 }

 try {
 const data = await loadTemplatesAdmin(false);
 const fragment = document.createDocumentFragment();
 const page = element("div", "templates-page");

 const toolbar = element("div", "templates-toolbar");
 const back = element("button", "templates-back", "← Más");
 back.type = "button";
 back.addEventListener("click", function() { navigate("mas"); });
 toolbar.appendChild(back);
 if (data.can_edit) {
 const add = element("button", "save-button", "+ Nueva plantilla");
 add.type = "button";
 add.addEventListener("click", function() { openTemplateEditor(null, data); });
 toolbar.appendChild(add);
 }
 page.appendChild(toolbar);
 page.appendChild(createHero(
 "Mensajes reutilizables",
 "Plantillas",
 "Define aquí los textos que después usaremos en contactos, seguimientos y confirmaciones de cita."
 ));

 const templates = Array.isArray(data.templates) ? data.templates : [];
 const summary = element("div", "templates-summary");
 [
 {label: "Activas", value: templates.filter(function(t) { return t.activo; }).length},
 {label: "Globales", value: templates.filter(function(t) { return t.activo && t.alcance === "GLOBAL"; }).length},
 {label: "Por proyecto", value: templates.filter(function(t) { return t.activo && t.alcance === "PROYECTO"; }).length}
 ].forEach(function(item) {
 const card = element("div", "templates-summary-card");
 card.appendChild(element("strong", "", String(item.value)));
 card.appendChild(element("span", "", item.label));
 summary.appendChild(card);
 });
 page.appendChild(summary);

 const filters = element("div", "templates-filters");
 const typeFilter = element("select", "form-control");
 const allTypes = element("option", "", "Todos los tipos");
 allTypes.value = "";
 typeFilter.appendChild(allTypes);
 (data.tipos || []).forEach(function(option) {
 const item = element("option", "", option.nombre);
 item.value = option.codigo;
 if (state.templatesFilterType === option.codigo) item.selected = true;
 typeFilter.appendChild(item);
 });
 typeFilter.value = state.templatesFilterType;

 const projectFilter = element("select", "form-control");
 const allProjects = element("option", "", "Todos los proyectos");
 allProjects.value = "";
 projectFilter.appendChild(allProjects);
 getTemplateProjects(data).forEach(function(project) {
 const item = element("option", "", project);
 item.value = project;
 projectFilter.appendChild(item);
 });
 projectFilter.value = state.templatesFilterProject;

 const statusFilter = element("select", "form-control");
 [{value:"all", label:"Todas"}, {value:"active", label:"Activas"}, {value:"inactive", label:"Inactivas"}].forEach(function(option) {
 const item = element("option", "", option.label);
 item.value = option.value;
 statusFilter.appendChild(item);
 });
 statusFilter.value = state.templatesFilterStatus;

 typeFilter.addEventListener("change", function() { state.templatesFilterType = typeFilter.value; refreshTemplatesScreenFromState(); });
 projectFilter.addEventListener("change", function() { state.templatesFilterProject = projectFilter.value; refreshTemplatesScreenFromState(); });
 statusFilter.addEventListener("change", function() { state.templatesFilterStatus = statusFilter.value; refreshTemplatesScreenFromState(); });
 filters.append(typeFilter, projectFilter, statusFilter);
 page.appendChild(filters);

 const list = element("div", "templates-list");
 const filtered = filteredTemplatesAdmin(data);
 if (!filtered.length) {
 const empty = element("div", "empty-state", templates.length ? "No hay plantillas con estos filtros." : "Todavía no hay plantillas. Crea la primera para empezar.");
 list.appendChild(empty);
 } else {
 filtered.forEach(function(template) {
 const card = element("section", "template-card" + (template.activo ? "" : " inactive"));
 const head = element("div", "template-card-head");
 const titleWrap = element("div", "");
 titleWrap.appendChild(element("div", "template-card-title", template.nombre || "Sin nombre"));
 const badges = element("div", "template-badges");
 badges.appendChild(element("span", "template-badge", templateTypeLabel(template.tipo_mensaje, data)));
 const scopeText = template.alcance === "PROYECTO" ? (template.proyecto || "Proyecto") : "Global";
 badges.appendChild(element("span", "template-badge" + (template.alcance === "PROYECTO" ? " project" : ""), scopeText));
 if (template.predeterminada) badges.appendChild(element("span", "template-badge default", "Predeterminada"));
 if (!template.activo) badges.appendChild(element("span", "template-badge", "Inactiva"));
 titleWrap.appendChild(badges);
 head.appendChild(titleWrap);
 if (data.can_edit) {
 const edit = element("button", "secondary-button", "Editar");
 edit.type = "button";
 edit.addEventListener("click", function() { openTemplateEditor(template, data); });
 head.appendChild(edit);
 }
 card.appendChild(head);
 card.appendChild(element("div", "template-message", template.mensaje || ""));
 const meta = ["v" + String(template.version || 1), template.updated_by || "", template.updated_at ? formatDateValue(template.updated_at, true) : ""].filter(Boolean).join(" · ");
 if (meta) card.appendChild(element("div", "template-meta", meta));
 list.appendChild(card);
 });
 }
 page.appendChild(list);
 page.appendChild(element("div", "campaign-readonly-note", "Las plantillas se guardan en la hoja Plantillas. Desactivar conserva el historial; no se eliminan registros."));
 fragment.appendChild(page);
 content.className = "";
 content.replaceChildren(fragment);
 } catch (error) {
 content.className = "";
 content.replaceChildren(element("div", "empty-state", "No se pudieron cargar las plantillas."));
 showError(error.message);
 reportClientError(error, {accion: "templates.list", endpoint: "/api/templates"});
 }
 }


 function catalogGroupLabel(group) {
 if (group === "system") return "Sistema";
 if (group === "legacy") return "Histórico";
 return "Operativo";
 }

 function catalogGroupDescription(group) {
 if (group === "system") return "Valores protegidos porque participan en automatizaciones y reglas centrales.";
 if (group === "legacy") return "Datos conservados por compatibilidad. No se usan para nuevas capturas.";
 return "Opciones que puedes administrar sin tocar código ni Google Sheets.";
 }

 async function loadCatalogsAdmin(force) {
 if (state.catalogsAdmin && !force) return state.catalogsAdmin;
 const data = await api("/api/catalogs");
 state.catalogsAdmin = data;
 const catalogs = Array.isArray(data.catalogs) ? data.catalogs : [];
 const selectedExists = catalogs.some(function(c) { return c.key === state.catalogsSelectedKey && c.group === state.catalogsGroup; });
 if (!selectedExists) {
 const first = catalogs.find(function(c) { return c.group === state.catalogsGroup; }) || catalogs[0];
 state.catalogsSelectedKey = first ? first.key : "";
 }
 return data;
 }

 function getSelectedCatalogAdmin(data) {
 const catalogs = data && Array.isArray(data.catalogs) ? data.catalogs : [];
 return catalogs.find(function(c) { return c.key === state.catalogsSelectedKey; }) ||
 catalogs.find(function(c) { return c.group === state.catalogsGroup; }) ||
 catalogs[0] || null;
 }

 function refreshCatalogsScreenFromState() {
 const route = parseRoute();
 if (route.type === "catalogs") renderCatalogsAdmin(true);
 }

 function catalogVisibleOptions(catalog) {
 let rows = catalog && Array.isArray(catalog.options) ? catalog.options.slice() : [];
 const search = normalized(state.catalogsOptionSearch || "");
 if (search) {
 rows = rows.filter(function(option) {
 return normalized([option.nombre, option.codigo_sistema, option.notas].filter(Boolean).join(" ")).includes(search);
 });
 }
 if (state.catalogsOptionStatus === "active") rows = rows.filter(function(o) { return !!o.activo; });
 if (state.catalogsOptionStatus === "inactive") rows = rows.filter(function(o) { return !o.activo; });
 return rows;
 }

 function openCatalogOptionEditor(catalog, option) {
 if (!catalog || !catalog.editable) return;
 const isEdit = !!option;
 const source = option || {};
 const pop = openPopover(isEdit ? "Editar opción" : "Nueva opción");

 const name = element("input", "form-control");
 name.type = "text";
 name.maxLength = 100;
 name.placeholder = "Nombre visible en el CRM";
 name.value = source.nombre || "";
 name.disabled = isEdit && !source.can_rename;
 pop.body.appendChild(popoverField("Nombre", name));

 if (isEdit && source.codigo_sistema) {
 const system = element("div", "catalog-system-code");
 system.appendChild(element("span", "catalog-code-label", "Código interno"));
 system.appendChild(element("code", "catalog-code-value", source.codigo_sistema));
 pop.body.appendChild(system);
 }

 const notes = element("textarea", "form-control form-textarea catalog-note-input");
 notes.maxLength = 500;
 notes.placeholder = "Nota interna opcional: para qué se usa o cuándo elegirla.";
 notes.value = source.notas || "";
 notes.disabled = isEdit && !source.can_edit_notes;
 pop.body.appendChild(popoverField("Nota interna", notes));

 const activeLabel = element("label", "template-inline-check");
 const active = element("input");
 active.type = "checkbox";
 active.checked = source.activo === undefined ? true : !!source.activo;
 active.disabled = isEdit && !source.can_toggle;
 activeLabel.append(active, document.createTextNode(" Opción activa"));
 pop.body.appendChild(activeLabel);

 if (isEdit && source.locked && source.lock_reason) {
 pop.body.appendChild(element("div", "catalog-lock-note", "Protegida · " + source.lock_reason));
 }

 pop.body.appendChild(element("div", "popover-help", "Desactivar conserva los datos históricos; solamente deja de ofrecer la opción hacia adelante."));

 popoverActions(pop, async function() {
 const payload = {
 nombre: name.value.trim(),
 notas: notes.value.trim(),
 activo: active.checked
 };
 if (!payload.nombre) throw new Error("Capture un nombre para la opción.");
 if (isEdit) {
 await api("/api/catalogs/" + encodeURIComponent(source.option_id), {
 method: "PATCH",
 body: JSON.stringify({option: payload})
 });
 } else {
 await api("/api/catalogs", {
 method: "POST",
 body: JSON.stringify({catalogo: catalog.key, option: payload})
 });
 }
 state.catalogsAdmin = null;
 await loadCatalogsAdmin(true);
 refreshCatalogsScreenFromState();
 }, isEdit ? "Guardar cambios" : "Crear opción");
 }

 async function toggleCatalogOption(catalog, option) {
 if (!catalog || !option || !option.can_toggle) return;
 const next = !option.activo;
 const before = option.activo;
 option.activo = next;
 refreshCatalogsScreenFromState();
 try {
 await api("/api/catalogs/" + encodeURIComponent(option.option_id), {
 method: "PATCH",
 body: JSON.stringify({option: {activo: next}})
 });
 state.catalogsAdmin = null;
 await loadCatalogsAdmin(true);
 refreshCatalogsScreenFromState();
 } catch (error) {
 option.activo = before;
 refreshCatalogsScreenFromState();
 showError(error.message || "No se pudo actualizar la opción.");
 }
 }

 async function moveCatalogOption(catalog, optionId, delta) {
 if (!catalog || !catalog.editable) return;
 const all = Array.isArray(catalog.options) ? catalog.options.slice() : [];
 const index = all.findIndex(function(o) { return o.option_id === optionId; });
 const target = index + delta;
 if (index < 0 || target < 0 || target >= all.length) return;
 const temp = all[index];
 all[index] = all[target];
 all[target] = temp;
 catalog.options = all;
 refreshCatalogsScreenFromState();
 try {
 await api("/api/catalogs/reorder", {
 method: "POST",
 body: JSON.stringify({catalogo: catalog.key, option_ids: all.map(function(o) { return o.option_id; })})
 });
 state.catalogsAdmin = null;
 await loadCatalogsAdmin(true);
 refreshCatalogsScreenFromState();
 } catch (error) {
 state.catalogsAdmin = null;
 await loadCatalogsAdmin(true).catch(function() {});
 refreshCatalogsScreenFromState();
 showError(error.message || "No se pudo reordenar el catálogo.");
 }
 }

 function catalogMetricCard(value, label, tone) {
 const card = element("div", "catalog-metric-card" + (tone ? " " + tone : ""));
 card.appendChild(element("strong", "", String(value)));
 card.appendChild(element("span", "", label));
 return card;
 }

 async function renderCatalogsAdmin(fromStateOnly) {
 const content = clearContent();
 if (!fromStateOnly || !state.catalogsAdmin) {
 content.className = "loading";
 content.textContent = "Cargando catálogos…";
 }

 try {
 const data = await loadCatalogsAdmin(false);
 const catalogs = Array.isArray(data.catalogs) ? data.catalogs : [];
 const fragment = document.createDocumentFragment();
 const page = element("div", "catalogs-page");

 const toolbar = element("div", "templates-toolbar");
 const back = element("button", "templates-back", "← Más");
 back.type = "button";
 back.addEventListener("click", function() { navigate("mas"); });
 toolbar.appendChild(back);
 const reload = element("button", "secondary-button catalog-refresh", "Actualizar");
 reload.type = "button";
 reload.addEventListener("click", async function() {
 reload.disabled = true;
 try {
 state.catalogsAdmin = null;
 await loadCatalogsAdmin(true);
 refreshCatalogsScreenFromState();
 } finally { reload.disabled = false; }
 });
 toolbar.appendChild(reload);
 page.appendChild(toolbar);

 page.appendChild(createHero(
 "CONTROL CENTRAL",
 "Catálogos",
 "Administra las opciones que alimentan el CRM. Los valores sensibles están protegidos y los históricos nunca se borran."
 ));

 const summary = data.summary || {};
 const metrics = element("div", "catalog-metrics");
 metrics.appendChild(catalogMetricCard(summary.operational_catalogs || 0, "Catálogos operativos"));
 metrics.appendChild(catalogMetricCard(summary.active_options || 0, "Opciones activas"));
 metrics.appendChild(catalogMetricCard(summary.system_catalogs || 0, "Catálogos protegidos"));
 metrics.appendChild(catalogMetricCard(summary.issues ? summary.issues : "✓", summary.issues ? "Requieren atención" : "Sistema consistente", summary.issues ? "warning" : "ok"));
 page.appendChild(metrics);

 const health = element("div", "catalog-health " + (summary.issues ? "warning" : "ok"));
 health.appendChild(element("div", "catalog-health-icon", summary.issues ? "!" : "✓"));
 const healthText = element("div", "");
 healthText.appendChild(element("strong", "", summary.issues ? "Revisión recomendada" : "Configuración consistente"));
 healthText.appendChild(element("span", "", summary.issues ? "Hay opciones requeridas por el sistema que faltan o están inactivas." : "Las opciones críticas para pipeline, CAPI y captura están disponibles."));
 health.appendChild(healthText);
 page.appendChild(health);

 const groupTabs = element("div", "catalog-group-tabs");
 [
 {key:"operational", label:"Operativos"},
 {key:"system", label:"Sistema"},
 {key:"legacy", label:"Históricos"}
 ].forEach(function(group) {
 const button = element("button", "catalog-group-tab" + (state.catalogsGroup === group.key ? " active" : ""), group.label);
 button.type = "button";
 button.addEventListener("click", function() {
 state.catalogsGroup = group.key;
 const first = catalogs.find(function(c) { return c.group === group.key; });
 state.catalogsSelectedKey = first ? first.key : "";
 state.catalogsOptionSearch = "";
 state.catalogsOptionStatus = "all";
 refreshCatalogsScreenFromState();
 });
 groupTabs.appendChild(button);
 });
 page.appendChild(groupTabs);
 page.appendChild(element("div", "catalog-group-caption", catalogGroupDescription(state.catalogsGroup)));

 const workspace = element("div", "catalog-workspace");
 const nav = element("aside", "catalog-nav-panel");
 const catalogSearch = element("input", "form-control catalog-search");
 catalogSearch.type = "search";
 catalogSearch.placeholder = "Buscar catálogo";
 catalogSearch.value = state.catalogsSearch;
 catalogSearch.addEventListener("input", function() {
 state.catalogsSearch = catalogSearch.value;
 refreshCatalogsScreenFromState();
 });
 nav.appendChild(catalogSearch);

 const navList = element("div", "catalog-nav-list");
 const searchCatalog = normalized(state.catalogsSearch || "");
 const groupCatalogs = catalogs.filter(function(c) {
 if (c.group !== state.catalogsGroup) return false;
 if (!searchCatalog) return true;
 return normalized([c.title, c.description, c.where_used].join(" ")).includes(searchCatalog);
 });

 if (!groupCatalogs.length) {
 navList.appendChild(element("div", "catalog-empty-mini", "No hay catálogos con esa búsqueda."));
 } else {
 groupCatalogs.forEach(function(catalog) {
 const button = element("button", "catalog-nav-item" + (catalog.key === state.catalogsSelectedKey ? " active" : ""));
 button.type = "button";
 const top = element("div", "catalog-nav-title-row");
 top.appendChild(element("strong", "", catalog.title));
 const badge = element("span", "catalog-nav-count", String(catalog.active_count || 0));
 top.appendChild(badge);
 button.appendChild(top);
 button.appendChild(element("div", "catalog-nav-use", catalog.where_used || ""));
 const meta = element("div", "catalog-nav-meta");
 meta.appendChild(element("span", catalog.editable ? "editable" : "protected", catalog.editable ? "Editable" : "Protegido"));
 if (catalog.inactive_count) meta.appendChild(element("span", "", String(catalog.inactive_count) + " inactivas"));
 button.appendChild(meta);
 button.addEventListener("click", function() {
 state.catalogsSelectedKey = catalog.key;
 state.catalogsOptionSearch = "";
 state.catalogsOptionStatus = "all";
 refreshCatalogsScreenFromState();
 });
 navList.appendChild(button);
 });
 }
 nav.appendChild(navList);
 workspace.appendChild(nav);

 const detail = element("section", "catalog-detail-panel");
 const selected = getSelectedCatalogAdmin(data);
 if (!selected || selected.group !== state.catalogsGroup) {
 detail.appendChild(element("div", "empty-state", "Selecciona un catálogo."));
 } else {
 const detailHead = element("div", "catalog-detail-head");
 const detailTitle = element("div", "");
 const titleLine = element("div", "catalog-title-line");
 titleLine.appendChild(element("h2", "catalog-detail-title", selected.title));
 titleLine.appendChild(element("span", "catalog-group-badge " + selected.group, catalogGroupLabel(selected.group)));
 detailTitle.appendChild(titleLine);
 detailTitle.appendChild(element("p", "catalog-detail-description", selected.description));
 const context = element("div", "catalog-context-line");
 context.appendChild(element("span", "", "Se usa en: " + (selected.where_used || "CRM")));
 if (selected.usage_supported) context.appendChild(element("span", "", String(selected.usage_total || 0) + " leads actuales"));
 detailTitle.appendChild(context);
 detailHead.appendChild(detailTitle);
 if (data.can_edit && selected.can_create) {
 const add = element("button", "save-button", "+ Nueva opción");
 add.type = "button";
 add.addEventListener("click", function() { openCatalogOptionEditor(selected, null); });
 detailHead.appendChild(add);
 }
 detail.appendChild(detailHead);

 const utility = element("div", "catalog-option-toolbar");
 const optionSearch = element("input", "form-control");
 optionSearch.type = "search";
 optionSearch.placeholder = "Buscar opción";
 optionSearch.value = state.catalogsOptionSearch;
 optionSearch.addEventListener("input", function() {
 state.catalogsOptionSearch = optionSearch.value;
 refreshCatalogsScreenFromState();
 });
 const status = element("select", "form-control");
 [
 {value:"all", label:"Todas"},
 {value:"active", label:"Activas"},
 {value:"inactive", label:"Inactivas"}
 ].forEach(function(item) {
 const o = element("option", "", item.label);
 o.value = item.value;
 status.appendChild(o);
 });
 status.value = state.catalogsOptionStatus;
 status.addEventListener("change", function() {
 state.catalogsOptionStatus = status.value;
 refreshCatalogsScreenFromState();
 });
 utility.append(optionSearch, status);
 detail.appendChild(utility);

 const list = element("div", "catalog-option-list");
 const rows = catalogVisibleOptions(selected);
 if (!rows.length) {
 list.appendChild(element("div", "empty-state", "No hay opciones con estos filtros."));
 } else {
 rows.forEach(function(option) {
 const row = element("div", "catalog-option-row" + (option.activo ? "" : " inactive") + (option.locked ? " locked" : ""));
 const order = element("div", "catalog-option-order", String(Math.round(Number(option.orden || 0) / 10) || "·"));
 row.appendChild(order);
 const main = element("div", "catalog-option-main");
 const nameLine = element("div", "catalog-option-name-line");
 nameLine.appendChild(element("strong", "catalog-option-name", option.nombre || "Sin nombre"));
 if (option.locked) nameLine.appendChild(element("span", "catalog-mini-badge protected", "Protegida"));
 if (!option.activo) nameLine.appendChild(element("span", "catalog-mini-badge inactive", "Inactiva"));
 nameLine.appendChild(element("span", "catalog-mini-badge code", option.codigo_sistema || "SIN_CODIGO"));
 main.appendChild(nameLine);
 if (option.notas) main.appendChild(element("div", "catalog-option-note", option.notas));
 const usageLine = element("div", "catalog-option-usage");
 if (option.usage_supported) usageLine.appendChild(element("span", "", Number(option.usage_count || 0) === 1 ? "Usada por 1 lead" : "Usada por " + String(option.usage_count || 0) + " leads"));
 else usageLine.appendChild(element("span", "", selected.group === "legacy" ? "Solo histórico" : "Sin conteo de uso directo"));
 if (option.lock_reason) usageLine.appendChild(element("span", "", option.lock_reason));
 main.appendChild(usageLine);
 row.appendChild(main);

 const actions = element("div", "catalog-option-actions");
 if (data.can_edit && option.can_reorder && selected.options.length > 1 && !state.catalogsOptionSearch && state.catalogsOptionStatus === "all") {
 const up = element("button", "catalog-icon-button", "↑");
 up.type = "button";
 up.title = "Subir";
 up.disabled = selected.options.findIndex(function(o) { return o.option_id === option.option_id; }) === 0;
 up.addEventListener("click", function() { moveCatalogOption(selected, option.option_id, -1); });
 const down = element("button", "catalog-icon-button", "↓");
 down.type = "button";
 down.title = "Bajar";
 down.disabled = selected.options.findIndex(function(o) { return o.option_id === option.option_id; }) === selected.options.length - 1;
 down.addEventListener("click", function() { moveCatalogOption(selected, option.option_id, 1); });
 actions.append(up, down);
 }
 if (data.can_edit && option.can_toggle) {
 const toggle = element("button", "catalog-toggle " + (option.activo ? "on" : "off"), option.activo ? "Activo" : "Inactivo");
 toggle.type = "button";
 toggle.setAttribute("aria-pressed", option.activo ? "true" : "false");
 toggle.title = option.activo ? "Desactivar opción" : "Activar opción";
 toggle.addEventListener("click", function() { toggleCatalogOption(selected, option); });
 actions.appendChild(toggle);
 }
 if (data.can_edit && (option.can_rename || option.can_edit_notes)) {
 const edit = element("button", "secondary-button catalog-edit-button", "Editar");
 edit.type = "button";
 edit.addEventListener("click", function() { openCatalogOptionEditor(selected, option); });
 actions.appendChild(edit);
 }
 row.appendChild(actions);
 list.appendChild(row);
 });
 }
 detail.appendChild(list);

 const foot = element("div", "catalog-foot-note");
 foot.appendChild(element("strong", "", "Regla de seguridad: "));
 foot.appendChild(document.createTextNode(selected.editable ? "desactivar nunca elimina datos históricos. Los códigos internos permanecen estables aunque cambie el nombre visible." : "este catálogo es de solo lectura porque participa en reglas del sistema."));
 detail.appendChild(foot);
 }
 workspace.appendChild(detail);
 page.appendChild(workspace);
 fragment.appendChild(page);
 content.className = "";
 content.replaceChildren(fragment);
 } catch (error) {
 content.className = "";
 content.replaceChildren(element("div", "empty-state", "No se pudieron cargar los catálogos."));
 showError(error.message);
 reportClientError(error, {accion: "catalogs.list", endpoint: "/api/catalogs"});
 }
 }


 function variableTokenSlug(value) {
 return String(value || "")
 .trim()
 .toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")
 .replace(/[^a-z0-9]+/g, "_")
 .replace(/^_+|_+$/g, "");
 }

 async function loadMessageVariablesAdmin(force) {
 if (state.variablesAdmin && !force) return state.variablesAdmin;
 const data = await api("/api/message-variables");
 state.variablesAdmin = data;
 return data;
 }

 function refreshMessageVariablesScreenFromState() {
 if (location.hash !== "#mas/variables") return;
 renderMessageVariablesAdmin(true).catch(function(error) {
 showError(error.message);
 reportClientError(error, {accion: "message_variables.render", endpoint: "/api/message-variables"});
 });
 }

 function variableSourceLabel(item) {
 const type = String(item && item.tipo_fuente || "").toUpperCase();
 if (type === "CRM") return "CRM · " + (item.campo_fuente || "Campo");
 if (type === "CALCULADA") return "Calculada";
 if (type === "CONFIG") return "Empresa · " + (item.campo_fuente || "Config");
 if (type === "USUARIO") return "Usuario · " + (item.campo_fuente || "Dato");
 if (type === "CUSTOM") return "Personalizada";
 return type || "Variable";
 }

 function combinedVariableSources(data) {
 const sources = Array.isArray(data && data.sources) ? data.sources.slice() : [];
 const vars = Array.isArray(data && data.variables) ? data.variables : [];
 const represented = new Set(sources.map(function(item) { return String(item.variable_id || ""); }).filter(Boolean));
 vars.forEach(function(variable) {
 if (variable.personalizada || represented.has(String(variable.variable_id || ""))) return;
 sources.push({
 source_id: "REGISTRY|" + variable.variable_id,
 tipo_fuente: variable.tipo_fuente,
 campo_fuente: variable.campo_fuente,
 nombre: variable.nombre,
 token: variable.token,
 grupo: variable.grupo,
 formato: variable.formato,
 ejemplo: variable.ejemplo,
 technical: String(variable.grupo || "").toLowerCase() === "avanzadas",
 registered: true,
 variable_id: variable.variable_id,
 habilitada: !!variable.habilitada,
 activa: variable.activa !== false,
 personalizada: false,
 usage_count: Number(variable.usage_count || 0),
 used_in: variable.used_in || []
 });
 });
 return sources;
 }

 async function toggleMessageVariableVisibility(item) {
 if (!item) return;
 const next = !item.habilitada;
 try {
 if (item.variable_id) {
 await api("/api/message-variables/" + encodeURIComponent(item.variable_id), {
 method: "PATCH",
 body: JSON.stringify({variable: {habilitada: next}})
 });
 } else if (next) {
 await api("/api/message-variables", {
 method: "POST",
 body: JSON.stringify({kind: "SOURCE", source_id: item.source_id})
 });
 } else {
 return;
 }
 state.variablesAdmin = null;
 state.messageTemplates = null;
 state.templatesAdmin = null;
 await loadMessageVariablesAdmin(true);
 refreshMessageVariablesScreenFromState();
 } catch (error) {
 showError(error.message || "No se pudo actualizar la variable.");
 }
 }

 function createCustomOptionEditor(container, value, isDefault, radioName, onRemove) {
 const row = element("div", "custom-option-edit-row");
 const input = element("input", "form-control");
 input.type = "text";
 input.placeholder = "Ej. Santa Catarina";
 input.value = value || "";
 const defaultLabel = element("label", "custom-option-default");
 const radio = element("input");
 radio.type = "radio";
 radio.name = radioName;
 radio.checked = !!isDefault;
 defaultLabel.append(radio, document.createTextNode(" Predeterminada"));
 const remove = element("button", "custom-option-remove", "×");
 remove.type = "button";
 remove.title = "Quitar opción";
 remove.addEventListener("click", function() {
 row.remove();
 if (onRemove) onRemove();
 });
 row.append(input, defaultLabel, remove);
 container.appendChild(row);
 return {row: row, input: input, radio: radio};
 }

 function openCustomVariableEditor(variable, data) {
 const isEdit = !!(variable && variable.variable_id);
 if (!data || !data.can_edit) {
 showError("Solo un administrador puede modificar variables.");
 return;
 }
 const source = variable || {};
 const pop = openPopover(isEdit ? "Editar variable personalizada" : "Nueva variable personalizada");
 pop.panel.classList.add("custom-variable-editor");

 const name = element("input", "form-control");
 name.type = "text";
 name.maxLength = 80;
 name.placeholder = "Ej. Municipio";
 name.value = source.nombre || "";
 pop.body.appendChild(popoverField("Nombre", name));

 const token = element("input", "form-control");
 token.type = "text";
 token.maxLength = 60;
 token.placeholder = "municipio";
 token.value = String(source.token || "").replace(/^\{|\}$/g, "");
 token.disabled = isEdit;
 const tokenField = popoverField("Token", token);
 pop.body.appendChild(tokenField);
 const tokenPreview = element("div", "custom-variable-token-preview");
 const tokenCode = document.createElement("code");
 tokenCode.textContent = source.token || "{municipio}";
 tokenPreview.append(tokenCode, element("span", "", isEdit ? "El token queda fijo para no romper plantillas existentes." : "Se insertará así dentro de las plantillas."));
 pop.body.appendChild(tokenPreview);

 const type = element("select", "form-control");
 [["lista", "Lista de opciones"], ["texto", "Texto libre al preparar el mensaje"]].forEach(function(item) {
 const option = element("option", "", item[1]);
 option.value = item[0];
 if (String(source.formato || "lista").toLowerCase() === item[0]) option.selected = true;
 type.appendChild(option);
 });
 type.disabled = isEdit;
 pop.body.appendChild(popoverField("Tipo", type));

 const visibleLabel = element("label", "confirm-line");
 const visible = element("input");
 visible.type = "checkbox";
 visible.checked = source.habilitada !== false;
 visibleLabel.append(visible, document.createTextNode(" Mostrar esta variable en el editor de plantillas"));
 pop.body.appendChild(visibleLabel);

 const optionsWrap = element("div", "custom-options-editor");
 const optionRows = [];
 const radioName = "custom-default-" + String(Date.now());
 const currentOptions = Array.isArray(source.opciones) ? source.opciones : [];
 function addOption(value, selected) {
 const editor = createCustomOptionEditor(optionsWrap, value, selected, radioName, function() {});
 optionRows.push(editor);
 }
 currentOptions.forEach(function(item) { addOption(item.valor || item.etiqueta || "", !!item.predeterminado); });
 if (!currentOptions.length && String(source.formato || "lista").toLowerCase() === "lista") addOption("", false);
 const optionsField = popoverField("Opciones", optionsWrap);
 pop.body.appendChild(optionsField);
 const addOptionButton = element("button", "secondary-button custom-add-option", "+ Agregar opción");
 addOptionButton.type = "button";
 addOptionButton.addEventListener("click", function() { addOption("", false); });
 pop.body.appendChild(addOptionButton);

 const example = element("input", "form-control");
 example.type = "text";
 example.placeholder = "Ej. Santa Catarina";
 example.value = source.ejemplo || "";
 pop.body.appendChild(popoverField("Ejemplo / ayuda", example));

 const notes = element("textarea", "form-control form-textarea");
 notes.placeholder = "Uso interno opcional. Ej. Municipio donde se ubica el proyecto.";
 notes.value = source.notas || "";
 pop.body.appendChild(popoverField("Notas", notes));

 function updateTokenPreview() {
 const raw = token.value.trim() || name.value.trim();
 const slug = variableTokenSlug(raw) || "variable";
 tokenCode.textContent = "{" + slug + "}";
 }
 function syncType() {
 const isList = type.value === "lista";
 optionsField.style.display = isList ? "grid" : "none";
 addOptionButton.style.display = isList ? "inline-flex" : "none";
 }
 name.addEventListener("input", function() { if (!token.value.trim()) updateTokenPreview(); });
 token.addEventListener("input", updateTokenPreview);
 type.addEventListener("change", syncType);
 updateTokenPreview();
 syncType();

 popoverActions(pop, async function() {
 const payload = {
 nombre: name.value.trim(),
 token: "{" + (variableTokenSlug(token.value.trim() || name.value.trim()) || "") + "}",
 formato: type.value,
 habilitada: visible.checked,
 ejemplo: example.value.trim(),
 notas: notes.value.trim()
 };
 if (!payload.nombre) throw new Error("Capture un nombre para la variable.");
 if (payload.token === "{}") throw new Error("Capture un token válido.");
 if (type.value === "lista") {
 const rows = Array.from(optionsWrap.querySelectorAll(".custom-option-edit-row"));
 const options = rows.map(function(row) {
 const input = row.querySelector('input[type="text"]');
 return input ? input.value.trim() : "";
 }).filter(Boolean);
 if (!options.length) throw new Error("Agregue al menos una opción.");
 const defaultRow = rows.find(function(row) {
 const radio = row.querySelector('input[type="radio"]');
 return radio && radio.checked;
 });
 const defaultInput = defaultRow ? defaultRow.querySelector('input[type="text"]') : null;
 payload.opciones = options;
 payload.valor_predeterminado = defaultInput ? defaultInput.value.trim() : "";
 }

 if (isEdit) {
 await api("/api/message-variables/" + encodeURIComponent(source.variable_id), {
 method: "PATCH",
 body: JSON.stringify({variable: payload})
 });
 } else {
 await api("/api/message-variables", {
 method: "POST",
 body: JSON.stringify({kind: "CUSTOM", variable: payload})
 });
 }
 state.variablesAdmin = null;
 state.messageTemplates = null;
 state.templatesAdmin = null;
 await loadMessageVariablesAdmin(true);
 refreshMessageVariablesScreenFromState();
 }, isEdit ? "Guardar cambios" : "Crear variable");
 }

 function variableRowElement(item, data, isCustom) {
 const row = element("div", "variable-row" + (item.technical ? " technical" : "") + (!item.habilitada ? " hidden-variable" : "") + (isCustom ? " custom-variable-card" : ""));
 const main = element("div", "variable-main");
 const title = element("div", "variable-title-line");
 title.appendChild(element("span", "variable-name", item.nombre || item.token || "Variable"));
 title.appendChild(element("code", "variable-token-chip", item.token || ""));
 const sourceClass = item.technical ? " technical" : (isCustom ? " custom" : "");
 title.appendChild(element("span", "variable-source-chip" + sourceClass, variableSourceLabel(item)));
 if (!item.registered && !isCustom) title.appendChild(element("span", "variable-source-chip", "Disponible"));
 main.appendChild(title);

 const meta = element("div", "variable-meta");
 meta.appendChild(element("span", "", item.grupo || "General"));
 meta.appendChild(element("span", "", Number(item.usage_count || 0) + (Number(item.usage_count || 0) === 1 ? " plantilla" : " plantillas")));
 if (!item.habilitada) meta.appendChild(element("span", "variable-unused-note", "Oculta en el editor"));
 main.appendChild(meta);
 if (item.ejemplo) main.appendChild(element("div", "variable-example", "Ejemplo: " + item.ejemplo));
 if (isCustom && Array.isArray(item.opciones) && item.opciones.length) {
 const chips = element("div", "custom-options-preview");
 item.opciones.slice(0, 6).forEach(function(option) {
 chips.appendChild(element("span", "custom-option-chip" + (option.predeterminado ? " default" : ""), (option.predeterminado ? "★ " : "") + (option.etiqueta || option.valor)));
 });
 if (item.opciones.length > 6) chips.appendChild(element("span", "custom-option-chip", "+" + (item.opciones.length - 6)));
 main.appendChild(chips);
 }
 row.appendChild(main);

 const actions = element("div", "variable-actions");
 if (data.can_edit) {
 const toggle = element("button", "catalog-toggle variable-visibility " + (item.habilitada ? "on" : "off"), item.habilitada ? "Visible" : "Oculta");
 toggle.type = "button";
 toggle.title = item.habilitada ? "Ocultar del editor de plantillas" : "Mostrar en el editor de plantillas";
 toggle.addEventListener("click", function() { toggleMessageVariableVisibility(item); });
 actions.appendChild(toggle);
 if (isCustom) {
 const edit = element("button", "secondary-button catalog-edit-button", "Editar");
 edit.type = "button";
 edit.addEventListener("click", function() { openCustomVariableEditor(item, data); });
 actions.appendChild(edit);
 }
 }
 row.appendChild(actions);
 return row;
 }

 async function renderMessageVariablesAdmin(fromStateOnly) {
 const content = clearContent();
 if (!fromStateOnly || !state.variablesAdmin) {
 content.className = "loading";
 content.textContent = "Cargando variables…";
 }
 try {
 const data = await loadMessageVariablesAdmin(false);
 const page = element("div", "variables-page");
 const toolbar = element("div", "templates-toolbar");
 const back = element("button", "templates-back", "← Más");
 back.type = "button";
 back.addEventListener("click", function() { navigate("mas"); });
 const reload = element("button", "secondary-button", "Actualizar");
 reload.type = "button";
 reload.addEventListener("click", async function() {
 reload.disabled = true;
 try {
 state.variablesAdmin = null;
 await loadMessageVariablesAdmin(true);
 refreshMessageVariablesScreenFromState();
 } finally { reload.disabled = false; }
 });
 toolbar.append(back, reload);
 page.appendChild(toolbar);

 page.appendChild(createHero(
 "MENSAJERÍA DINÁMICA",
 "Variables mensajes",
 "Decide qué datos aparecen al construir plantillas y crea variables propias sin agregar columnas al CRM."
 ));

 const summary = data.summary || {};
 const metrics = element("div", "catalog-metrics");
 metrics.appendChild(catalogMetricCard(summary.available_sources || 0, "Datos disponibles"));
 metrics.appendChild(catalogMetricCard(summary.visible_variables || 0, "Visibles en plantillas"));
 metrics.appendChild(catalogMetricCard(summary.custom_variables || 0, "Personalizadas"));
 metrics.appendChild(catalogMetricCard(summary.used_variables || 0, "Variables en uso", summary.issues ? "warning" : "ok"));
 page.appendChild(metrics);

 const explainer = element("div", "variables-explainer");
 const explainText = element("div", "");
 explainText.appendChild(element("strong", "", "Una variable no tiene que existir como columna del CRM."));
 explainText.appendChild(element("span", "", "Las variables de datos se rellenan automáticamente. Las personalizadas —por ejemplo {municipio}— pueden tener una lista de opciones y la App te pedirá elegir el valor justo antes de preparar WhatsApp."));
 explainer.appendChild(explainText);
 if (data.can_edit) {
 const add = element("button", "save-button", "+ Nueva variable");
 add.type = "button";
 add.addEventListener("click", function() { openCustomVariableEditor(null, data); });
 explainer.appendChild(add);
 }
 page.appendChild(explainer);

 const health = element("div", "catalog-health " + (summary.issues ? "warning" : "ok"));
 health.appendChild(element("div", "catalog-health-icon", summary.issues ? "!" : "✓"));
 const healthText = element("div", "");
 healthText.appendChild(element("strong", "", summary.issues ? "Hay variables personalizadas incompletas" : "Variables listas para usar"));
 healthText.appendChild(element("span", "", summary.issues ? "Alguna variable de lista usada por una plantilla no tiene opciones activas." : "Ocultar una variable solo la quita del selector; las plantillas existentes siguen funcionando."));
 health.appendChild(healthText);
 page.appendChild(health);

 const tabs = element("div", "variables-tabs");
 [
 {key: "crm", label: "Datos del CRM"},
 {key: "company", label: "Empresa y asesor"},
 {key: "custom", label: "Personalizadas"}
 ].forEach(function(group) {
 const button = element("button", "catalog-group-tab" + (state.variablesGroup === group.key ? " active" : ""), group.label);
 button.type = "button";
 button.addEventListener("click", function() { state.variablesGroup = group.key; refreshMessageVariablesScreenFromState(); });
 tabs.appendChild(button);
 });
 page.appendChild(tabs);

 const controls = element("div", "variables-controls");
 const search = element("input", "form-control");
 search.type = "search";
 search.placeholder = "Buscar por nombre, token o campo";
 search.value = state.variablesSearch;
 search.addEventListener("input", function() { state.variablesSearch = search.value; refreshMessageVariablesScreenFromState(); });
 controls.appendChild(search);
 if (state.variablesGroup === "crm") {
 const technical = element("label", "variables-technical-toggle");
 const checkbox = element("input");
 checkbox.type = "checkbox";
 checkbox.checked = !!state.variablesShowTechnical;
 checkbox.addEventListener("change", function() { state.variablesShowTechnical = checkbox.checked; refreshMessageVariablesScreenFromState(); });
 technical.append(checkbox, document.createTextNode(" Mostrar variables técnicas"));
 controls.appendChild(technical);
 }
 page.appendChild(controls);

 const list = element("div", "variable-list");
 const query = normalized(state.variablesSearch || "");
 if (state.variablesGroup === "custom") {
 const custom = Array.isArray(data.custom_variables) ? data.custom_variables.slice() : [];
 const filtered = custom.filter(function(item) {
 if (!query) return true;
 return normalized([item.nombre, item.token, item.notas, item.ejemplo].join(" ")).includes(query);
 });
 if (!filtered.length) list.appendChild(element("div", "variables-empty", custom.length ? "No hay variables personalizadas con esa búsqueda." : "Todavía no tienes variables personalizadas. Crea una como {municipio} y define sus opciones."));
 filtered.forEach(function(item) { list.appendChild(variableRowElement(item, data, true)); });
 } else {
 const allSources = combinedVariableSources(data);
 const filtered = allSources.filter(function(item) {
 const type = String(item.tipo_fuente || "").toUpperCase();
 const belongs = state.variablesGroup === "company" ? (type === "CONFIG" || type === "USUARIO") : (type === "CRM" || type === "CALCULADA");
 if (!belongs) return false;
 if (state.variablesGroup === "crm" && item.technical && !state.variablesShowTechnical) return false;
 if (!query) return true;
 return normalized([item.nombre, item.token, item.campo_fuente, item.grupo].join(" ")).includes(query);
 });
 filtered.sort(function(a, b) {
 if (!!a.technical !== !!b.technical) return a.technical ? 1 : -1;
 if (!!a.habilitada !== !!b.habilitada) return a.habilitada ? -1 : 1;
 return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
 });
 if (!filtered.length) list.appendChild(element("div", "variables-empty", "No hay variables con esos filtros."));
 filtered.forEach(function(item) { list.appendChild(variableRowElement(item, data, false)); });
 }
 page.appendChild(list);

 const foot = element("div", "catalog-foot-note");
 foot.appendChild(element("strong", "", "Cómo funciona: "));
 foot.appendChild(document.createTextNode("Visible = aparece como botón dentro del editor de plantillas. Oculta = deja de ofrecerse para mensajes nuevos, pero no rompe plantillas que ya la usan. Las variables personalizadas se completan al preparar el WhatsApp."));
 page.appendChild(foot);

 content.className = "";
 content.replaceChildren(page);
 } catch (error) {
 content.className = "";
 content.replaceChildren(element("div", "empty-state", "No se pudieron cargar las variables de mensajes."));
 showError(error.message);
 reportClientError(error, {accion: "message_variables.list", endpoint: "/api/message-variables"});
 }
 }


 const HOY_BACKGROUND_POLL_MS = 45 * 1000;
 let hoyBackgroundBusy = false;
 let lastHoyBackgroundPoll = 0;

 function getHoyNewLeadIds(hoy) {
 const rows = hoy && hoy.secciones && Array.isArray(hoy.secciones.nuevos)
 ? hoy.secciones.nuevos
 : [];
 return rows
 .map(function(lead) { return String(lead && lead.crm_lead_id || ""); })
 .filter(Boolean);
 }

 function setHoyUpdateIndicator(active) {
 state.hoyHasUpdate = !!active;
 document.querySelectorAll('[data-view="hoy"]').forEach(function(button) {
 button.classList.toggle("has-update", !!active);
 button.setAttribute("aria-label", active ? "Hoy · hay un nuevo lead" : "Hoy");
 });
 }

 function markCurrentHoyAsSeen() {
 state.seenHoyNewLeadIds = getHoyNewLeadIds(state.hoy);
 setHoyUpdateIndicator(false);
 }

 async function pollHoyInBackground(forceNow) {
 if (hoyBackgroundBusy || document.hidden) return;
 const now = Date.now();
 if (!forceNow && now - lastHoyBackgroundPoll < HOY_BACKGROUND_POLL_MS - 1000) return;

 hoyBackgroundBusy = true;
 try {
 const freshHoy = await api("/api/hoy");
 if (!freshHoy || typeof freshHoy !== "object") return;

 const freshIds = getHoyNewLeadIds(freshHoy);
 const hadBaseline = !!state.hoy || (Array.isArray(state.seenHoyNewLeadIds) && state.seenHoyNewLeadIds.length > 0);
 const seen = new Set(Array.isArray(state.seenHoyNewLeadIds) ? state.seenHoyNewLeadIds : []);
 const hasNewLead = hadBaseline && freshIds.some(function(id) { return !seen.has(id); });

 if (!hadBaseline) {
 state.seenHoyNewLeadIds = freshIds.slice();
 }

 state.hoy = freshHoy;
 state.lastHoyLoad = Date.now();
 lastHoyBackgroundPoll = Date.now();

 if (hasNewLead) {
 // Conservamos la lista actual para que navegar siga siendo instantáneo,
 // pero la marcamos como vencida y la refrescamos sin bloquear la pantalla.
 state.lastLeadsLoad = 0;
 refreshLeadsInBackground();

 const route = parseRoute();
 if (route.type === "view" && route.view === "hoy") {
 await renderHoy(false, true);
 } else {
 setHoyUpdateIndicator(true);
 }
 }
 } catch (error) {
 reportClientError(error, {accion: "hoy.background.poll", endpoint: "/api/hoy"});
 } finally {
 hoyBackgroundBusy = false;
 }
 }

 function prefetchSecondaryViews() {
 const work = function() {
 Promise.allSettled([
 loadLeads(false),
 loadCampaigns(false)
 ]).catch(function() {});
 };

 if ("requestIdleCallback" in window) {
 window.requestIdleCallback(work, {timeout: 1800});
 } else {
 setTimeout(work, 900);
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
 if (!location.hash) {
 history.replaceState(null, "", "#hoy");
 }

 try {
 await loadBootstrap();
 } catch (bootstrapError) {
 // Fallback conservador: si el endpoint consolidado falla, la App sigue
 // pudiendo iniciar con las rutas anteriores.
 reportClientError(bootstrapError, {accion: "app.bootstrap", endpoint: "/api/bootstrap"});
 await loadMe(false);
 }

 await loadMe(false);
 await handleRoute();

 // Campañas no bloquea el arranque. La precarga se difiere un poco para no
 // competir con el primer render ni con una apertura inmediata de lead.
 if (!state.campaigns) {
 setTimeout(function() { refreshCampaignsInBackground(); }, 1200);
 }
 if (!state.leads) prefetchSecondaryViews();

 } catch (error) {
 showError(error.message);
 const content = clearContent();
 content.appendChild(element("div", "empty-state", "No se pudo iniciar el CRM."));
 }
 }


 // Vigilancia de nuevos leads: consulta Hoy en segundo plano sin reconstruir la vista actual.
 setInterval(function() {
 pollHoyInBackground(false);
 }, HOY_BACKGROUND_POLL_MS);

 document.addEventListener("visibilitychange", function() {
 if (!document.hidden) pollHoyInBackground(true);
 });

 window.addEventListener("focus", function() {
 if (Date.now() - lastHoyBackgroundPoll > 5000) pollHoyInBackground(true);
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