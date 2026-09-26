export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return jsonResponse({
        ok: true,
        service: "OV CRM Worker",
        version: "0.1.0-bridge"
      });
    }

    if (url.pathname === "/bridge-test") {
      try {
        if (!env.OV_APPS_SCRIPT_URL) {
          return jsonResponse(
            {
              ok: false,
              bridge: false,
              error: "OV_APPS_SCRIPT_URL no configurada"
            },
            500
          );
        }

        if (!env.OV_API_SHARED_SECRET) {
          return jsonResponse(
            {
              ok: false,
              bridge: false,
              error: "OV_API_SHARED_SECRET no configurado"
            },
            500
          );
        }

        const response = await fetch(env.OV_APPS_SCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "me",
            user_email: "opinedo78@gmail.com",
            server_secret: env.OV_API_SHARED_SECRET
          }),
          redirect: "follow"
        });

        const raw = await response.text();

        let data;

        try {
          data = JSON.parse(raw);
        } catch {
          return jsonResponse(
            {
              ok: false,
              bridge: false,
              error: "Apps Script no devolvió JSON válido"
            },
            502
          );
        }

        if (!data.ok) {
          return jsonResponse(
            {
              ok: false,
              bridge: false,
              error_code:
                data?.error?.code || "UPSTREAM_ERROR"
            },
            502
          );
        }

        const adminAuthorized =
          data?.data?.usuario?.rol === "Admin" &&
          data?.data?.usuario?.activo === true;

        return jsonResponse({
          ok: true,
          bridge: true,
          apps_script_version: data.version,
          admin_authorized: adminAuthorized
        });

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            bridge: false,
            error: "Error comunicando con Apps Script"
          },
          502
        );
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found"
      },
      404
    );
  }
};


function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}