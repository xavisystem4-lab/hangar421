# HANGAR 421 — Wireframes textuales

Paleta: blanco `#FFFFFF`, gris claro `#F3F4F6`/`#E5E7EB`, azul marino `#0B1E33`/negro `#111318`
como base y texto fuerte, acentos cálidos `#E8A33D` (ámbar) para marca/foco. Estados:
verde `#1F9D55` (confirmar/cobrar), azul `#2563EB` (navegar), amarillo `#F5A524` (alerta),
rojo `#DC2626` (cancelar/eliminar). Botones táctiles ≥48px, en POS terminal ≥64px.

## 1. POS Windows — Pantalla principal (venta)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [LOGO HANGAR 421]  Sucursal: Roma Norte ▾   Ana R. (Cajero)  Turno #14  09:42 AM  ●Sync│
├───────────────────────────────────────────────────────┬────────────────────────────┤
│  [Café] [Bebidas frías] [Panadería] [Desayunos]        │  PEDIDO — Mesa 6 · 2 pax   │
│  [Comidas] [Postres] [Extras]                          │────────────────────────────│
│                                                          │ 2x Latte grande      $98  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │   leche avena, extra shot │
│  │ [img]  │ │ [img]  │ │ [img]  │ │ [img]  │            │ 1x Croissant jamón   $65  │
│  │ Latte  │ │ Capuch.│ │ Americ.│ │ Mocha  │            │   nota: sin mostaza       │
│  │ $49    │ │ $52    │ │ $38    │ │ $56    │            │                            │
│  │ ●disp. │ │ ●disp. │ │ ●disp. │ │ ○agotado│           │ Subtotal            $163  │
│  └────────┘ └────────┘ └────────┘ └────────┘            │ Impuesto (16%)     $26.08 │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │ Descuento              $0 │
│  │ [img]  │ │ [img]  │ │ [img]  │ │ [img]  │            │ ─────────────────────────│
│  │ Flat W.│ │ Choc.  │ │ Té chai│ │ Frap.  │            │ TOTAL             $189.08 │
│  │ $54    │ │ $58    │ │ $50    │ │ $62    │            │                            │
│  └────────┘ └────────┘ └────────┘ └────────┘            │  [+][-] cantidad  [🗑]     │
│                                                          │  [Agregar nota]            │
├───────────────────────────────────────────────────────┴────────────────────────────┤
│ [🔍 Buscar] [🍽 Mesas] [👤 Clientes] [⏸ Suspender] [🗑 Eliminar] [✕ Cancelar]         │
│                                              [📨 ENVIAR A COCINA]   [💳 COBRAR]      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Tocar categoría filtra la cuadrícula (transición inmediata, sin recarga).
- Tocar producto con modificadores abre modal de selección (tamaño, leche, temperatura, extras,
  nota libre) antes de agregarlo al panel derecho.
- Panel derecho **siempre visible**, nunca se oculta detrás de otra pantalla.
- `ENVIAR A COCINA` (azul) y `COBRAR` (verde) son los botones más grandes de la barra.

### 1.1 Modal de modificadores

```
┌───────────────────────────────────────────┐
│ Latte                                   ✕  │
│  Tamaño:      ( ) Chico  (●) Grande  ( ) XL│
│  Leche:       ( ) Entera (●) Avena  ( ) Deslact.│
│  Temperatura: (●) Caliente ( ) Fría        │
│  Extra shot:  [ + ]  cantidad: 1     +$15  │
│  Azúcar:      ( ) Normal (●) Sin azúcar    │
│  Nota:        [________________________]  │
│                                             │
│         [Cancelar]      [Agregar — $64]    │
└───────────────────────────────────────────┘
```

### 1.2 Cobro

```
┌───────────────────────────────────────────┐
│ Cobrar — Mesa 6                          ✕ │
│ Total a pagar:                  $189.08    │
│                                             │
│ [💵 Efectivo] [💳 Tarjeta] [🏦 Transf.] [▦ QR]│
│ [➗ Pago mixto]                             │
│                                             │
│ Efectivo recibido: [ 200.00 ]  Cambio: 10.92│
│                                             │
│        [Cancelar]      [CONFIRMAR COBRO]   │
└───────────────────────────────────────────┘
```

### 1.3 Mesas

```
┌──────────────────────────────────────────────────────────┐
│ Mesas — Salón principal                     [+ Nueva mesa]│
│ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐         │
│ │ Mesa 1 │ │ Mesa 2 │ │ Mesa 3 │ │ Mesa 4 │ │ Mesa 5 │     │
│ │ LIBRE  │ │OCUPADA │ │POR COB.│ │RESERVA │ │ LISTO  │     │
│ │ (gris) │ │ (azul) │ │(amarillo)│(morado)│ │ (verde)│     │
│ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘         │
└──────────────────────────────────────────────────────────┘
```

## 2. App Android meseros

### 2.1 Mesas (home)

```
┌───────────────────────────────┐
│ HANGAR 421   Carlos M.   ●Sync│
│ Sucursal: Roma Norte           │
├───────────────────────────────┤
│  🟢 Libre  🔵 Ocupada  🟡 Cobrar│
│  🟣 Reserva 🟢 Listo           │
├───────────────────────────────┤
│ [Mesa 1] [Mesa 2] [Mesa 3]     │
│  Libre    Ocupada  Por cobrar  │
│ [Mesa 4] [Mesa 5] [Mesa 6]     │
│  Reserva  Listo ⚡ Ocupada     │
├───────────────────────────────┤
│  [＋ Nuevo pedido mostrador]   │
└───────────────────────────────┘
```

### 2.2 Toma de pedido

```
┌───────────────────────────────┐
│ ‹ Mesa 6 · 2 comensales        │
├───────────────────────────────┤
│ [Café][Bebidas][Panadería]...  │
│ ┌─────┐ ┌─────┐ ┌─────┐        │
│ │Latte│ │Capuc│ │Croiss│       │
│ │$49  │ │$52  │ │$65  │        │
│ └─────┘ └─────┘ └─────┘        │
├───────────────────────────────┤
│ Pedido actual (3 items)  $189  │
│ [Ver / editar pedido ▸]        │
│                                 │
│   [📨 ENVIAR A COCINA]         │
└───────────────────────────────┘
```

### 2.3 Estado de pedidos

```
┌───────────────────────────────┐
│ Mis pedidos activos            │
├───────────────────────────────┤
│ Mesa 6   🟠 En preparación 12m │
│ Mesa 2   🟢 Listo — entregar   │
│ Mesa 9   ⚪ Enviado          2m│
├───────────────────────────────┤
│ [🔔 Notificación: Mesa 2 lista]│
└───────────────────────────────┘
```

## 3. Pantalla de cocina (KDS)

```
┌────────────────────────────────────────────────────────────────────────┐
│ COCINA — Estación: Barra          🔊 Alertas ON   Filtro: [Barra ▾]     │
├───────────────┬───────────────┬───────────────┬───────────────┬────────┤
│ NUEVA (3)     │ EN PREP. (2)  │ LISTA (1)     │ ENTREGADA     │CANCEL. │
├───────────────┼───────────────┼───────────────┼───────────────┼────────┤
│ Mesa 6   00:45│ Mesa 3   04:12│ Mesa 9   01:30│ Mesa 1   -    │        │
│ 2x Latte      │ 1x Capuchino  │ 2x Americano  │ (colapsada)   │        │
│ ⚠ extra shot  │               │               │               │        │
│ [▶ Empezar]   │ [✔ Marcar     │ [🔔 Ya avisado]│               │        │
│               │    LISTO]     │               │               │        │
├───────────────┼───────────────┼───────────────┼───────────────┼────────┤
│ Mesa 2   00:12│ Mesa 5   02:03│               │               │        │
│ 1x Té chai    │ 3x Mocha      │               │               │        │
│ [▶ Empezar]   │ NOTA: sin hielo, alergia a nuez (destacado en rojo)    │
└───────────────┴───────────────┴───────────────┴───────────────┴────────┘
```

- Tarjetas con borde de color según tiempo transcurrido (verde < 5 min, amarillo 5-10 min,
  rojo > 10 min) — prioridad visual sin necesidad de leer el número.
- Botón grande de cambio de estado ocupa el tercio inferior de cada tarjeta.
- Nueva comanda: parpadeo + sonido configurable por estación.
- Al marcar "LISTO" se emite notificación push/WS al mesero dueño del pedido.

## 4. CRM / Panel web

### 4.1 Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│ HANGAR 421 — CRM      Empresa: Café Hangar   [Sucursal: Todas ▾] │
├───────────┬────────────────────────────────────────────────────┤
│ Dashboard │  Ventas hoy      Ticket prom.   Pedidos    Alertas   │
│ Sucursales│   $24,580          $145            169        3 stock │
│ Catálogo  │                                                       │
│ Inventario│  [Gráfica ventas por hora — Roma Norte vs Condesa]    │
│ Reportes  │                                                       │
│ Usuarios  │  Top productos            Estado de sincronización    │
│ Clientes  │  1. Latte       320       Roma Norte   ● En línea     │
│ Traspasos │  2. Croissant   210       Condesa      ● En línea     │
│ Config.   │  3. Capuchino   190       Polanco      ○ Offline 4m   │
└───────────┴────────────────────────────────────────────────────┘
```

### 4.2 Catálogo (edición)

```
┌──────────────────────────────────────────────────────────────────┐
│ Catálogo > Café                                    [+ Producto]   │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ [img] Latte    Precio base $49   Receta: leche 200ml, ...   │   │
│ │       Disponibilidad: Roma Norte ●  Condesa ●  Polanco ○    │   │
│ │       [Editar] [Duplicar] [Desactivar]                       │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

Estos wireframes son la referencia visual mínima; el detalle de componentes reutilizables
(botón, tarjeta de producto, chip de estado, badge de sync) se implementa como sistema de
diseño compartido en cada frontend (`theme/` en POS y Kitchen, `components/ui` en CRM).
