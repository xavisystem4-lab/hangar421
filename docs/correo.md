# Correo saliente del ERP (reportes de inventario y lista de compras)

El botón **✉️ Enviar por correo** de Inventario → "Generar Reporte" / "Lista de Compras" manda el
PDF adjunto y, en el cuerpo, el semáforo (verde óptimo / amarillo bajo / rojo crítico) con los
insumos por surtir. El envío lo hace el backend (`apps/backend/src/correo/correo.service.ts`,
endpoint `POST /inventario/reporte/enviar`); el ERP solo arma el PDF.

Se configura **una sola vez** con variables de entorno en el servidor (Railway → Variables).
Sin configurar, el ERP lo dice y ofrece abrir el correo del usuario con el PDF descargado.

## Opción A — SMTP (Gmail, Outlook, correo del dominio)

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tucorreo@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx      # Gmail: "contraseña de aplicación", NO la contraseña normal
CORREO_REMITENTE=tucorreo@gmail.com  # opcional, por defecto SMTP_USER
CORREO_REMITENTE_NOMBRE=HANGAR 421   # opcional
```

Gmail: la cuenta necesita verificación en dos pasos y una *contraseña de aplicación*
(Cuenta de Google → Seguridad → Contraseñas de aplicaciones). Outlook/Microsoft 365:
`smtp.office365.com`, puerto 587. Puerto 465 usa TLS directo (`SMTP_SECURE=true` se infiere).

## Opción B — Resend (https://resend.com)

```
RESEND_API_KEY=re_xxxxxxxxx
CORREO_REMITENTE=reportes@tudominio.com   # de un dominio verificado en Resend
CORREO_REMITENTE_NOMBRE=HANGAR 421
```

Si están definidas ambas opciones, gana Resend.

## Comprobar

`GET /api/v1/inventario/reporte/correo` (con sesión) devuelve `{ configurado, proveedor, remitente, detalle }`.
Los errores del proveedor llegan al ERP tal cual (p. ej. credenciales SMTP rechazadas).
