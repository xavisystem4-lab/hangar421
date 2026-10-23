# Reporte DiDi — ganancia real

ERP → **Reportes → 🛵 DiDi**. Muestra lo vendido en DiDi Food (ventas cobradas con canal
`PLATAFORMA_DELIVERY`, las que la tablet cobra desde el grupo DIDI) y cuánto le queda de verdad
al negocio después de la comisión. También aparece como tarjeta "🛵 Vendido en DiDi" en
**Ventas** y en **Reportes → Ventas**.

## Fórmula (`packages/shared/src/comisionPlataforma.ts`)

```
base      = pagado por el cliente + subsidio de DiDi
comisión  = base × comisión% × (1 + IVA de la comisión)          30 % + 16 % = 34.8 %
retención = base ÷ (1 + IVA del precio) × retención%              solo pagos en la app/tarjeta
ganancia  = base − comisión − retención
```

Con los valores por omisión reproduce la hoja de precios de DiDi del negocio: $100 en efectivo
dejan $65.20 y pagados en la app $56.15 (Latte Frío $110 → $72 / $62). Las pruebas
(`comisionPlataforma.spec.ts`) fijan ocho renglones de esa hoja.

- **Promociones**: las registra la tablet como descuento del ticket (precio de lista − pagado).
- **Subsidio de DiDi**: la venta no lo trae; se captura por producto en "Configurar comisión y
  subsidios" (pesos por unidad, ej. Latte caliente a $49 → DiDi pone $50). Se aplica a todas las
  ventas del producto en el rango, así que conviene quitarlo cuando termine la promoción.
- **Pago mixto**: cada parte se calcula con su regla (efectivo sin retención).
- La ganancia es lo que DiDi paga al negocio; no descuenta el costo de los insumos.

Configuración: tabla `config_comision_plataforma` (una fila por empresa y plataforma). Solo
ADMIN_CORPORATIVO la cambia (`PUT /reportes/didi/config`); el reporte es `GET /reportes/didi`.
