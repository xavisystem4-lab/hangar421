# Logotipo HANGAR 421 — fuente

Estos son los archivos **fuente** del logotipo (recreación limpia en PNG del letrero de
referencia: la "H" con la barra central reemplazada por una tuerca hexagonal, y "421" como
superíndice). Se generan programáticamente con Pillow — sin depender de herramientas externas
de vectorizado — para tener un asset nítido y reproducible en vez de recortar la foto original
(que tiene brillos, sombras y el muro de fondo).

- `generate_logo.py` → `hangar421-logo-dark.png` (navy, para fondos claros) y
  `hangar421-logo-light.png` (blanco, para fondos oscuros como la barra superior del POS).
- `generate_icon.py` → `icon-*.png` (16 a 1024px) e `icon.ico` (multi-resolución), el monograma
  cuadrado (tuerca hexagonal + barras de la "H") usado como ícono de app/favicon/taskbar.

Para regenerar: `python3 generate_logo.py && python3 generate_icon.py` (requiere Pillow:
`pip3 install pillow`; usa la fuente del sistema "DIN Condensed Bold", disponible en macOS en
`/System/Library/Fonts/Supplemental/`).

Estos archivos se copian tal cual a cada app (`apps/pos-desktop/src/assets/`,
`apps/pos-desktop/build/icon.ico`, `apps/crm-web/public/`, `apps/kitchen-display/src/assets/`,
`apps/waiter-mobile/assets/`) — si se regenera el logo, hay que volver a copiarlos.
