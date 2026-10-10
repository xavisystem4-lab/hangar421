# Correo saliente del ERP (reportes de inventario y lista de compras)

El botón **✉️ Enviar por correo** de Inventario → "Generar Reporte" / "Lista de Compras" manda el
PDF adjunto y, en el cuerpo, el semáforo (verde óptimo / amarillo bajo / rojo crítico) con los
insumos por surtir. El envío lo hace el backend (`apps/backend/src/correo/correo.service.ts`,
endpoint `POST /inventario/reporte/enviar`); el ERP solo arma el PDF.

## Lo normal: Admin → Correo en el ERP (solo Administrador corporativo)

Mismo formulario que Licencias Galaviz: **Proveedor** (Gmail / Outlook / Otro), **Servidor
SMTP**, **Puerto y seguridad** (587 STARTTLS o 465 SSL), **Correo (usuario)**, **Contraseña**
(en blanco = conservar la guardada), **Nombre del remitente**, y botones **Guardar** /
**Guardar y enviar prueba**. La contraseña viaja una sola vez, se guarda cifrada (AES-256-GCM
con `CORREO_CIFRADO_KEY`, o `PAGOS_CIFRADO_KEY` si aquella no existe) en
`configuracion_correo` y nunca se devuelve al navegador. Endpoints: `GET/PUT /correo/configuracion`,
`POST /correo/prueba`.

Gmail: la cuenta necesita verificación en dos pasos y una *contraseña de aplicación* (Cuenta de
Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones). Los errores
típicos (535 usuario/contraseña, conexión rechazada, SSL en puerto equivocado) se traducen a
texto claro en el ERP (`CorreoService.explicarError`).

## Respaldo: variables de entorno del servidor

Si la empresa no capturó nada (o lo desactivó), el backend usa lo configurado en el servidor
(Railway → Variables). Sin ninguna de las dos cosas, el ERP lo dice y ofrece abrir el correo
del usuario con el PDF descargado.

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
